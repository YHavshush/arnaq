import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDb } from "@/db";
import { importCsv } from "@/lib/import/service";
import { createRecurringItem } from "@/lib/recurring/items";
import { setup } from "@/lib/recurring/test-utils";
import {
  HORIZONS,
  loadOverzicht,
  loadPrognose,
  loadUpload,
  loadVasteLasten,
  parseHorizon,
  parseMonth,
} from "./load";

const fixture = (n: string) => readFileSync(path.join(process.cwd(), "tests/fixtures", n), "utf8");

describe("parseMonth / parseHorizon", () => {
  it("accept only valid input", () => {
    expect(parseMonth("2026-10", "x")).toBe("2026-10");
    expect(parseMonth(["2026-02", "2026-03"], "x")).toBe("2026-02");
    for (const bad of ["2026-13", "2026-1", "abc", "", undefined, "1999-01", "2026-10-01"])
      expect(parseMonth(bad, "fallback")).toBe("fallback");
    expect(parseHorizon("12")).toBe(12);
    expect(parseHorizon("5")).toBe(6);
    expect(parseHorizon(undefined)).toBe(6);
    expect(HORIZONS).toContain(24);
  });
});

describe("screen loaders on an imported month", () => {
  async function seeded() {
    const db = await createDb(":memory:");
    await importCsv(db, {
      content: fixture("rabobank-sample.csv"),
      filename: "rabo.csv",
      today: "2026-09-20",
    });
    return db;
  }

  it("loadUpload: counts what is sorted and what still needs a category", async () => {
    const u = await loadUpload(await seeded());
    expect(u.total).toBe(7);
    expect(u.reviewCount + u.sorted).toBe(u.total);
    expect(u.share).toBeCloseTo(u.sorted / u.total);
    expect(u.imports).toHaveLength(1);
    expect(u.categories.every((c) => c.type === "expense" || c.type === "income")).toBe(true);
  });

  it("loadUpload: offers the own-accounts category and the usual categories per direction", async () => {
    const u = await loadUpload(await seeded());
    expect(u.special.map((c) => c.type)).toEqual(["transfer", "savings"]);
    expect(u.categories.every((c) => c.type === "expense" || c.type === "income")).toBe(true);
    const type = new Map(u.categories.map((c) => [c.id, c.type]));
    expect(u.quick.expense).toHaveLength(3);
    expect(u.quick.income.length).toBeGreaterThan(0);
    for (const id of u.quick.expense) expect(type.get(id)).toBe("expense");
    for (const id of u.quick.income) expect(type.get(id)).toBe("income");
  });

  it("loadOverzicht, loadVasteLasten and loadPrognose run on real data and an empty database", async () => {
    const db = await seeded();
    const o = await loadOverzicht(db, "2026-09", "2026-09-20", "nl");
    expect(o.hasActivity).toBe(true);
    expect([o.prev, o.next]).toEqual(["2026-08", "2026-10"]);
    const v = await loadVasteLasten(db, "2026-09", "2026-09-20", "nl");
    expect(v.categories.length).toBeGreaterThan(5);
    const p = await loadPrognose(db, "2026-09-20", 3, "nl");
    expect(p.points.length).toBeGreaterThan(3);

    const empty = await createDb(":memory:");
    expect((await loadOverzicht(empty, "2026-09", "2026-09-20", "nl")).hasActivity).toBe(false);
    expect((await loadUpload(empty)).share).toBe(0);
    expect((await loadPrognose(empty, "2026-09-20", 6, "nl")).hasForecast).toBe(false);
  });
});

describe("loadVasteLasten tracker", () => {
  it("covers 4 months back to 2 ahead and its current month agrees with the page sums", async () => {
    const h = await setup();
    const food = await h.cat("Eten & drinken");
    await h.cover("2026-07", "2026-08", "2026-09", "2026-10");
    for (const [date, amount, counterparty] of [
      ["2026-07-05", -1399, "Netflix"],
      ["2026-08-05", -1399, "Netflix"],
      ["2026-09-09", -1399, "Netflix"], // 4 days after the expected date: late, still in the window
      ["2026-10-05", -1450, "Netflix"],
      ["2026-10-25", 250000, "Werkgever BV"],
    ] as const)
      await h.tx(date, amount, { counterparty, categoryId: food });
    const today = "2026-10-15";
    await createRecurringItem(
      h.db,
      {
        name: "Netflix",
        type: "expense",
        matchCounterparty: "Netflix",
        expectedAmount: 1399,
        tolerance: 100,
        dayOfMonth: 5,
        categoryId: food,
        startDate: "2026-07-01",
      },
      { today },
    );
    await createRecurringItem(
      h.db,
      {
        name: "Werkgever",
        type: "income",
        matchCounterparty: "Werkgever BV",
        expectedAmount: 250000,
        dayOfMonth: 25,
        startDate: "2026-07-01",
      },
      { today },
    );
    const v = await loadVasteLasten(h.db, "2026-10", today, "en");
    expect(v.tracker.months).toEqual([
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
      "2026-11",
      "2026-12",
    ]);
    const netflix = v.tracker.expenses.rows[0];
    expect(netflix.name).toBe("Netflix");
    expect(netflix.cells.map((c) => c.kind)).toEqual([
      "none",
      "paid",
      "paid",
      "late",
      "paid",
      "expected",
      "expected",
    ]);
    expect(netflix.cells[3].lateDays).toBe(4);
    // The current month's totals are the sums the page shows above the tracker.
    const sum = (rows: { amount: number }[]) => rows.reduce((s, r) => s + r.amount, 0);
    expect(v.tracker.expenses.totals[4]).toBe(sum(v.expenses));
    expect(v.tracker.income.totals[4]).toBe(sum(v.income));
    expect(v.tracker.expenses.totals[4]).toBe(1450);
  });
});

