import { verify } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EnableBankingError,
  bankingConfig,
  bankingStatus,
  createSession,
  deleteSession,
  getAspsps,
  getTransactions,
  ibanChecksumOk,
  isoInstant,
  maskIban,
  normaliseIban,
  parseAspsps,
  signToken,
  startAuthorization,
} from "./enable-banking";
import {
  SESSION_ID,
  TEST_APP_ID,
  aspspList,
  disableBanking,
  enableBanking,
  mockEnableBanking,
  sessionAnswer,
  testKeys,
} from "../../../tests/helpers/enable-banking";

const config = () => bankingConfig()!;
const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

beforeEach(() => enableBanking());
afterEach(() => {
  vi.unstubAllGlobals();
  disableBanking();
});

describe("configuration", () => {
  it("reads a key pasted with its line breaks flattened, or after a certificate block", () => {
    const pem = testKeys().pem;
    process.env.ENABLE_BANKING_PRIVATE_KEY = pem.trim().replace(/\n/g, " ");
    expect(bankingConfig()?.key.asymmetricKeyType).toBe("rsa");
    process.env.ENABLE_BANKING_PRIVATE_KEY =
      "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n" + pem;
    expect(bankingConfig()?.key.asymmetricKeyType).toBe("rsa");
  });

  it("names only the kind of block when the key is wrong, never its content", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.ENABLE_BANKING_PRIVATE_KEY =
      "-----BEGIN CERTIFICATE-----\nsecretcontent\n-----END CERTIFICATE-----";
    expect(bankingConfig()).toBeNull();
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain("CERTIFICATE");
    expect(logged).not.toContain("secretcontent");
    warn.mockRestore();
  });

  it("is off without the application id, the key or APP_URL", () => {
    for (const name of [
      "ENABLE_BANKING_APPLICATION_ID",
      "ENABLE_BANKING_PRIVATE_KEY",
      "APP_URL",
    ] as const) {
      enableBanking();
      delete process.env[name];
      expect(bankingConfig(), name).toBeNull();
    }
  });

  it("reads a key with literal \\n escapes, and refuses one that is not an RSA private key", () => {
    expect(config().key.asymmetricKeyType).toBe("rsa");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.ENABLE_BANKING_PRIVATE_KEY =
      "-----BEGIN PRIVATE KEY-----\\nnot-a-key\\n-----END PRIVATE KEY-----";
    expect(bankingConfig()).toBeNull();
    // The warning never repeats the variable's content.
    expect(JSON.stringify(warn.mock.calls)).not.toContain("not-a-key");
    warn.mockRestore();
  });

  it("only talks to https (http only for a local test server), and to the real API by default", () => {
    delete process.env.ENABLE_BANKING_API_URL;
    expect(bankingConfig()!.baseUrl.origin).toBe("https://api.enablebanking.com");
    process.env.ENABLE_BANKING_API_URL = "http://evil.example";
    expect(bankingConfig()).toBeNull();
    process.env.ENABLE_BANKING_API_URL = "https://user:pw@api.example";
    expect(bankingConfig()).toBeNull();
    process.env.ENABLE_BANKING_API_URL = "http://localhost:9999/some/path";
    expect(bankingConfig()!.baseUrl.toString()).toBe("http://localhost:9999/");
  });
});

