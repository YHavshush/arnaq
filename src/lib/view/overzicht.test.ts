import { describe, expect, it } from "vitest";
import type { MonthOverview } from "@/lib/budget/overview";
import type { OccurrenceView } from "@/lib/recurring/occurrences";
import type { SavingsSummary } from "@/lib/savings/summary";
import { buildOverzicht } from "./overzicht";

const line = (categoryId: number, name: string, actual: number, budget: number | null) => ({
  categoryId,
  name,
  slug: name === "Sparen & beleggen" || name === "Mijn spaarpot" ? "saving-investing" : null,
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
    transactionCount: 0,
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
      locale: "nl" as const,
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
        locale: "nl" as const,
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
      locale: "nl" as const,
    });
    expect([o.used, o.free, o.tone, o.mood]).toEqual([null, null, "accent", "neutral"]);
    expect(text(o.sentence)).toMatch(/Stel een budget in/);
  });

  it("describes the pace of the normal (non-fixed) spending", () => {
    const base = {
      occurrences: [occ(1, "matched", 90000)],
      today: "2026-10-16",
      locale: "nl" as const, // about half way
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
      text(
        buildOverzicht({
          overview: overview(),
          occurrences: [],
          today: "2026-12-01",
          locale: "nl" as const,
        }).sentence,
      ),
    ).toMatch(/onder je budget/);
    expect(
      text(
        buildOverzicht({
          overview: overview({}, [line(1, "Huur", 250000, null)]),
          occurrences: [],
          today: "2026-12-01",
          locale: "nl" as const,
        }).sentence,
      ),
    ).toMatch(/over je budget/);
    expect(
      text(
        buildOverzicht({
          overview: overview(),
          occurrences: [occ(1, "expected", 90000)],
          today: "2026-09-01",
          locale: "nl" as const,
        }).sentence,
      ),
    ).toMatch(/nog niet begonnen/);
  });

  it("fixed costs that eat the whole budget say so", () => {
    const o = buildOverzicht({
      overview: overview({ totalBudget: 100000 }),
      occurrences: [occ(1, "matched", 90000), occ(2, "expected", 20000)],
      today: "2026-10-16",
      locale: "nl" as const,
    });
    expect(text(o.sentence)).toMatch(/hele budget/);
  });

  it("rows carry the planned fixed cost and the date it comes, sorted by size", () => {
    const o = buildOverzicht({
      overview: overview({}, [line(1, "Huur", 0, 90000), line(2, "Boodschappen", 15000, 30000)]),
      occurrences: [occ(1, "expected", 90000)],
      today: "2026-10-15",
      locale: "nl" as const,
    });
    expect(o.rows.map((r) => r.name)).toEqual(["Huur", "Boodschappen"]);
    expect(o.rows[0]).toMatchObject({
      planned: 90000,
      nextDate: "2026-10-25",
      fixed: true,
      state: "planned",
    });
  });

  it("tiles: fixed costs paid, savings and income; what needs sorting moved to the attention list", () => {
    const o = buildOverzicht({
      overview: { ...overview(), uncategorised: { expense: 500, income: 0, count: 3 } },
      occurrences: [occ(1, "matched", 90000), occ(2, "expected", 30000)],
      today: "2026-10-15",
      locale: "nl" as const,
    });
    expect(o.tiles.find((t) => t.key === "vast")?.word).toBe("1/2 betaald");
    expect(o.tiles.map((t) => t.key)).toEqual(["budget", "vast", "sparen", "inkomen"]);
    expect(o.attention[0]).toMatchObject({
      key: "uncategorised",
      title: "3 transacties zonder categorie",
      tone: "bad",
      action: { href: "/upload", primary: true },
    });
    expect(
      o.rows.at(-1)?.name === "Zonder categorie" || o.rows.some((r) => r.categoryId === null),
    ).toBe(true);
  });

  it("an empty month has no activity", () => {
    const empty = overview({ totalBudget: null, totalRemaining: null }, []);
    expect(
      buildOverzicht({
        overview: empty,
        occurrences: [],
        today: "2026-10-15",
        locale: "nl" as const,
      }).hasActivity,
    ).toBe(false);
  });
});