describe("loadVasteLasten list and ring", () => {
  it("one row per item with 6 months of history, and a ring that is the income split by expense", async () => {
    const h = await setup();
    const food = await h.cat("Eten & drinken");
    await h.cover("2026-07", "2026-08", "2026-09", "2026-10");
    for (const [date, amount, counterparty] of [
      ["2026-08-05", -1399, "Netflix"],
      ["2026-09-09", -1399, "Netflix"], // 4 days late
      ["2026-10-05", -1399, "Netflix"],
      ["2026-10-25", 250000, "Werkgever BV"],
    ] as const)
      await h.tx(date, amount, { counterparty, categoryId: food });
    const today = "2026-10-26";
    await createRecurringItem(
      h.db,
      {
        name: "Netflix",
        type: "expense",
        matchCounterparty: "Netflix",
        expectedAmount: 1399,
        dayOfMonth: 5,
        categoryId: food,
        startDate: "2026-07-01",
      },
      { today },
    );
    await createRecurringItem(
      h.db,
      {
        name: "Gym",
        type: "expense",
        matchCounterparty: "Gym",
        expectedAmount: 3000,
        dayOfMonth: 28,
        startDate: "2026-07-01",
      },
      { today },
    );
    await createRecurringItem(
      h.db,
      {
        name: "Werkgever",
        type: "income",
        matchCounterparty: "Werkgever BV",
        expectedAmount: 250000,
        dayOfMonth: 25,
        startDate: "2026-07-01",
      },
      { today },
    );
    const v = await loadVasteLasten(h.db, "2026-10", today, "en");
    const netflix = v.list.expenses.rows.find((r) => r.name === "Netflix")!;
    expect(netflix.state).toBe("paid");
    expect(netflix.history.map((c) => c.month)).toEqual([
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
    ]);
    expect(netflix.history.map((c) => c.kind)).toEqual([
      "none",
      "none",
      "missed", // July: no payment was found
      "paid",
      "late",
      "paid",
    ]);
    expect(v.list.expenses.rows.find((r) => r.name === "Gym")!.state).toBe("due");
    expect([v.list.expenses.done, v.list.expenses.count]).toEqual([1, 2]);
    expect(v.list.expenses.total).toBe(1399 + 3000);
    expect([v.list.income.total, v.list.income.done]).toEqual([250000, 1]);
    // The ring: the income is the circle, the paid item is solid, the one still to come is not.
    expect(v.ring.mode).toBe("normal");
    expect(v.ring.income).toBe(250000);
    expect(v.ring.fixed).toBe(4399);
    expect(v.ring.leftOver).toBe(250000 - 4399);
    expect(v.ring.segments.map((s) => s.paid)).toEqual([false, true]); // Gym (largest) first
  });

  it("without income the ring is spent-only", async () => {
    const h = await setup();
    await h.cover("2026-10");
    const today = "2026-10-26";
    await createRecurringItem(
      h.db,
      {
        name: "Gym",
        type: "expense",
        matchCounterparty: "Gym",
        expectedAmount: 3000,
        dayOfMonth: 28,
        startDate: "2026-10-01",
      },
      { today },
    );
    const v = await loadVasteLasten(h.db, "2026-10", today, "en");
    expect(v.ring.mode).toBe("noIncome");
    expect(v.ring.segments).toHaveLength(1);
    expect(v.ring.segments[0].end).toBe(1);
  });
});

describe("loadVasteLasten suggestions", () => {
  it("keeps suggested costs and suggested income apart", async () => {
    const h = await setup();
    for (const [date, amount, counterparty] of [
      ["2026-07-05", -1399, "Netflix"],
      ["2026-08-05", -1399, "Netflix"],
      ["2026-09-05", -1399, "Netflix"],
      ["2026-07-25", 250000, "Voorbeeld Werkgever BV"],
      ["2026-08-25", 250000, "Voorbeeld Werkgever BV"],
      ["2026-09-25", 250000, "Voorbeeld Werkgever BV"],
    ] as const)
      await h.tx(date, amount, { counterparty });
    const v = await loadVasteLasten(h.db, "2026-09", "2026-09-26", "en");
    expect(v.suggestionsCosts.map((s) => s.key)).toEqual(["netflix"]);
    expect(v.suggestionsIncome.map((s) => s.key)).toEqual(["voorbeeld werkgever bv"]);
  });
});