describe("the signed token", () => {
  it("has the header and claims Enable Banking wants, lives at most 24 hours and verifies with the public key", () => {
    const now = Date.UTC(2026, 10, 18, 12, 0, 0);
    const token = signToken(config(), now);
    const [h, b, s] = token.split(".");
    expect(decode(h)).toEqual({ typ: "JWT", alg: "RS256", kid: TEST_APP_ID });
    const body = decode(b);
    expect(body).toMatchObject({ iss: "enablebanking.com", aud: "api.enablebanking.com" });
    expect(body.iat).toBe(now / 1000);
    expect(body.exp).toBeGreaterThan(body.iat);
    expect(body.exp - body.iat).toBeLessThanOrEqual(86400);
    expect(
      verify(
        "RSA-SHA256",
        Buffer.from(`${h}.${b}`),
        testKeys().publicKey,
        Buffer.from(s, "base64url"),
      ),
    ).toBe(true);
    // A tampered body does not verify.
    const forged = Buffer.from(JSON.stringify({ ...body, exp: body.exp + 999999 })).toString(
      "base64url",
    );
    expect(
      verify(
        "RSA-SHA256",
        Buffer.from(`${h}.${forged}`),
        testKeys().publicKey,
        Buffer.from(s, "base64url"),
      ),
    ).toBe(false);
  });

  it("goes with every request as a bearer token, to the configured host only", async () => {
    const calls = mockEnableBanking([["GET /aspsps", { body: aspspList }]]);
    await getAspsps(config(), "NL");
    expect(calls).toHaveLength(1);
    expect(calls[0].url.origin).toBe("https://eb.test");
    expect(calls[0].url.searchParams.get("country")).toBe("NL");
    expect(calls[0].headers.get("authorization")).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  });
});

describe("errors", () => {
  it("carry only the status and the API's code: never the token, the session id or the API's own words", async () => {
    const calls = mockEnableBanking([
      [
        /^DELETE \/sessions\//,
        {
          status: 422,
          body: {
            message: `bad ${SESSION_ID} NL00RABO0000000001`,
            error: "WRONG_SESSION_STATUS",
            detail: "x",
          },
        },
      ],
    ]);
    const error = await deleteSession(config(), SESSION_ID).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EnableBankingError);
    expect((error as EnableBankingError).code).toBe("WRONG_SESSION_STATUS");
    const text = `${(error as Error).message} ${JSON.stringify(error)} ${(error as Error).stack}`;
    const token = calls[0].headers.get("authorization")!.slice(7);
    for (const secret of [token, SESSION_ID, "NL00RABO", testKeys().pem.slice(40, 80)])
      expect(text).not.toContain(secret);
  });

  it("deleting a session that is already gone is fine", async () => {
    mockEnableBanking([
      [/^DELETE \/sessions\//, { status: 404, body: { error: "SESSION_DOES_NOT_EXIST" } }],
    ]);
    await expect(deleteSession(config(), SESSION_ID)).resolves.toBeUndefined();
  });

  it("a network failure or a timeout is an error with a code, not a crash", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("fetch failed"))),
    );
    await expect(getAspsps(config(), "BE")).rejects.toMatchObject({ code: "NETWORK" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const e = new Error("timed out");
        e.name = "TimeoutError";
        throw e;
      }),
    );
    await expect(getAspsps(config(), "DE")).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("refuses an answer that is too big, and never follows a redirect", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response("{}", {
          status: 200,
          headers: { "content-length": String(50 * 1024 * 1024) },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(getAspsps(config(), "FR")).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
    expect((fetchMock.mock.calls[0] as unknown as [URL, RequestInit])[1].redirect).toBe("error");
  });
});

describe("the bank list", () => {
  it("keeps the fields arnaq needs, drops malformed entries, and is cached for an hour", async () => {
    const calls = mockEnableBanking([
      [
        "GET /aspsps",
        {
          body: {
            aspsps: [
              ...aspspList.aspsps,
              { name: "", country: "NL", maximum_consent_validity: 1 },
              { name: "No validity", country: "NL" },
              { name: "Bad country", country: "nl", maximum_consent_validity: 5 },
              { name: "Http logo", country: "NL", logo: "http://x", maximum_consent_validity: 5 },
            ],
          },
        },
      ],
    ]);
    const now = Date.UTC(2026, 10, 18);
    const list = await getAspsps(config(), "NL", now);
    expect(list.map((a) => a.name)).toEqual([
      "Rabobank",
      "Revolut",
      "Voorbeeldbank",
      "Rabobank Zakelijk",
      "Http logo",
    ]);
    expect(list[0]).toEqual({
      name: "Rabobank",
      country: "NL",
      logo: "https://enablebanking.com/brands/NL/Rabobank/",
      maximumConsentValidity: 15552000,
      psuTypes: ["personal", "business"],
      beta: false,
    });
    expect(list.at(-1)!.logo).toBeNull();
    await getAspsps(config(), "NL", now + 59 * 60_000);
    expect(calls).toHaveLength(1);
    await getAspsps(config(), "NL", now + 61 * 60_000);
    expect(calls).toHaveLength(2);
  });

  it("a body that is not a list is an invalid response", () => {
    expect(() => parseAspsps({ aspsps: "x" })).toThrow(EnableBankingError);
  });
});