describe("buildOverzicht: the parts the design adds", () => {
  const base = (over: Partial<Parameters<typeof buildOverzicht>[0]> = {}) =>
    buildOverzicht({
      overview: overview({}, [
        line(1, "Huur", 90000, 90000),
        line(2, "Boodschappen", 31000, 24000),
      ]),
      occurrences: [occ(1, "matched", 90000)],
      today: "2026-10-22",
      locale: "nl" as const,
      ...over,
    });

  it("explains the sentence: percent used, days left, per day, what is over budget", () => {
    const o = base();
    expect(o.detail).toMatch(/^\d+% van je budget is besteed of al gepland, met 9 dagen te gaan/);
    expect(o.detail).toMatch(/Eten|Boodschappen|zit boven budget/);
    expect(base({ locale: "en" as const }).detail).toMatch(
      /of your budget is spent or already planned, with 9 days to go/,
    );
    // Nothing to say without a budget.
    expect(
      base({ overview: overview({ totalBudget: null, totalRemaining: null }, []) }).detail,
    ).toBeNull();
  });

  it("pace: spent against schedule, one bar per day, a threshold that follows the budget", () => {
    const daily = new Array(31).fill(0);
    daily[1] = 5400;
    daily[8] = 6300;
    const o = base({ daily });
    expect(o.pace?.days).toHaveLength(31);
    expect(o.pace?.days[21]).toMatchObject({ day: 22, state: "today" });
    expect(o.pace?.days[22].state).toBe("future");
    expect(o.pace?.days[0].state).toBe("past");
    expect(o.pace?.threshold).toBeGreaterThanOrEqual(2000);
    expect(o.pace!.threshold % 500).toBe(0);
    expect(o.pace?.budget).not.toBeNull();
    expect(o.pace?.schedule).toBeGreaterThan(0);
    // No budget and no spending: no card.
    expect(
      base({ overview: overview({ totalBudget: null, totalRemaining: null }, []) }).pace,
    ).toBeNull();
  });

  it("attention: income that did not show up, a missed payment, foreign rows; at most three", () => {
    const o = base({
      overview: {
        ...overview(),
        foreignCurrencyCount: 2,
        uncategorised: { expense: 0, income: 0, count: 4 },
      },
      occurrences: [
        occ(2, "expected", 14600, {
          type: "income",
          itemName: "Zorgtoeslag",
          expectedDate: "2026-10-20",
        }),
        occ(3, "missed", 7950, { itemName: "Vattenfall", expectedDate: "2026-10-18" }),
      ],
    });
    expect(o.attention).toHaveLength(3);
    expect(o.attention.map((a) => a.key)).toEqual(["uncategorised", "late3", "late2"]);
    expect(o.attention.find((a) => a.key === "late2")).toMatchObject({
      title: "Zorgtoeslag nog niet binnen",
      action: { href: "/fixed-costs", primary: false },
    });
  });

  it("income: received first (biggest first), then what is expected or missing; other income grouped by category", () => {
    const o = base({
      occurrences: [
        occ(2, "matched", 112000, {
          type: "income",
          itemName: "Salaris",
          actualDate: "2026-10-05",
        }),
        occ(3, "expected", 14600, {
          type: "income",
          itemName: "Zorgtoeslag",
          expectedDate: "2026-10-20",
        }),
        occ(4, "expected", 5000, {
          type: "income",
          itemName: "Toeslag",
          expectedDate: "2026-10-28",
        }),
      ],
      otherIncome: [
        { categoryId: 9, name: "Familie / gift", amount: 5000, lastDate: "2026-10-12" },
      ],
    });
    expect(o.income.map((r) => [r.name, r.status])).toEqual([
      ["Salaris", "received"],
      ["Familie / gift", "received"],
      ["Zorgtoeslag", "missing"], // expected on the 20th, today is the 22nd
      ["Toeslag", "expected"],
    ]);
  });

  it("upcoming: the next three fixed costs from today, current month only", () => {
    const occurrences = [
      occ(1, "expected", 14630, { itemName: "A", expectedDate: "2026-10-25" }),
      occ(2, "expected", 7950, { itemName: "B", expectedDate: "2026-10-28" }),
      occ(3, "expected", 1000, { itemName: "C", expectedDate: "2026-10-21" }), // already past
      occ(4, "matched", 5000, { itemName: "D", expectedDate: "2026-10-30" }),
    ];
    expect(base({ occurrences }).upcoming.map((u) => u.name)).toEqual(["A", "B"]);
    expect(base({ occurrences, today: "2026-11-02" }).upcoming).toEqual([]);
  });

  it("bars mean something: paid fixed cost done, fixed cost to come planned, over budget bad", () => {
    const o = base({
      overview: overview({}, [
        line(1, "Huur", 90000, 90000),
        line(2, "Boodschappen", 31000, 24000),
        line(3, "Sport", 1000, 5000),
      ]),
      occurrences: [occ(1, "matched", 90000)],
    });
    const state = (name: string) => o.rows.find((r) => r.name === name)?.state;
    expect(state("Huur")).toBe("done");
    expect(state("Boodschappen")).toBe("bad");
    expect(state("Sport")).toBe("ok");
  });

  it("savings tile: reached, under way, saved, nothing yet", () => {
    const tile = (rows: ReturnType<typeof line>[]) =>
      buildOverzicht({
        overview: overview({}, rows),
        occurrences: [],
        today: "2026-10-22",
        locale: "nl" as const,
      }).tiles.find((t) => t.key === "sparen")!;
    expect(tile([line(5, "Sparen & beleggen", 10000, 10000)])).toMatchObject({
      word: "Gehaald",
      tone: "good",
    });
    expect(tile([line(5, "Sparen & beleggen", 4000, 10000)])).toMatchObject({ word: "Onderweg" });
    expect(tile([line(5, "Sparen & beleggen", 4000, null)])).toMatchObject({ word: "Gespaard" });
    expect(tile([line(1, "Huur", 90000, 90000)])).toMatchObject({ word: "Nog niets" });
    // Renamed by the owner: the slug still finds it.
    expect(tile([line(5, "Mijn spaarpot", 10000, 10000)])).toMatchObject({ word: "Gehaald" });
  });

  it("savings tile uses the Savings category and the goal when there is one", () => {
    const summary = (over: Partial<SavingsSummary>): SavingsSummary => ({
      goal: null,
      start: 0,
      saved: 0,
      thisMonth: 0,
      lines: 0,
      ...over,
    });
    const tile = (savings: SavingsSummary, locale: "nl" | "en" = "nl") =>
      buildOverzicht({
        overview: overview(),
        occurrences: [],
        today: "2026-10-22",
        locale,
        savings,
      }).tiles.find((t) => t.key === "sparen")!;
    // With a goal: how far along.
    expect(tile(summary({ goal: 500000, saved: 125000, lines: 4 }), "en")).toMatchObject({
      word: "Under way",
      sub: expect.stringContaining("€1,250"),
      tone: "accent",
      // The cents behind the progress card (the card works out the per cent itself).
      goal: { saved: 125000, target: 500000 },
    });
    // No goal, no card: the small tile stays.
    expect(tile(summary({ saved: 90000, thisMonth: 10000, lines: 3 })).goal).toBeUndefined();
    expect(tile(summary({ goal: 500000, saved: 500000, lines: 6 }))).toMatchObject({
      word: "Gehaald",
      tone: "good",
    });
    expect(tile(summary({ goal: 100000, saved: 130000, lines: 6 }))).toMatchObject({
      word: "Gehaald",
    });
    // Withdrawals lower the progress, so a goal can be "under way" again after being reached.
    expect(tile(summary({ goal: 500000, saved: 450000, lines: 7 }))).toMatchObject({
      word: "Onderweg",
    });
    // Without a goal: this month's net, up or down.
    expect(tile(summary({ saved: 90000, thisMonth: 10000, lines: 3 }))).toMatchObject({
      word: "Gespaard",
      tone: "good",
    });
    expect(tile(summary({ saved: 80000, thisMonth: -10000, lines: 3 }))).toMatchObject({
      word: "Opgenomen",
      tone: "warn",
    });
    expect(tile(summary({ saved: 90000, thisMonth: 0, lines: 3 }))).toMatchObject({
      word: "Gespaard",
      tone: "accent",
    });
    // No Savings lines and no goal: the old budget-based behaviour is unchanged.
    expect(tile(summary({}))).toMatchObject({ word: "Nog niets" });
  });
});
