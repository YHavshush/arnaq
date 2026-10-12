import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

type Handlers = {
  upload: typeof import("./import/route");
  recurring: typeof import("./recurring/route");
  forecast: typeof import("./forecast/route");
};
let h: Handlers;
let db: typeof import("@/db");

beforeAll(async () => {
  // The forecast asks the clock for "today" in the route layer only; pin it.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 11, 12, 0, 0)); // 11 October 2026, local time
  process.env.DATABASE_URL = ":memory:";
  db = await import("@/db");
  h = {
    upload: await import("./import/route"),
    recurring: await import("./recurring/route"),
    forecast: await import("./forecast/route"),
  };
});
afterAll(() => vi.useRealTimers());

const get = async (url: string) => await h.forecast.GET(new Request(`http://localhost${url}`));

type Month = {
  month: string;
  kind: string;
  income: number;
  expenses: number;
  recurring: { expenses: number; occurrences: { name: string; status: string }[] };
};

describe("forecast over HTTP", () => {
  it("forecasts from an upload and a recurring item without writing anything", async () => {
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
    const created = await h.recurring.POST(
      new Request("http://localhost/api/recurring", {
        method: "POST",
        body: JSON.stringify({
          name: "Spotify",
          type: "expense",
          matchCounterparty: "Spotify",
          expectedAmount: 999,
          dayOfMonth: 10,
          startDate: "2026-09-01",
        }),
      }),
    );
    expect(created.status).toBe(201);

    const d = await db.getDb();
    const occurrencesBefore = await d.select().from(db.schema.recurringOccurrences);

    const res = await get("/api/forecast");
    expect(res.status).toBe(200);
    const f = (await res.json()) as { currentMonth: string; months: Month[] };
    expect(f.currentMonth).toBe("2026-10");
    expect(f.months.map((m) => `${m.month} ${m.kind}`)).toEqual([
      "2026-07 no-data",
      "2026-08 no-data",
      "2026-09 actual",
      "2026-10 mixed",
      "2026-11 forecast",
      "2026-12 forecast",
      "2027-01 forecast",
      "2027-02 forecast",
      "2027-03 forecast",
      "2027-04 forecast",
    ]);
    const [sep, , nov] = f.months.slice(2);
    expect(sep.recurring.occurrences).toEqual([
      expect.objectContaining({ name: "Spotify", status: "matched" }),
    ]);
    expect(sep.expenses).toBeGreaterThan(0);
    expect(nov.recurring.expenses).toBe(999);
    // Read-only: November was planned in memory, nothing was stored.
    expect(await d.select().from(db.schema.recurringOccurrences)).toEqual(occurrencesBefore);

    const short = (await (await get("/api/forecast?months=1&history=1&pastMonths=0")).json()) as {
      settings: unknown;
      months: Month[];
    };
    expect(short.settings).toEqual({ months: 1, history: 1, pastMonths: 0 });
    expect(short.months.map((m) => m.month)).toEqual(["2026-10", "2026-11"]);
    expect((await get("/api/forecast?months=36")).status).toBe(200);
  });

  it("returns 422 for an invalid horizon, history or past months", async () => {
    for (const query of [
      "months=0",
      "months=37",
      "months=abc",
      "months=1.5",
      "months=",
      "months=1e1",
      "months=-1",
      "months=%206",
      "history=0",
      "history=13",
      "pastMonths=13",
      "pastMonths=-1",
    ]) {
      const res = await get(`/api/forecast?${query}`);
      expect(res.status, query).toBe(422);
      expect(await res.json(), query).toHaveProperty("error");
    }
  });
});
