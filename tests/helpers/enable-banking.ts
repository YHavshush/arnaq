// A stand-in for Enable Banking in tests: a throwaway RSA key made for the test run (never a real one), the
// environment that switches the feature on, and a fetch that answers like the API. Nothing leaves the process.
import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { vi } from "vitest";
import { clearBankingCaches } from "@/lib/banking/enable-banking";

export const TEST_API = "https://eb.test";
export const TEST_APP_ID = "11111111-2222-3333-4444-555555555555";
export const TEST_APP_URL = "https://arnaq.test";

let keys: { publicKey: KeyObject; privateKey: KeyObject; pem: string } | undefined;

/** One keypair per test file (generating RSA keys is slow). */
export function testKeys() {
  if (!keys) {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    keys = {
      publicKey,
      privateKey,
      pem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    };
  }
  return keys;
}

const ENV = [
  "ENABLE_BANKING_APPLICATION_ID",
  "ENABLE_BANKING_PRIVATE_KEY",
  "ENABLE_BANKING_API_URL",
  "APP_URL",
] as const;

/** Switch the feature on (the key with literal \n escapes, as hosts often store it). */
export function enableBanking(): void {
  process.env.ENABLE_BANKING_APPLICATION_ID = TEST_APP_ID;
  process.env.ENABLE_BANKING_PRIVATE_KEY = testKeys().pem.replace(/\n/g, "\\n");
  process.env.ENABLE_BANKING_API_URL = TEST_API;
  process.env.APP_URL = TEST_APP_URL;
  clearBankingCaches();
}

export function disableBanking(): void {
  for (const k of ENV) delete process.env[k];
  clearBankingCaches();
}

export interface Call {
  method: string;
  url: URL;
  headers: Headers;
  body: unknown;
}

type Answer =
  { status?: number; body?: unknown } | ((call: Call) => { status?: number; body?: unknown });

/**
 * Replace fetch with a router: `"POST /auth"` (or a RegExp on "METHOD path") -> an answer. Unknown requests get a 404
 * with an Enable Banking error body. Returns the calls made, for assertions.
 */
export function mockEnableBanking(routes: [string | RegExp, Answer][]): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init: RequestInit = {}) => {
      const url = new URL(String(input));
      const method = init.method ?? "GET";
      const call: Call = {
        method,
        url,
        headers: new Headers(init.headers),
        body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      };
      calls.push(call);
      const key = `${method} ${url.pathname}`;
      const hit = routes.find(([r]) => (typeof r === "string" ? r === key : r.test(key)));
      const answer = hit ? (typeof hit[1] === "function" ? hit[1](call) : hit[1]) : null;
      const status = answer ? (answer.status ?? 200) : 404;
      const body = answer ? answer.body : { message: "Not found", code: 404, error: "NOT_FOUND" };
      return new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return calls;
}

export const aspspList = {
  aspsps: [
    {
      name: "Rabobank",
      country: "NL",
      logo: "https://enablebanking.com/brands/NL/Rabobank/",
      maximum_consent_validity: 15552000,
      psu_types: ["personal", "business"],
      auth_methods: [],
      beta: false,
    },
    {
      name: "Revolut",
      country: "NL",
      logo: "https://enablebanking.com/brands/NL/Revolut/",
      maximum_consent_validity: 7776000,
      psu_types: ["personal"],
      auth_methods: [],
      beta: false,
    },
    {
      name: "Voorbeeldbank",
      country: "NL",
      logo: "https://enablebanking.com/brands/NL/Voorbeeldbank/",
      maximum_consent_validity: 15552000,
      psu_types: ["personal"],
      auth_methods: [],
      beta: false,
    },
    {
      name: "Rabobank Zakelijk",
      country: "NL",
      logo: null,
      maximum_consent_validity: 15552000,
      psu_types: ["business"],
      auth_methods: [],
      beta: false,
    },
  ],
};

/** An invented session id and accounts (no real numbers). */
export const SESSION_ID = "aaaaaaaa-0000-4000-8000-000000000001";
export const sessionAnswer = (
  accounts: { uid: string; iban?: string; currency?: string; name?: string }[],
  validUntil = "2027-05-17T10:00:00.000000+00:00",
) => ({
  session_id: SESSION_ID,
  accounts: accounts.map((a) => ({
    uid: a.uid,
    account_id: a.iban ? { iban: a.iban } : {},
    currency: a.currency ?? "EUR",
    name: a.name ?? "Betaalrekening",
  })),
  aspsp: { name: "Rabobank", country: "NL" },
  psu_type: "personal",
  access: { valid_until: validUntil },
});

/** The state Enable Banking was given in POST /auth (as it would hand it back on the redirect). */
export const stateOf = (calls: Call[]): string =>
  (calls.filter((c) => c.url.pathname === "/auth").at(-1)!.body as { state: string }).state;
