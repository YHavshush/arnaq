import { describe, expect, it } from "vitest";
import type { MonthOverview } from "@/lib/budget/overview";
import type { OccurrenceView } from "@/lib/recurring/occurrences";
import { buildOverzicht } from "./overzicht";

const line = (categoryId: number, name: string, actual: number, budget: number | null) => ({
  categoryId,
  name,
  type: "expense" as const,
  budget,
  actual,
  remaining: budget === null ? null : budget - actual,
});

function overview(
  over: Partial<MonthOverview["totals"]> = {},
  rows = [line(1, "Huur", 90000, 90000)],
) {
  const expenseActual = rows.reduce((s, r) => s + r.actual, 0);
  return {
    month: "2026-10",
    expenses: rows,
    income: [],
    totals: {
      expenseActual,
      incomeActual: 0,
      net: -expenseActual,
      totalBudget: 200000,
      totalBudgetIsExplicit: true,
      totalRemaining: 200000 - expenseActual,
      ...over,
    },
    uncategorised: { expense: 0, income: 0, count: 0 },
    foreignCurrencyCount: 0,
  } satisfies MonthOverview;
}

const occ = (
  id: number,
  status: OccurrenceView["status"],
  amount: number,
  extra: Partial<OccurrenceView> = {},
): OccurrenceView => ({
  id,
  recurringItemId: id,
  itemName: `Item ${id}`,
  type: "expense",
  categoryId: 1,
  month: "2026-10",
  expectedDate: "2026-10-25",
  expectedAmount: amount,
  status,
  transactionId: null,
  actualAmount: status === "matched" ? amount : null,
  actualDate: null,
  amount,
  ...extra,
});

const text = (s: ReturnType<typeof buildOverzicht>["sentence"]) => s.map((p) => p.text).join("");

describe("buildOverzicht", () => {
  it("free = budget - spent - fixed costs still to come; ring counts both", () => {
    const o = buildOverzicht({
      overview: overview(),
      occurrences: [occ(1, "matched", 90000), occ(2, "expected", 30000, { categoryId: null })],
      today: "2026-10-15",
    });
    expect(o.spent).toBe(90000);
    expect(o.planned).toBe(30000);
    expect(o.free).toBe(80000);
    expect(o.used).toBeCloseTo(0.6);
    expect(o.tone).toBe("good");
    expect(o.mood).toBe("good");
  });

  it("tone: under 85% good, 85-100% warn, above 100% bad", () => {
    const at = (spent: number) =>
      buildOverzicht({
        overview: overview({}, [line(1, "Huur", spent, null)]),
        occurrences: [],
        today: "2026-10-15",
      }).tone;
    expect(at(169999)).toBe("good");
    expect(at(170000)).toBe("warn");
    expect(at(200000)).toBe("warn");
    expect(at(200001)).toBe("bad");
  });

  it("without a budget: neutral accent tone, no free amount, a prompt in the sentence", () => {
    const o = buildOverzicht({
      overview: overview({ totalBudget: null, totalRemaining: null }),
      occurrences: [],
      today: "2026-10-15",
    });
    expect([o.used, o.free, o.tone, o.mood]).toEqual([null, null, "accent", "neutral"]);
    expect(text(o.sentence)).toMatch(/Stel een budget in/);
  });

  it("describes the pace of the normal (non-fixed) spending", () => {
    const base = {
      occurrences: [occ(1, "matched", 90000)],
      today: "2026-10-16", // about half way
    };
    const sentence = (spent: number) =>
      text(
        buildOverzicht({ ...base, overview: overview({}, [line(1, "Huur", 90000 + spent, null)]) })
          .sentence,
      );
    // variable budget = 200000 - 90000 = 110000
    expect(sentence(20000)).toMatch(/ruim binnen schema/);
    expect(sentence(57000)).toMatch(/precies op schema/);
    expect(sentence(90000)).toMatch(/sneller dan je budget/);
  });

  it("past months summarise under/over budget; future months mention fixed costs", () => {
    expect(
      text(buildOverzicht({ overview: overview(), occurrences: [], today: "2026-12-01" }).sentence),
    ).toMatch(/onder je budget/);
    expect(
      text(
        buildOverzicht({
          overview: overview({}, [line(1, "Huur", 250000, null)]),
          occurrences: [],
          today: "2026-12-01",
        }).sentence,
      ),
    ).toMatch(/over je budget/);
    expect(
      text(
        buildOverzicht({
          overview: overview(),
          occurrences: [occ(1, "expected", 90000)],
          today: "2026-09-01",
        }).sentence,
      ),
    ).toMatch(/nog niet begonnen/);
  });

  it("fixed costs that eat the whole budget say so", () => {
    const o = buildOverzicht({
      overview: overview({ totalBudget: 100000 }),
      occurrences: [occ(1, "matched", 90000), occ(2, "expected", 20000)],
      today: "2026-10-16",
    });
    expect(text(o.sentence)).toMatch(/hele budget/);
  });

  it("rows carry the planned fixed cost and the date it comes, sorted by size", () => {
    const o = buildOverzicht({
      overview: overview({}, [line(1, "Huur", 0, 90000), line(2, "Boodschappen", 15000, 30000)]),
      occurrences: [occ(1, "expected", 90000)],
      today: "2026-10-15",
    });
    expect(o.rows.map((r) => r.name)).toEqual(["Huur", "Boodschappen"]);
    expect(o.rows[0]).toMatchObject({ planned: 90000, nextDate: "2026-10-25", state: "warn" });
  });

  it("tiles: fixed costs paid, income, and what still needs sorting", () => {
    const o = buildOverzicht({
      overview: { ...overview(), uncategorised: { expense: 500, income: 0, count: 3 } },
      occurrences: [occ(1, "matched", 90000), occ(2, "expected", 30000)],
      today: "2026-10-15",
    });
    expect(o.tiles.find((t) => t.key === "vast")?.word).toBe("1/2 betaald");
    expect(o.tiles.find((t) => t.key === "sorteren")).toMatchObject({
      word: "3 open",
      tone: "warn",
    });
    expect(
      o.rows.at(-1)?.name === "Zonder categorie" || o.rows.some((r) => r.categoryId === null),
    ).toBe(true);
  });

  it("an empty month has no activity", () => {
    const empty = overview({ totalBudget: null, totalRemaining: null }, []);
    expect(
      buildOverzicht({ overview: empty, occurrences: [], today: "2026-10-15" }).hasActivity,
    ).toBe(false);
  });
});