describe("the other calls", () => {
  it("start authorisation as a personal user and only accept an https address back", async () => {
    const calls = mockEnableBanking([
      ["POST /auth", { body: { url: "https://auth.eb.test/start?x=1", authorization_id: "a" } }],
    ]);
    const input = {
      validUntil: "2027-05-17T10:00:00.000Z",
      aspsp: { name: "Rabobank", country: "NL" },
      state: "s",
      redirectUrl: "https://arnaq.test/api/banking/callback",
      language: "nl" as const,
    };
    expect(await startAuthorization(config(), input)).toEqual({
      url: "https://auth.eb.test/start?x=1",
    });
    expect(calls[0].body).toEqual({
      access: { valid_until: "2027-05-17T10:00:00.000Z" },
      aspsp: { name: "Rabobank", country: "NL" },
      state: "s",
      redirect_url: "https://arnaq.test/api/banking/callback",
      psu_type: "personal",
      language: "nl",
    });
    mockEnableBanking([["POST /auth", { body: { url: "javascript:alert(1)" } }]]);
    await expect(startAuthorization(config(), input)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("a session keeps the accounts' uid, IBAN and currency, capped and checked", async () => {
    mockEnableBanking([
      [
        "POST /sessions",
        {
          body: {
            ...sessionAnswer([
              { uid: "acc-1", iban: "nl03 rabo 0000 0000 01" },
              { uid: "acc-2", currency: "usd" },
              { uid: "../../etc" },
            ]),
          },
        },
      ],
    ]);
    const s = await createSession(config(), "code");
    expect(s.sessionId).toBe(SESSION_ID);
    expect(s.validUntil).toBe("2027-05-17T10:00:00.000Z");
    expect(s.accounts).toEqual([
      { uid: "acc-1", iban: "NL03RABO0000000001", currency: "EUR", name: "Betaalrekening" },
      { uid: "acc-2", iban: null, currency: "EUR", name: "Betaalrekening" },
    ]);
  });

  it("transactions ask for booked ones in the date range and pass the continuation key", async () => {
    const calls = mockEnableBanking([
      [
        /^GET \/accounts\/acc-1\/transactions$/,
        { body: { transactions: [], continuation_key: "k2" } },
      ],
    ]);
    const page = await getTransactions(config(), "acc-1", {
      dateFrom: "2026-08-20",
      dateTo: "2026-11-18",
      continuationKey: "k1",
    });
    expect(page).toEqual({
      transactions: [],
      continuationKey: "k2",
      bytes: JSON.stringify({ transactions: [], continuation_key: "k2" }).length,
    });
    expect(Object.fromEntries(calls[0].url.searchParams)).toEqual({
      date_from: "2026-08-20",
      date_to: "2026-11-18",
      transaction_status: "BOOK",
      strategy: "default",
      continuation_key: "k1",
    });
  });

  it("dates from the API are checked", () => {
    expect(isoInstant("2027-05-17T10:00:00+00:00")).toBe("2027-05-17T10:00:00.000Z");
    expect(isoInstant("tomorrow")).toBeNull();
    expect(isoInstant("9999-01-01T00:00:00Z")).toBeNull();
    expect(isoInstant(42)).toBeNull();
  });
});

describe("which application this is (sandbox or production)", () => {
  const env = (over: Record<string, string> = {}) =>
    ({ ...process.env, ...over }) as NodeJS.ProcessEnv;
  const application = (environment: string) =>
    mockEnableBanking([
      ["GET /application", { body: { name: "arnaq", kid: TEST_APP_ID, environment } }],
    ]);

  it("a production application is on, and asked only once", async () => {
    const calls = application("PRODUCTION");
    const status = await bankingStatus(env({ NODE_ENV: "production" }));
    expect(status).toMatchObject({ state: "on", environment: "PRODUCTION" });
    await bankingStatus(env({ NODE_ENV: "production" }));
    expect(calls).toHaveLength(1);
  });

  it("a sandbox application is off in production unless ENABLE_BANKING_ALLOW_SANDBOX=1", async () => {
    application("SANDBOX");
    expect(await bankingStatus(env({ NODE_ENV: "production" }))).toEqual({ state: "sandbox" });
    expect(
      await bankingStatus(env({ NODE_ENV: "production", ENABLE_BANKING_ALLOW_SANDBOX: "1" })),
    ).toMatchObject({ state: "on", environment: "SANDBOX" });
    // On a development machine the sandbox is what it is for.
    expect(await bankingStatus(env({ NODE_ENV: "development" }))).toMatchObject({
      state: "on",
      environment: "SANDBOX",
    });
  });

  it("when Enable Banking cannot say, the feature is unavailable, and it asks again only after a minute", async () => {
    const calls = mockEnableBanking([["GET /application", { status: 500, body: {} }]]);
    const t = Date.UTC(2026, 10, 18);
    expect(await bankingStatus(env(), t)).toEqual({ state: "unreachable" });
    expect(await bankingStatus(env(), t + 30_000)).toEqual({ state: "unreachable" });
    expect(calls).toHaveLength(1);
    mockEnableBanking([["GET /application", { body: { environment: "PRODUCTION" } }]]);
    expect(await bankingStatus(env(), t + 61_000)).toMatchObject({ state: "on" });
    // An answer that names no known environment counts as a failure too.
    disableBanking();
    enableBanking();
    mockEnableBanking([["GET /application", { body: { environment: "STAGING" } }]]);
    expect(await bankingStatus(env(), t)).toEqual({ state: "unreachable" });
  });

  it("is off without the variables, without asking anything", async () => {
    const calls = application("PRODUCTION");
    disableBanking();
    expect(await bankingStatus()).toEqual({ state: "off" });
    expect(calls).toHaveLength(0);
  });
});

describe("the API address", () => {
  it("plain http to localhost only outside production, and a bad value warns once without repeating it", () => {
    const base = { ...process.env, ENABLE_BANKING_API_URL: "http://localhost:9999" };
    expect(bankingConfig({ ...base, NODE_ENV: "development" } as NodeJS.ProcessEnv)).not.toBeNull();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(bankingConfig({ ...base, NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBeNull();
    const bad = {
      ...process.env,
      ENABLE_BANKING_API_URL: "not a url secret-value",
    } as NodeJS.ProcessEnv;
    expect(bankingConfig(bad)).toBeNull();
    expect(bankingConfig(bad)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-value");
    warn.mockRestore();
  });
});

describe("IBANs", () => {
  it("are checked with mod 97 and shown with the last four characters only", () => {
    expect(ibanChecksumOk("NL91ABNA0417164300")).toBe(true); // the textbook example
    expect(ibanChecksumOk("NL92ABNA0417164300")).toBe(false);
    expect(normaliseIban("nl91 abna 0417 1643 00")).toBe("NL91ABNA0417164300");
    expect(normaliseIban("NL00RABO0000000001")).toBeNull();
    expect(maskIban("NL91ABNA0417164300")).toBe("••4300");
  });
});
