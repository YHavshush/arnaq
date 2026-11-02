import { describe, expect, it } from "vitest";
import { getForecast, type ForecastCategory, type ForecastMonth } from "@/lib/forecast/forecast";
import { matchOccurrences } from "@/lib/recurring/matching";
import { generateOccurrences } from "@/lib/recurring/occurrences";
import { setup } from "@/lib/recurring/test-utils";
import { expenseParts, incomeParts } from "./month-parts";
import { buildPrognose } from "./prognose";

const cat = (categoryId: number | null, name: string, total: number): ForecastCategory => ({
  categoryId,
  name,
  actual: 0,
  recurring: 0,
  variableAverage: 0,
  variable: 0,
  total,
  budget: null,
  difference: null,
});

/** A month with only what the parts need; the rest of the shape is filled with neutral values. */
function month(over: Partial<ForecastMonth>): ForecastMonth {
  return {
    month: "2027-02",
    kind: "forecast",
    hasUpload: false,
    income: 0,
    expenses: 0,
    net: 0,
    cumulativeNet: 0,
    setAside: { actual: 0, planned: 0, total: 0, reserve: 0 },
    cumulativeSetAside: 0,
    cumulativeReserve: 0,
    actual: { income: 0, expenses: 0 },
    recurring: { income: 0, expenses: 0, missedCount: 0, occurrences: [] },
    parts: { income: [], fixed: [] },
    variable: 0,
    categories: [],
    budget: { total: null, isExplicit: false, difference: null },
    ...over,
  };
}

const sum = (xs: { amount: number }[]) => xs.reduce((s, x) => s + x.amount, 0);

describe("incomeParts", () => {
  it("lists each fixed income item as expected, with a share of the total", () => {
    const m = month({
      income: 146800,
      parts: {
        income: [
          { name: "Featurn B.V.", amount: 96800, categoryId: null, settled: false },
          { name: "Oren Havshush", amount: 50000, categoryId: null, settled: false },
        ],
        fixed: [],
      },
    });
    const parts = incomeParts(m, "en");
    expect(parts.total).toBe(146800);
    expect(parts.lines.map((l) => [l.label, l.amount, l.tag])).toEqual([
      ["Featurn B.V.", 96800, "expected"],
      ["Oren Havshush", 50000, "expected"],
    ]);
    expect(parts.lines[0].share).toBeCloseTo(0.66, 2);
    expect(sum(parts.lines)).toBe(m.income);
  });

  it("tags money that already arrived as received, and adds other real income so it adds up", () => {
    const m = month({
      kind: "mixed",
      income: 250000 + 12345,
      actual: { income: 250000 - 0 + 12345, expenses: 0 },
      parts: {
        income: [{ name: "Salary", amount: 250000, categoryId: null, settled: true }],
        fixed: [],
      },
    });
    const parts = incomeParts(m, "en");
    expect(parts.lines.map((l) => [l.label, l.amount, l.tag])).toEqual([
      ["Salary", 250000, "received"],
      ["Other income", 12345, "received"],
    ]);
    expect(sum(parts.lines)).toBe(m.income);
  });

  it("has no lines for a month without income", () => {
    const parts = incomeParts(month({}), "en");
    expect(parts).toEqual({ lines: [], total: 0, note: null });
  });

  it("speaks Dutch", () => {
    const m = month({
      income: 500,
      parts: {
        income: [{ name: "Oren", amount: 500, categoryId: null, settled: false }],
        fixed: [],
      },
    });
    expect(incomeParts(m, "nl").lines[0].tag).toBe("verwacht");
  });
});

