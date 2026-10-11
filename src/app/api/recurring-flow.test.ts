import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

type Handlers = {
  upload: typeof import("./import/route");
  recurring: typeof import("./recurring/route");
  item: typeof import("./recurring/[id]/route");
  suggestions: typeof import("./recurring/suggestions/route");
  accept: typeof import("./recurring/suggestions/accept/route");
  reject: typeof import("./recurring/suggestions/reject/route");
  missed: typeof import("./recurring/missed/route");
  occurrences: typeof import("./recurring/occurrences/route");
};
let h: Handlers;
let db: typeof import("@/db");

beforeAll(async () => {
  // Route handlers ask the clock for "today"; pin it.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 11, 12, 0, 0)); // 11 October 2026, local time
  process.env.DATABASE_URL = ":memory:";
  db = await import("@/db");
  h = {
    upload: await import("./import/route"),
    recurring: await import("./recurring/route"),
    item: await import("./recurring/[id]/route"),
    suggestions: await import("./recurring/suggestions/route"),
    accept: await import("./recurring/suggestions/accept/route"),
    reject: await import("./recurring/suggestions/reject/route"),
    missed: await import("./recurring/missed/route"),
    occurrences: await import("./recurring/occurrences/route"),
  };
});
afterAll(() => vi.useRealTimers());

const json = (method: string, body: unknown) =>
  new Request("http://localhost/x", { method, body: JSON.stringify(body) });
const ctx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
const get = (url: string) => new Request(`http://localhost${url}`);

type Occ = { itemName: string; month: string; status: string; amount: number };

