import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { schema } from "@/db";
import { matchOccurrences } from "@/lib/recurring/matching";
import { generateOccurrences, markMissed } from "@/lib/recurring/occurrences";
import { setup, snapshot } from "@/lib/recurring/test-utils";
import { getForecast, type ForecastMonth } from "./forecast";

const rent = {
  name: "Huur",
  matchCounterparty: "Verhuurder",
  expectedAmount: 80000,
  dayOfMonth: 1,
};
const lines = (m: ForecastMonth, name: string) =>
  m.recurring.occurrences.filter((o) => o.name === name);
const projectedNames = (m: ForecastMonth) =>
  m.recurring.occurrences.filter((o) => o.counted === "projected").map((o) => o.name);

describe("getForecast: recurring items", () => {
  it("plans occurrences of active items that are not stored yet, from the current month on", () => {
    const { db, addItem, cat } = setup();
    addItem({ ...rent, startDate: "2026-01-01", categoryId: cat("Huur") });
    const f = getForecast(db, { today: "2026-10-11", months: 2, pastMonths: 1 });
    expect(f.months[0].recurring.occurrences).toEqual([]); // past months show stored history only
    for (const m of f.months.slice(1)) {
      expect(m.recurring.expenses).toBe(80000);
      expect(lines(m, "Huur")).toEqual([
        expect.objectContaining({
          month: m.month,
          expectedDate: `${m.month}-01`,
          source: "planned",
          occurrenceId: null,
          status: "expected",
          counted: "projected",
          amount: 80000,
          categoryId: cat("Huur"),
        }),
      ]);
      expect(m.categories.find((c) => c.name === "Huur")).toMatchObject({ recurring: 80000 });
    }
  });

  it("lands quarterly and yearly items in the right months and honours start, end and active", () => {
    const { db, addItem } = setup();
    addItem({ name: "Kwartaal", frequency: "quarterly", startDate: "2026-08-15", dayOfMonth: 15 });
    addItem({ name: "Jaarlijks", frequency: "yearly", startDate: "2025-12-20", dayOfMonth: 20 });
    addItem({ name: "Stopt", startDate: "2026-01-01", endDate: "2026-11-30" });
    addItem({ name: "Begint", startDate: "2027-01-05", dayOfMonth: 5 });
    addItem({ name: "Uit", startDate: "2026-01-01", active: false });
    addItem({
      name: "Laatste dag",
      startDate: "2026-01-31",
      dayOfMonth: 31,
      endDate: "2027-02-27",
    });
    const f = getForecast(db, { today: "2026-10-11", months: 6, pastMonths: 0 });
    expect(f.months.map((m) => [m.month, projectedNames(m).sort()])).toEqual([
      ["2026-10", ["Laatste dag", "Stopt"]],
      ["2026-11", ["Kwartaal", "Laatste dag", "Stopt"]],
      ["2026-12", ["Jaarlijks", "Laatste dag"]],
      ["2027-01", ["Begint", "Laatste dag"]],
      ["2027-02", ["Begint", "Kwartaal"]], // 28 Feb is after the end date 27 Feb
      ["2027-03", ["Begint"]],
      ["2027-04", ["Begint"]],
    ]);
  });

  it("uses stored occurrences (edited amounts included) and never adds a planned twin", () => {
    const { db, addItem, occ } = setup();
    const item = addItem({ startDate: "2026-09-01" });
    generateOccurrences(db, { throughMonth: "2026-11" });
    db.update(schema.recurringOccurrences)
      .set({ expectedAmount: 1500 })
      .where(eq(schema.recurringOccurrences.id, occ(item.id, "2026-11").id))
      .run();
    const f = getForecast(db, { today: "2026-10-11", months: 2, pastMonths: 0 });
    expect(f.months.map((m) => lines(m, "Spotify").map((o) => [o.source, o.amount]))).toEqual([
      [["stored", 999]],
      [["stored", 1500]],
      [["planned", 999]],
    ]);
    expect(f.months[1].recurring.expenses).toBe(1500);
  });

  it("never projects a matched occurrence and shows its real amount", () => {
    const { db, addItem, tx } = setup();
    addItem({ startDate: "2026-10-01", tolerance: 100 });
    generateOccurrences(db, { throughMonth: "2026-10" });
    const t = tx("2026-10-08", -1050, { counterparty: "Spotify" });
    matchOccurrences(db);
    const [oct] = getForecast(db, { today: "2026-10-11", months: 1, pastMonths: 0 }).months;
    expect(lines(oct, "Spotify")).toEqual([
      expect.objectContaining({
        status: "matched",
        counted: "actual",
        transactionId: t.id,
        actualDate: "2026-10-08",
        expectedAmount: 999,
        amount: 1050,
      }),
    ]);
    expect(oct).toMatchObject({
      recurring: { expenses: 0 },
      actual: { expenses: 1050 },
      expenses: 1050,
    });
  });

  it("counts an occurrence matched early in the month it was paid, not in its own month", () => {
    const { db, addItem, tx } = setup();
    addItem({ ...rent, startDate: "2026-11-01" });
    generateOccurrences(db, { throughMonth: "2026-11" });
    tx("2026-10-28", -80000, { counterparty: "Verhuurder BV" });
    expect(matchOccurrences(db).matched).toBe(1);
    const [oct, nov] = getForecast(db, { today: "2026-10-29", months: 1, pastMonths: 0 }).months;
    expect(lines(nov, "Huur")[0]).toMatchObject({ status: "matched", counted: "none" });
    expect(nov.expenses).toBe(0);
    expect(oct.expenses).toBe(80000); // the real payment, once
  });

  it("treats a planned occurrence that is already paid as matched, in memory only", () => {
    const { db, addItem, tx, cover, cat } = setup();
    addItem({ ...rent, startDate: "2026-10-01", categoryId: cat("Huur") });
    generateOccurrences(db, { throughMonth: "2026-10" }); // November is not stored yet
    tx("2026-10-01", -80000, { counterparty: "Verhuurder", categoryId: cat("Huur") });
    matchOccurrences(db);
    const early = tx("2026-10-29", -80000, { counterparty: "Verhuurder", categoryId: cat("Huur") });
    cover("2026-09");
    tx("2026-09-15", -10000, { categoryId: cat("Huur") }); // some variable Huur spend in history
    const before = snapshot(db);

    const [oct, nov] = getForecast(db, { today: "2026-10-30", months: 1, pastMonths: 0 }).months;
    expect(lines(nov, "Huur")).toEqual([
      expect.objectContaining({
        source: "planned",
        status: "matched",
        transactionId: early.id,
        counted: "none",
      }),
    ]);
    expect(nov.recurring.expenses).toBe(0);
    // October: both payments are real; the early one is recurring money, not variable spend,
    // so the variable average is still fully expected.
    expect(oct.categories.find((c) => c.name === "Huur")).toMatchObject({
      actual: 160000,
      recurring: 0,
      variable: 10000,
      total: 170000,
    });
    expect(snapshot(db)).toEqual(before);
  });

  it("does not project missed occurrences but surfaces them", () => {
    const { db, addItem, cover } = setup();
    addItem({ startDate: "2026-09-01" });
    generateOccurrences(db, { throughMonth: "2026-10" });
    cover("2026-09", "2026-10");
    expect(markMissed(db, { today: "2026-10-20" })).toBe(2);
    const f = getForecast(db, { today: "2026-10-20", months: 1, pastMonths: 1 });
    const [sep, oct, nov] = f.months;
    expect(sep.recurring.missedCount).toBe(1);
    expect(oct.recurring).toMatchObject({ expenses: 0, missedCount: 1 });
    expect(lines(oct, "Spotify")[0]).toMatchObject({ status: "missed", counted: "none" });
    expect(oct.expenses).toBe(0);
    expect(nov.recurring.expenses).toBe(999);
    expect(f.missed.map((o) => o.month)).toEqual(["2026-09", "2026-10"]);
  });

  it("carries an open occurrence of last month into this month while it can still be paid", () => {
    const { db, addItem } = setup();
    addItem({
      name: "Salaris",
      type: "income",
      matchCounterparty: "Werkgever",
      expectedAmount: 250000,
      dayOfMonth: 30,
      startDate: "2026-09-01",
    });
    addItem({ startDate: "2026-09-01" }); // Spotify on the 10th: its window closed in September
    generateOccurrences(db, { throughMonth: "2026-09" });
    const [sep, oct] = getForecast(db, { today: "2026-10-02", months: 1, pastMonths: 1 }).months;
    expect(sep.kind).toBe("no-data");
    expect(lines(sep, "Salaris")[0]).toMatchObject({ status: "expected", counted: "none" });
    expect(lines(oct, "Salaris").map((o) => [o.month, o.carriedOver, o.counted])).toEqual([
      ["2026-09", true, "projected"],
      ["2026-10", false, "projected"],
    ]);
    expect(oct.recurring.income).toBe(500000);
    expect(oct.income).toBe(500000);
    expect(lines(oct, "Spotify").map((o) => o.month)).toEqual(["2026-10"]);
  });

  it("books recurring income as income, never as an expense category", () => {
    const { db, addItem, cat } = setup();
    addItem({
      name: "DUO",
      type: "income",
      matchCounterparty: "DUO",
      expectedAmount: 30000,
      dayOfMonth: 24,
      categoryId: cat("Studiefinanciering (DUO)"),
    });
    const [oct] = getForecast(db, { today: "2026-10-11", months: 1, pastMonths: 0 }).months;
    expect(oct).toMatchObject({ income: 30000, expenses: 0, net: 30000 });
    expect(oct.recurring).toMatchObject({ income: 30000, expenses: 0 });
    expect(oct.categories.every((c) => c.total === 0)).toBe(true);
  });
});