describe("expenseParts", () => {
  it("splits a forecast month into fixed costs and everyday spending that add up to the total", () => {
    const m = month({
      expenses: 322700,
      parts: {
        income: [],
        fixed: [
          { name: "Rent", amount: 48100, categoryId: 1, settled: false },
          { name: "Health insurance", amount: 15100, categoryId: 2, settled: false },
          { name: "Netflix", amount: 2100, categoryId: 3, settled: false },
          { name: "Claude", amount: 2200, categoryId: 3, settled: false },
        ],
      },
      categories: [
        cat(1, "Rent", 48100),
        cat(2, "Health", 15100),
        cat(3, "Subscriptions", 4300),
        cat(4, "Groceries", 41200),
        cat(null, "Uncategorised", 30100 + 156700),
      ],
    });
    const parts = expenseParts(m, "en");
    const [fixed, everyday] = parts.lines;
    expect(fixed).toMatchObject({
      label: "Fixed costs",
      count: "4 items",
      amount: 67500,
      tag: "expected",
      sub: "Rent €481 · Health insurance €151 · Claude €22 · 1 more",
    });
    expect(everyday).toMatchObject({
      label: "Everyday spending",
      amount: 322700 - 67500,
      tag: "your averages",
    });
    // The fixed items are taken out of their categories; the rest is everyday spending.
    expect(everyday.sub).toBe("Uncategorised €1,868 · Groceries €412");
    // The source of the everyday part follows what the forecast is based on.
    expect(expenseParts(m, "en", "budget").lines[1].tag).toBe("your budgets");
    expect(expenseParts(m, "en", "own").lines[1].tag).toBe("your own amount");
    expect(expenseParts(m, "nl", "budget").lines[1].tag).toBe("je budgetten");
    expect(sum(parts.lines)).toBe(parts.total);
    expect(parts.total).toBe(m.expenses);
  });

  it("shows only everyday spending for a month with no fixed items", () => {
    const m = month({ expenses: 50000, categories: [cat(4, "Groceries", 50000)] });
    const parts = expenseParts(m, "en");
    expect(parts.lines.map((l) => [l.label, l.amount])).toEqual([["Everyday spending", 50000]]);
    expect(parts.lines[0].share).toBe(1);
    expect(parts.total).toBe(50000);
  });

  it("says how much of the fixed costs is paid in a month in progress", () => {
    const m = month({
      kind: "mixed",
      expenses: 100000,
      parts: {
        income: [],
        fixed: [
          { name: "Rent", amount: 80000, categoryId: null, settled: true },
          { name: "Spotify", amount: 999, categoryId: null, settled: false },
        ],
      },
    });
    const parts = expenseParts(m, "en");
    expect(parts.lines[0].tag).toBe("€800 of €810 paid");
    expect(parts.lines[1]).toMatchObject({ amount: 100000 - 80999, tag: "so far plus averages" });
    expect(sum(parts.lines)).toBe(100000);
  });

  it("calls a past month's fixed costs paid and its other spending actual", () => {
    const m = month({
      kind: "actual",
      expenses: 90000,
      parts: {
        income: [],
        fixed: [{ name: "Rent", amount: 80000, categoryId: null, settled: true }],
      },
    });
    const [fixed, everyday] = expenseParts(m, "en").lines;
    expect(fixed.tag).toBe("paid");
    expect(everyday.tag).toBe("actual");
  });

  it("keeps money set aside out of the parts and mentions it in a note", () => {
    const m = month({
      expenses: 10000,
      categories: [cat(4, "Groceries", 10000)],
      setAside: { actual: 0, planned: 16800, total: 16800, reserve: 16800 },
    });
    const parts = expenseParts(m, "en");
    expect(sum(parts.lines)).toBe(10000);
    expect(parts.note).toBe("Not counted above: €168 was set aside for savings and the BTW.");
    expect(expenseParts(month({ expenses: 10000 }), "en").note).toBeNull();
  });

  it("has no lines for a month without spending", () => {
    expect(expenseParts(month({}), "en")).toEqual({ lines: [], total: 0, note: null });
  });
});

describe("buildPrognose: the parts follow the real forecast", () => {
  it("adds up to the tiles in every month, whether paid, expected or only an average", async () => {
    const s = await setup();
    const { db, tx, cover, cat: catId, addItem } = s;
    await cover("2026-08", "2026-09", "2026-10");
    await tx("2026-08-05", -30000, { categoryId: await catId("Boodschappen") });
    await tx("2026-09-05", -40000, { categoryId: await catId("Boodschappen") });
    await addItem({
      name: "Huur",
      matchCounterparty: "Verhuurder",
      expectedAmount: 80000,
      dayOfMonth: 1,
      startDate: "2026-10-01",
      categoryId: await catId("Huur"),
    });
    await addItem({
      name: "Salaris",
      type: "income",
      matchCounterparty: "Werkgever",
      expectedAmount: 250000,
      dayOfMonth: 25,
      startDate: "2026-10-01",
      categoryId: await catId("Salaris / bijbaan"),
    });
    await generateOccurrences(db, { throughMonth: "2026-10" });
    await tx("2026-10-01", -80000, {
      counterparty: "Verhuurder",
      categoryId: await catId("Huur"),
    });
    await tx("2026-10-05", -12000, { categoryId: await catId("Boodschappen") });
    // Real income that is not a fixed item.
    await tx("2026-10-06", 4000, { categoryId: await catId("Salaris / bijbaan") });
    expect((await matchOccurrences(db)).matched).toBe(1);

    const f = await getForecast(db, { today: "2026-10-11", months: 3, pastMonths: 1 });
    const p = buildPrognose(f, "en");
    expect(p.points.map((x) => x.month)).toEqual([
      "2026-09",
      "2026-10",
      "2026-11",
      "2026-12",
      "2027-01",
    ]);
    for (const point of p.points) {
      expect(sum(point.incomeParts.lines), point.month).toBe(point.income);
      expect(point.incomeParts.total, point.month).toBe(point.income);
      expect(sum(point.expenseParts.lines), point.month).toBe(point.expenses);
      expect(point.expenseParts.total, point.month).toBe(point.expenses);
    }

    const [sep, oct, nov] = p.points;
    // September: only everyday spending, no fixed items and no income known.
    expect(sep.incomeParts.lines).toEqual([]);
    expect(sep.expenseParts.lines.map((l) => l.label)).toEqual(["Everyday spending"]);
    // October: rent is paid, the salary is still expected, the 40 euros came from outside the fixed items.
    expect(oct.expenseParts.lines[0]).toMatchObject({
      label: "Fixed costs",
      amount: 80000,
      tag: "paid",
    });
    expect(oct.incomeParts.lines.map((l) => [l.label, l.tag])).toEqual([
      ["Salaris", "expected"],
      ["Other income", "received"],
    ]);
    // November: everything fixed is expected, everyday is the average (350 euros).
    expect(nov.expenseParts.lines.map((l) => [l.label, l.amount, l.tag])).toEqual([
      ["Fixed costs", 80000, "expected"],
      ["Everyday spending", 35000, "your averages"],
    ]);
    expect(nov.incomeParts.lines.map((l) => [l.label, l.amount, l.tag])).toEqual([
      ["Salaris", 250000, "expected"],
    ]);
  });
});
