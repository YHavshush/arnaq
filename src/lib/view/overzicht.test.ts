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
  fixed: 0,
  extra: budget,
  btw: 0,
  btwMoved: 0,
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
      anchored: false,
      anchorDate: null,
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
    // Without a goal: the total is the headline, this month's movement the sub-line.
    expect(tile(summary({ saved: 90000, thisMonth: 10000, lines: 3 }), "en")).toMatchObject({
      word: "€900.00",
      sub: expect.stringContaining("€100"),
      tone: "good",
    });
    expect(tile(summary({ saved: 80000, thisMonth: -10000, lines: 3 }), "en")).toMatchObject({
      word: "€800.00",
      sub: expect.stringContaining("taken out"),
      tone: "warn",
    });
    expect(tile(summary({ saved: 90000, thisMonth: 0, lines: 3 }), "en")).toMatchObject({
      word: "€900.00",
      sub: "saved in total",
      tone: "accent",
    });
    // A balance read from the statement shows even before any move into savings was seen.
    expect(
      tile(summary({ saved: 20085, anchored: true, anchorDate: "2026-10-29" }), "en"),
    ).toMatchObject({
      word: "€200.85",
      sub: "saved in total",
    });
    // No Savings lines and no goal: the old budget-based behaviour is unchanged.
    expect(tile(summary({}))).toMatchObject({ word: "Nog niets" });
  });

  describe("without a typed total, the total budget is the sum of the category budgets", () => {
    const sumOf = (rows: ReturnType<typeof line>[], income = 0) =>
      overview({ totalBudget: 40000, totalBudgetIsExplicit: false, incomeActual: income }, rows);
    const run = (
      ov: ReturnType<typeof overview>,
      extra: Partial<Parameters<typeof buildOverzicht>[0]> = {},
    ) =>
      buildOverzicht({
        overview: ov,
        occurrences: [],
        today: "2026-10-15",
        locale: "en" as const,
        ...extra,
      });

    it("compares the sum with spending in the budgeted categories only, and says what is outside", () => {
      const o = run(
        sumOf([line(1, "Boodschappen", 20000, 40000), line(2, "Overig", 150000, null)], 65100),
      );
      expect(o.basis).toBe("budget");
      expect(o.budget).toBe(40000);
      expect(o.spent).toBe(170000);
      expect(o.budgetSpent).toBe(20000);
      expect(o.free).toBe(20000);
      expect(o.used).toBeCloseTo(0.5);
      expect(o.facts.join(" ")).toContain("€1,500 more went to categories without a budget");
      expect(o.detail).toContain("€200 of your €400 budget spent");
    });
    it("is over budget only when the budgeted categories together are over the sum", () => {
      const o = run(sumOf([line(1, "Boodschappen", 45000, 40000), line(2, "Overig", 1000, null)]));
      expect(o.free).toBe(-5000);
      expect(o.tone).toBe("bad");
    });
  });

  describe("without any budget the top compares spending with what came in", () => {
    const noBudget = (income: number, spent: number) =>
      overview({ totalBudget: null, totalBudgetIsExplicit: false, incomeActual: income }, [
        line(1, "Boodschappen", spent, null),
      ]);
    const run = (
      income: number,
      spent: number,
      extra: Partial<Parameters<typeof buildOverzicht>[0]> = {},
    ) =>
      buildOverzicht({
        overview: noBudget(income, spent),
        occurrences: [],
        today: "2026-10-15",
        locale: "en" as const,
        ...extra,
      });

    it("has no budget, no pace schedule and no 'behind schedule'", () => {
      const o = run(300000, 196200, { daily: [5000, 12000] });
      expect(o.basis).toBe("income");
      expect(o.budget).toBeNull();
      expect(o.pace?.budget).toBeNull();
      expect(o.pace?.schedule).toBeNull();
      expect(o.pace?.ahead).toBeNull();
    });
    it("free = income - spent, the ring is the share of income spent", () => {
      const o = run(300000, 120000);
      expect(o.free).toBe(180000);
      expect(o.used).toBeCloseTo(0.4);
      expect(o.tone).toBe("good");
      expect(o.detail).toContain("came in");
    });
    it("is bad when more went out than came in", () => {
      const o = run(100000, 150000);
      expect(o.free).toBe(-50000);
      expect(o.tone).toBe("bad");
    });
    it("falls back to the plain spent line when nothing has come in", () => {
      const o = run(0, 50000);
      expect(o.basis).toBe("none");
      expect(o.used).toBeNull();
      expect(o.free).toBeNull();
    });
    it("a real total budget still wins", () => {
      const o = buildOverzicht({
        overview: overview({ incomeActual: 300000 }),
        occurrences: [],
        today: "2026-10-15",
        locale: "en" as const,
      });
      expect(o.basis).toBe("budget");
      expect(o.budget).toBe(200000);
      expect(o.budgetSpent).toBe(o.spent);
    });
  });

  describe("net worth: what is in the accounts plus savings", () => {
    const worth = (accountsBalance: number | null, saved: number | null) =>
      buildOverzicht({
        overview: overview(),
        occurrences: [],
        today: "2026-10-22",
        locale: "en" as const,
        accountsBalance,
        savings:
          saved === null
            ? null
            : {
                goal: null,
                start: 0,
                saved,
                anchored: true,
                anchorDate: "2026-10-22",
                thisMonth: 0,
                lines: 0,
              },
      }).netWorth;
    it("adds the account balance and the savings", () => {
      expect(worth(150000, 20085)).toEqual({ accounts: 150000, savings: 20085, total: 170085 });
    });
    it("counts a missing side as zero, and shows nothing when both are unknown", () => {
      expect(worth(150000, null)).toEqual({ accounts: 150000, savings: 0, total: 150000 });
      expect(worth(null, 20085)).toEqual({ accounts: 0, savings: 20085, total: 20085 });
      expect(worth(null, null)).toBeNull();
    });
  });

  it("the pace card says how the month's spending splits into fixed and everyday, and the parts add up", () => {
    const o = buildOverzicht({
      overview: overview({ incomeActual: 300000 }, [line(1, "Huur", 196200, null)]),
      occurrences: [occ(1, "matched", 90000)],
      today: "2026-10-15",
      locale: "en" as const,
      daily: [5000, 12000],
    });
    expect(o.pace).toMatchObject({ total: 196200, fixed: 90000, spent: 106200 });
    expect(o.pace!.fixed + o.pace!.spent).toBe(o.pace!.total);
  });

  describe("the header with income as the reference: days to go, the totals, and variable facts", () => {
    // Groceries budgeted 400 and over (spent 480); Eten & drinken budgeted 300 and under (spent 100).
    const rows = [line(1, "Boodschappen", 48000, 40000), line(2, "Eten & drinken", 10000, 30000)];
    const header = (today: string, extra: Partial<Parameters<typeof buildOverzicht>[0]> = {}) =>
      buildOverzicht({
        overview: overview(
          { totalBudget: null, totalBudgetIsExplicit: false, incomeActual: 185100 },
          rows,
        ),
        occurrences: [
          occ(1, "expected", 50000, {
            type: "income",
            itemName: "Oren",
            expectedDate: "2026-10-28",
          }),
          occ(2, "expected", 15100, { itemName: "Zorg", expectedDate: "2026-10-30" }),
        ],
        today,
        locale: "en" as const,
        ...extra,
      });

    it("the main line talks about the days left and fits how the month is going", () => {
      const days = (today: string, income = 185100) =>
        text(
          header(today, {
            overview: overview(
              { totalBudget: null, totalBudgetIsExplicit: false, incomeActual: income },
              rows,
            ),
          }).sentence,
        );
      // Comfortable: 580 of 1851 spent (31%).
      expect(days("2026-10-19")).toMatch(/12 days/);
      // Over: more went out than came in.
      expect(days("2026-10-29", 40000)).toMatch(/2 days/);
      expect(days("2026-10-29", 40000)).toMatch(/over the line|spend as little|heavy month/i);
      expect(days("2026-10-30", 40000)).toMatch(/1 day\b/);
      expect(days("2026-10-31")).toBe("Last day of the month");
      expect(days("2026-11-05")).toBe("October 2026 is done");
      expect(days("2026-09-20")).toBe("This month hasn't started yet");
    });
    it("rotates the wording with the day but is the same for the same day", () => {
      const line = (today: string) => text(header(today).sentence);
      expect(line("2026-10-19")).toBe(line("2026-10-19"));
      const seen = new Set(
        ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"].map((d) =>
          line(d).replace(/\d+ days/, "N days"),
        ),
      );
      expect(seen.size).toBeGreaterThan(1);
    });
    it("the line under it gives the totals", () => {
      expect(header("2026-10-19").detail).toBe("€580 spent · €1,851 came in");
    });
    it("offers at most two facts, from over budget, under budget, income to come and fixed costs to pay", () => {
      const facts = header("2026-10-19").facts;
      expect(facts.length).toBeLessThanOrEqual(2);
      expect(facts.length).toBeGreaterThan(0);
      const all = new Set<string>();
      for (const day of ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"])
        for (const f of header(day).facts) all.add(f);
      expect([...all].some((f) => /Over budget on Groceries \(\+€80\)/.test(f))).toBe(true);
      expect([...all].some((f) => /Under budget on Food & drink, €200 left/.test(f))).toBe(true);
      expect([...all].some((f) => /Still expecting Oren: €500 on 28 Oct/.test(f))).toBe(true);
      expect([...all].some((f) => /1 fixed cost still to pay \(€151\)/.test(f))).toBe(true);
    });
    it("varies with the day but is the same for the same day", () => {
      expect(header("2026-10-19").facts).toEqual(header("2026-10-19").facts);
      expect(header("2026-10-19").facts).not.toEqual(header("2026-10-20").facts);
    });
    it("skips trivial and meaningless facts: pennies over, and fixed costs that are only not paid yet", () => {
      const o = buildOverzicht({
        overview: overview(
          { totalBudget: null, totalBudgetIsExplicit: false, incomeActual: 100000 },
          [
            line(1, "Abonnementen", 2001, 2000), // €0.01 over
            line(2, "Huur", 0, 80000), // rent not paid yet: "under budget" means nothing
          ],
        ),
        occurrences: [occ(1, "expected", 80000, { categoryId: 2 })],
        today: "2026-10-19",
        locale: "en" as const,
      });
      expect(o.facts.join(" ")).not.toMatch(/Subscriptions|Rent/);
    });
    it("a budget screen with nothing to say gives no facts", () => {
      const o = buildOverzicht({
        overview: overview(
          { totalBudget: null, totalBudgetIsExplicit: false, incomeActual: 100000 },
          [line(1, "Boodschappen", 5000, null)],
        ),
        occurrences: [],
        today: "2026-10-19",
        locale: "en" as const,
      });
      expect(o.facts).toEqual([]);
    });
  });

  describe("Savings is a row among the categories", () => {
    const withSavings = (over: Partial<SavingsSummary>) =>
      buildOverzicht({
        overview: overview(),
        occurrences: [],
        today: "2026-10-22",
        locale: "en" as const,
        savings: {
          goal: null,
          start: 0,
          saved: 20085,
          anchored: true,
          anchorDate: "2026-10-22",
          thisMonth: 0,
          lines: 0,
          ...over,
        },
      }).savingsRow;
    it("shows the total saved, with this month's movement", () => {
      expect(withSavings({ thisMonth: 10000 })).toMatchObject({
        saved: 20085,
        thisMonth: 10000,
        goal: null,
      });
    });
    it("carries the goal when there is one", () => {
      expect(withSavings({ goal: 100000 })).toMatchObject({ saved: 20085, goal: 100000 });
    });
    it("is absent when nothing is saved and nothing is known", () => {
      expect(withSavings({ saved: 0, anchored: false, anchorDate: null })).toBeNull();
    });
  });
});