describe("recurring items over HTTP", () => {
  it("runs the whole flow", async () => {
    // September from the fixture, plus Netflix and salary history inserted directly.
    const form = new FormData();
    form.set(
      "file",
      new File(
        [readFileSync(path.join(process.cwd(), "tests/fixtures/rabobank-sample.csv"))],
        "r.csv",
      ),
    );
    const upload = await h.upload.POST(
      new Request("http://localhost/api/import", { method: "POST", body: form }),
    );
    expect(upload.status).toBe(200);
    const d = db.getDb();
    const [account] = d.select().from(db.schema.accounts).all();
    let n = 0;
    const tx = (date: string, amount: number, counterparty: string) =>
      d
        .insert(db.schema.transactions)
        .values({ accountId: account.id, date, amount, counterparty, importHash: `x${n++}` })
        .run();
    for (const m of ["07", "08", "09"]) tx(`2026-${m}-05`, -1399, "Netflix");
    for (const m of ["07", "08"]) tx(`2026-${m}-05`, 123456, "Voorbeeld Werkgever BV");

    // Suggestions: Netflix and the salary (3 months each); Spotify has only one month.
    const suggestions = (await (await h.suggestions.GET()).json()) as {
      key: string;
      type: string;
    }[];
    expect(suggestions.map((s) => `${s.type}:${s.key}`)).toEqual([
      "expense:netflix",
      "income:voorbeeld werkgever bv",
    ]);

    // Reject the salary, accept Netflix (twice: no duplicate).
    expect(
      (await h.reject.POST(json("POST", { key: "voorbeeld werkgever bv", type: "income" }))).status,
    ).toBe(200);
    const accepted = await h.accept.POST(json("POST", { key: "netflix", type: "expense" }));
    expect(accepted.status).toBe(201);
    const again = await h.accept.POST(json("POST", { key: "netflix", type: "expense" }));
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ created: false });
    expect(await (await h.suggestions.GET()).json()).toEqual([]);

    // Create Spotify and a gym membership that was never paid in September.
    const spotify = await h.recurring.POST(
      json("POST", {
        name: "Spotify",
        type: "expense",
        matchCounterparty: "Spotify",
        expectedAmount: 999,
        dayOfMonth: 10,
        startDate: "2026-09-01",
      }),
    );
    expect(spotify.status).toBe(201);
    const spotifyId = ((await spotify.json()) as { id: number }).id;
    const gym = await h.recurring.POST(
      json("POST", {
        name: "Gym",
        type: "expense",
        matchCounterparty: "Basic-Fit",
        expectedAmount: 2999,
        dayOfMonth: 15,
        startDate: "2026-09-01",
      }),
    );
    expect(gym.status).toBe(201);
    expect(((await (await h.recurring.GET()).json()) as unknown[]).length).toBe(3);

    // Occurrences carry the real amount once matched.
    const occs = (await (
      await h.occurrences.GET(get("/api/recurring/occurrences?from=2026-09&to=2026-10"))
    ).json()) as Occ[];
    const pick = (name: string, month: string) =>
      occs.find((o) => o.itemName === name && o.month === month);
    expect(pick("Spotify", "2026-09")).toMatchObject({ status: "matched", amount: 999 });
    expect(pick("Netflix", "2026-09")).toMatchObject({ status: "matched", amount: 1399 });
    expect(pick("Gym", "2026-09")).toMatchObject({ status: "missed" });
    expect(pick("Gym", "2026-10")).toMatchObject({ status: "expected" });

    const missed = (await (await h.missed.GET()).json()) as Occ[];
    expect(missed.map((o) => `${o.itemName} ${o.month}`)).toEqual(["Gym 2026-09"]);

    // A price increase applies to October, not to the matched September.
    const patched = await h.item.PATCH(json("PATCH", { expectedAmount: 1099 }), ctx(spotifyId));
    expect(patched.status).toBe(200);
    const detail = (await (await h.item.GET(get("/x"), ctx(spotifyId))).json()) as {
      occurrences: (Occ & { expectedAmount: number })[];
    };
    expect(detail.occurrences.map((o) => [o.month, o.status, o.expectedAmount])).toEqual([
      ["2026-09", "matched", 999],
      ["2026-10", "expected", 1099],
    ]);

    // Delete unlinks the transaction.
    expect((await h.item.DELETE(get("/x"), ctx(spotifyId))).status).toBe(204);
    expect((await h.item.GET(get("/x"), ctx(spotifyId))).status).toBe(404);
    expect((await h.item.DELETE(get("/x"), ctx(spotifyId))).status).toBe(404);
    const spotifyTx = d
      .select()
      .from(db.schema.transactions)
      .all()
      .find((t) => t.counterparty === "Spotify AB")!;
    expect(spotifyTx.matchedOccurrenceId).toBeNull();
  });

  it("returns 400 for malformed requests and 422 for invalid values", async () => {
    const bad = (r: Response) => r.status;
    expect(
      bad(await h.recurring.POST(new Request("http://x", { method: "POST", body: "{" }))),
    ).toBe(400);
    expect(bad(await h.recurring.POST(json("POST", [])))).toBe(400);
    expect(bad(await h.recurring.POST(json("POST", { name: "X" })))).toBe(400);
    expect(
      bad(
        await h.recurring.POST(
          json("POST", {
            name: "X",
            type: "expense",
            matchCounterparty: "X",
            expectedAmount: "9,99",
            dayOfMonth: 1,
            startDate: "2026-01-01",
          }),
        ),
      ),
    ).toBe(400);
    expect(
      bad(
        await h.recurring.POST(
          json("POST", {
            name: "X",
            type: "expense",
            matchCounterparty: "X",
            expectedAmount: 999,
            dayOfMonth: 32,
            startDate: "2026-01-01",
          }),
        ),
      ),
    ).toBe(422);
    expect(bad(await h.item.GET(get("/x"), ctx("abc")))).toBe(400);
    expect(bad(await h.item.PATCH(json("PATCH", { tolerance: 1 }), ctx(9999)))).toBe(404);
    expect(bad(await h.item.PATCH(json("PATCH", { tolerance: "1" }), ctx(1)))).toBe(400);
    expect(bad(await h.item.PATCH(json("PATCH", { tolerance: -1 }), ctx(1)))).toBe(422);
    expect(bad(await h.accept.POST(json("POST", { key: "netflix" })))).toBe(400);
    expect(bad(await h.accept.POST(json("POST", { key: "nope", type: "expense" })))).toBe(422);
    expect(bad(await h.reject.POST(json("POST", { type: "expense" })))).toBe(400);
    expect(bad(await h.reject.POST(json("POST", { key: "x", type: "transfer" })))).toBe(422);
    expect(bad(await h.occurrences.GET(get("/x?from=2026-13")))).toBe(422);
  });
});
