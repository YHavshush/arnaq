// The bank-link routes end to end, against a stand-in for Enable Banking (mocked fetch, a throwaway key): what a signed
// in person can do, what another person cannot, and what happens while the feature is not set up.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TEST_USER_A, TEST_USER_B, schema } from "@/db";
import { resetRateLimits } from "@/lib/auth/rate-limit";
import { GET as aspsps } from "./banking/aspsps/route";
import { GET as callback } from "./banking/callback/route";
import { POST as connect } from "./banking/connect/route";
import { DELETE as remove } from "./banking/connections/[id]/route";
import { POST as sync } from "./banking/sync/route";
import { POST as eraseAll } from "./account/delete/route";
import { asTestUser, setTestUser } from "../../../tests/helpers/test-user";
import {
  SESSION_ID,
  aspspList,
  disableBanking,
  enableBanking,
  mockEnableBanking,
  sessionAnswer,
  stateOf,
  type Call,
} from "../../../tests/helpers/enable-banking";

const url = (p: string) => `http://localhost${p}`;
const post = (p: string, body: unknown) =>
  new Request(url(p), {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
const rabobank = { aspsp: { name: "Rabobank", country: "NL" } };

let calls: Call[];

beforeAll(() => {
  process.env.DATABASE_URL = ":memory:";
});
afterEach(() => {
  vi.unstubAllGlobals();
  disableBanking();
  setTestUser(TEST_USER_A);
  resetRateLimits();
});

function stubApi() {
  calls = mockEnableBanking([
    ["GET /aspsps", { body: aspspList }],
    ["POST /auth", { body: { url: "https://auth.eb.test/start", authorization_id: "x" } }],
    ["POST /sessions", { body: sessionAnswer([{ uid: "acc-route", iban: "NL00RABO0000000077" }]) }],
    [/^DELETE \/sessions\//, { body: { message: "OK" } }],
    [/balances$/, { body: { balances: [] } }],
    [
      /transactions$/,
      {
        body: {
          transactions: [
            {
              entry_reference: "route-1",
              transaction_amount: { currency: "EUR", amount: "19.99" },
              credit_debit_indicator: "DBIT",
              status: "BOOK",
              booking_date: "2026-11-01",
              creditor: { name: "Voorbeeld Webwinkel" },
            },
          ],
        },
      },
    ],
  ]);
}

describe("while linking banks is not set up", () => {
  it("every route says so with a 503, the callback sends the person to Settings", async () => {
    disableBanking();
    expect((await aspsps(new Request(url("/api/banking/aspsps")))).status).toBe(503);
    const res = await connect(post("/api/banking/connect", rabobank));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Linking banks is not set up on this server." });
    expect((await sync()).status).toBe(503);
    expect((await remove(new Request(url("/api/banking/connections/1")), ctx(1))).status).toBe(503);
    const back = await callback(new Request(url("/api/banking/callback?code=c&state=s")));
    expect(back.status).toBe(303);
    expect(
      new URL(back.headers.get("location")!).pathname +
        new URL(back.headers.get("location")!).search,
    ).toBe("/settings?bank=unavailable");
  });
});

describe("linking, refreshing and disconnecting through the routes", () => {
  it("works for the person who started it, in their language, and never shows a session id", async () => {
    enableBanking();
    stubApi();
    const list = (await (
      await aspsps(new Request(url("/api/banking/aspsps?country=NL")))
    ).json()) as {
      name: string;
      bank: string;
    }[];
    expect(list.map((a) => [a.name, a.bank])).toEqual([
      ["Rabobank", "rabobank"],
      ["Revolut", "revolut"],
    ]);
    expect((await aspsps(new Request(url("/api/banking/aspsps?country=nl")))).status).toBe(400);

    const started = await connect(post("/api/banking/connect", rabobank));
    expect(started.status).toBe(200);
    expect(await started.json()).toEqual({ url: "https://auth.eb.test/start" });
    expect(
      (calls.find((c) => c.url.pathname === "/auth")!.body as { language: string }).language,
    ).toBe("en");

    // B comes back with A's state: nothing happens for either of them.
    setTestUser(TEST_USER_B);
    const stolen = await callback(
      new Request(url(`/api/banking/callback?code=c&state=${stateOf(calls)}`)),
    );
    expect(stolen.headers.get("location")).toBe("https://arnaq.test/settings?bank=expired");

    setTestUser(TEST_USER_A);
    const back = await callback(
      new Request(url(`/api/banking/callback?code=c&state=${stateOf(calls)}&x=<script>`)),
    );
    expect(back.status).toBe(303);
    // Built from APP_URL, a fixed result word, nothing echoed from the request.
    expect(back.headers.get("location")).toBe("https://arnaq.test/settings?bank=linked");
    expect(back.headers.get("referrer-policy")).toBe("no-referrer");

    const refreshed = await sync();
    const body = await refreshed.text();
    expect(refreshed.status).toBe(200);
    expect(JSON.parse(body).links).toEqual([
      expect.objectContaining({ status: "ok", imported: 1 }),
    ]);
    expect(body).not.toContain(SESSION_ID);
    expect(body).not.toContain("acc-route");

    const [connection] = await asTestUser((db) => db.select().from(schema.bankConnections));
    // B can neither see, refresh nor remove A's connection.
    setTestUser(TEST_USER_B);
    expect((await remove(new Request(url("/")), ctx(connection.id))).status).toBe(404);
    expect(await (await sync()).json()).toEqual({ links: [] });
    setTestUser(TEST_USER_A);
    expect((await asTestUser((db) => db.select().from(schema.bankConnections)))[0].status).toBe(
      "active",
    );

    expect((await remove(new Request(url("/")), ctx(connection.id))).status).toBe(204);
    expect((await remove(new Request(url("/")), ctx(connection.id))).status).toBe(404);
    expect(
      (await asTestUser((db) => db.select().from(schema.transactions))).some(
        (t) => t.counterparty === "Voorbeeld Webwinkel",
      ),
    ).toBe(true);
  });

  it("refuses a bank it cannot link with a 422, and a malformed body with a 400", async () => {
    enableBanking();
    stubApi();
    const res = await connect(
      post("/api/banking/connect", { aspsp: { name: "Voorbeeldbank", country: "NL" } }),
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "This bank cannot be linked." });
    expect((await connect(post("/api/banking/connect", { aspsp: "Rabobank" }))).status).toBe(400);
  });

  it("limits how often a person can refresh", async () => {
    enableBanking();
    stubApi();
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) statuses.push((await sync()).status);
    expect(statuses.slice(0, 6).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(6)).toEqual([429, 429]);
  });

  it("erasing all my data ends the bank sessions too", async () => {
    enableBanking();
    stubApi();
    await connect(post("/api/banking/connect", rabobank));
    await callback(new Request(url(`/api/banking/callback?code=c&state=${stateOf(calls)}`)));
    expect((await eraseAll(post("/api/account/delete", { confirm: "delete" }))).status).toBe(200);
    expect(calls.filter((c) => c.method === "DELETE").map((c) => c.url.pathname)).toEqual([
      `/sessions/${SESSION_ID}`,
    ]);
    expect(await asTestUser((db) => db.select().from(schema.bankConnections))).toEqual([]);
  });
});
