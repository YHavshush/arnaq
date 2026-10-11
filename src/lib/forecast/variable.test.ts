import { describe, expect, it } from "vitest";
import { schema } from "@/db";
import { MAX_CENTS } from "@/lib/money";
import { setup } from "@/lib/recurring/test-utils";
import { averageCents, getVariableAverages } from "./variable";

describe("averageCents", () => {
  it("rounds half up with integer arithmetic", () => {
    expect(averageCents(1000, 3)).toBe(333); // 333.33
    expect(averageCents(2, 3)).toBe(1); // 0.67
    expect(averageCents(1, 3)).toBe(0); // 0.33
    expect(averageCents(1001, 2)).toBe(501); // 500.5 -> up
    expect(averageCents(5, 2)).toBe(3); // 2.5 -> up
    expect(averageCents(4, 2)).toBe(2);
    expect(averageCents(0, 7)).toBe(0);
    expect(averageCents(MAX_CENTS * 12, 12)).toBe(MAX_CENTS);
  });

  it("returns 0 for no months and refuses negative or fractional input", () => {
    expect(averageCents(500, 0)).toBe(0);
    expect(() => averageCents(-1, 2)).toThrow();
    expect(() => averageCents(1.5, 2)).toThrow();
    expect(() => averageCents(1, 1.5)).toThrow();
  });
});

describe("getVariableAverages", () => {
  it("averages over the last `history` uploaded months before the current month", () => {
    const { db, tx, cover, cat } = setup();
    cover("2026-05", "2026-06", "2026-08", "2026-09", "2026-10");
    const b = cat("Boodschappen");
    tx("2026-05-03", -90000, { categoryId: b }); // outside the window (4th newest)
    tx("2026-06-03", -10000, { categoryId: b });
    tx("2026-07-03", -50000, { categoryId: b }); // July has no upload: not part of the window
    tx("2026-08-03", -20000, { categoryId: b });
    tx("2026-09-03", -30001, { categoryId: b });
    tx("2026-10-03", -70000, { categoryId: b }); // current month: never in the average
    const v = getVariableAverages(db, { beforeMonth: "2026-10", history: 3 });
    expect(v.months).toEqual(["2026-06", "2026-08", "2026-09"]);
    expect(v.byCategory.get(b)).toBe(20000); // 60001 / 3 = 20000.33
    expect(v.lowConfidence).toBe(false);
    expect(v.reason).toBeNull();
  });

  it("counts a month uploaded twice (two accounts or a re-upload) once", () => {
    const { db, tx, cover, cat } = setup();
    cover("2026-08", "2026-08", "2026-09");
    tx("2026-08-03", -1000, { categoryId: cat("Overig") });
    tx("2026-09-03", -3000, { categoryId: cat("Overig") });
    const v = getVariableAverages(db, { beforeMonth: "2026-10", history: 3 });
    expect(v.months).toEqual(["2026-08", "2026-09"]);
    expect(v.byCategory.get(cat("Overig"))).toBe(2000);
  });

  it("leaves out matched recurring payments, internal transfers and foreign currency", () => {
    const { db, tx, cover, cat, addItem } = setup();
    cover("2026-09");
    const item = addItem({ startDate: "2026-09-01" });
    const [o] = db
      .insert(schema.recurringOccurrences)
      .values({
        recurringItemId: item.id,
        month: "2026-09",
        expectedDate: "2026-09-10",
        expectedAmount: 999,
        status: "matched",
      })
      .returning()
      .all();
    const a = cat("Abonnementen");
    tx("2026-09-10", -999, { categoryId: a, matchedOccurrenceId: o.id });
    tx("2026-09-11", -500, { categoryId: a });
    tx("2026-09-12", -7000, { categoryId: a, isInternalTransfer: true });
    tx("2026-09-13", -4000, { categoryId: a, currency: "USD" });
    const v = getVariableAverages(db, { beforeMonth: "2026-10", history: 3 });
    expect(v.byCategory.get(a)).toBe(500);
  });

  it("nets refunds per category and never goes below zero", () => {
    const { db, tx, cover, cat } = setup();
    cover("2026-08", "2026-09");
    tx("2026-08-03", -3000, { categoryId: cat("Kleding & verzorging") });
    tx("2026-09-03", 1000, { categoryId: cat("Kleding & verzorging") }); // refund
    tx("2026-09-04", 5000, { categoryId: cat("Overig") }); // only refunds
    const v = getVariableAverages(db, { beforeMonth: "2026-10", history: 2 });
    expect(v.byCategory.get(cat("Kleding & verzorging"))).toBe(1000); // (3000 - 1000) / 2
    expect(v.byCategory.get(cat("Overig"))).toBe(0);
  });

  it("projects uncategorised outgoing money, but no income of any kind", () => {
    const { db, tx, cover, cat } = setup();
    cover("2026-09");
    tx("2026-09-03", -1234);
    tx("2026-09-04", 99999); // uncategorised incoming
    tx("2026-09-05", 250000, { categoryId: cat("Familie / gift") });
    const v = getVariableAverages(db, { beforeMonth: "2026-10", history: 3 });
    expect(v.uncategorised).toBe(1234);
    expect(v.byCategory.has(cat("Familie / gift"))).toBe(false);
  });

  it("has an entry for every expense category, zero without history", () => {
    const { db, cover } = setup();
    cover("2026-09");
    const v = getVariableAverages(db, { beforeMonth: "2026-10", history: 3 });
    const expenseCategories = db
      .select()
      .from(schema.categories)
      .all()
      .filter((c) => c.type === "expense");
    expect(v.byCategory.size).toBe(expenseCategories.length);
    expect([...v.byCategory.values()].every((x) => x === 0)).toBe(true);
  });

  it("flags low confidence with a reason when history is short or missing", () => {
    const { db, tx, cover, cat } = setup();
    let v = getVariableAverages(db, { beforeMonth: "2026-10", history: 3 });
    expect(v).toMatchObject({ months: [], uncategorised: 0, lowConfidence: true });
    expect(v.reason).toMatch(/no uploaded month/i);

    cover("2026-10"); // the current month itself does not count as history
    v = getVariableAverages(db, { beforeMonth: "2026-10", history: 3 });
    expect(v.months).toEqual([]);

    cover("2026-09");
    tx("2026-09-03", -3000, { categoryId: cat("Overig") });
    v = getVariableAverages(db, { beforeMonth: "2026-10", history: 3 });
    expect(v).toMatchObject({ months: ["2026-09"], lowConfidence: true });
    expect(v.reason).toMatch(/1 of 3/);
    expect(v.byCategory.get(cat("Overig"))).toBe(3000);
  });
});
