import { asc } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { schema, type Db } from "@/db";
import { setBudget } from "@/lib/budget/budgets";
import { getMonthOverview } from "@/lib/budget/overview";
import { addMonths, clampDay } from "@/lib/recurring/dates";
import { matchOccurrences } from "@/lib/recurring/matching";
import { generateOccurrences, markMissed, planOccurrences } from "@/lib/recurring/occurrences";
import { setup, snapshot } from "@/lib/recurring/test-utils";
import { getForecast, type Forecast } from "./forecast";

/** Small deterministic PRNG (mulberry32), so every random case is reproducible by seed. */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  const pick = <T>(xs: readonly T[]): T => xs[int(0, xs.length - 1)];
  return { next, int, pick };
}

const FREQ = ["monthly", "monthly", "quarterly", "yearly"] as const;

/** Everything the forecast could possibly write to. */
async function fullSnapshot(db: Db) {
  return {
    ...(await snapshot(db)),
    budgets: await db.select().from(schema.budgets),
    totals: await db.select().from(schema.monthlyTotalBudget),
    plan: await db.select().from(schema.planOverrides).orderBy(asc(schema.planOverrides.id)),
    imports: await db.select().from(schema.imports).orderBy(asc(schema.imports.id)),
    categories: await db.select().from(schema.categories).orderBy(asc(schema.categories.id)),
  };
}

/** A random but plausible history: items, uploads, recurring payments, variable spend. */
async function randomWorld(seed: number) {
  const r = rng(seed);
  const s = await setup();
  const { db, tx, addItem, cover, cat } = s;
  const expenseCats = await Promise.all(
    ["Huur", "Boodschappen", "Abonnementen", "Overig", "Vervoer"].map(cat),
  );
  const incomeCats = await Promise.all(["Salaris / bijbaan", "Zorgtoeslag"].map(cat));
  const today = `2026-10-${String(r.int(1, 31)).padStart(2, "0")}`;

  const items = [];
  for (let i = 0, count = r.int(1, 6); i < count; i++) {
    const type = r.next() < 0.3 ? ("income" as const) : ("expense" as const);
    const start = addMonths("2026-01", r.int(-6, 12));
    items.push(
      await addItem({
        name: `Item ${i}`,
        type,
        matchCounterparty: `Party ${i}`,
        expectedAmount: r.int(100, 200000),
        tolerance: r.pick([0, 0, 100, 1000]),
        dayOfMonth: r.int(1, 31),
        frequency: r.pick(FREQ),
        startDate: `${start}-01`,
        endDate: r.next() < 0.2 ? clampDay(addMonths(start, r.int(1, 18)), 28) : null,
        active: r.next() < 0.9,
        categoryId: r.next() < 0.2 ? null : r.pick(type === "income" ? incomeCats : expenseCats),
      }),
    );
  }

  // Uploads: a random subset of January..October 2026, sometimes the same month twice.
  for (let m = "2026-01"; m <= "2026-10"; m = addMonths(m, 1)) {
    if (r.next() < 0.7) await cover(m);
    if (r.next() < 0.1) await cover(m);
  }
  // Occurrences were last generated some time ago (or later), as in real use.
  await generateOccurrences(db, { throughMonth: addMonths("2026-10", r.int(-3, 1)) });

  // Recurring payments (some early, some late, some off by more than the tolerance).
  for (const item of items) {
    for (const p of planOccurrences(item, { throughMonth: "2026-11" })) {
      if (p.month < "2026-01" || r.next() < 0.25) continue;
      const day = Number(p.expectedDate.slice(8)) + r.int(-6, 6);
      const date = dayShift(p.expectedDate, day);
      if (date > today) continue;
      const amount = item.expectedAmount + r.int(-1200, 1200);
      await tx(date, item.type === "expense" ? -Math.max(1, amount) : Math.max(1, amount), {
        counterparty: `Party ${item.name.slice(5)}`,
      });
    }
  }
  // Variable spend, refunds, uncategorised, foreign currency and internal transfers.
  for (let i = 0, n = r.int(0, 120); i < n; i++) {
    const month = addMonths("2026-01", r.int(0, 9));
    const date = clampDay(month, r.int(1, 31));
    if (date > today) continue;
    const roll = r.next();
    await tx(date, roll < 0.1 ? r.int(1, 5000) : -r.int(1, 30000), {
      categoryId: roll < 0.8 ? r.pick(expenseCats) : roll < 0.85 ? r.pick(incomeCats) : null,
      currency: r.next() < 0.05 ? "USD" : "EUR",
      isInternalTransfer: r.next() < 0.05,
      counterparty: r.next() < 0.1 ? `Party ${r.int(0, 5)}` : "Winkel",
    });
  }
  await matchOccurrences(db);
  if (r.next() < 0.7) await markMissed(db, { today });
  if (r.next() < 0.5) await setBudget(db, expenseCats[0], "2026-11", r.int(0, 100000));
  // Amounts typed in the plan grid, for items and categories, some in months that have passed (those must change nothing).
  for (let i = 0, n = r.next() < 0.5 ? r.int(1, 8) : 0; i < n; i++) {
    const month = addMonths("2026-08", r.int(0, 10));
    const amount = r.int(0, 150000);
    const row =
      r.next() < 0.5
        ? { itemId: r.pick(items).id, month, amount }
        : { categoryId: r.pick(expenseCats), month, amount };
    await db.insert(schema.planOverrides).values(row).onConflictDoNothing();
  }

  return {
    db,
    today,
    months: r.int(1, 36),
    history: r.int(1, 12),
    pastMonths: r.int(0, 12),
  };
}

/** Day `day` of expectedDate's month; days below 1 or past the month end roll over. */
function dayShift(expectedDate: string, day: number): string {
  const [y, m] = expectedDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toISOString().slice(0, 10);
}

async function checkInvariants(db: Db, f: Forecast) {
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const countedOnce = new Map<string, number>();
  const countedTx = new Map<number, string>();
  let running = 0;
  for (const m of f.months) {
    // Totals add up and the chart line is a running sum.
    expect(m.net).toBe(m.income - m.expenses);
    expect(m.expenses).toBe(sum(m.categories.map((c) => c.total)));
    expect(m.variable).toBe(sum(m.categories.map((c) => c.variable)));
    running += m.net;
    expect(m.cumulativeNet).toBe(running);
    for (const c of m.categories) {
      for (const v of [c.actual, c.recurring, c.variable, c.total, c.variableAverage])
        expect(Number.isSafeInteger(v)).toBe(true);
      expect(c.variable).toBeLessThanOrEqual(c.variableAverage);
    }

    for (const o of m.recurring.occurrences) {
      // Matched or missed money is never forecast.
      if (o.status !== "expected") expect(o.counted).not.toBe("projected");
      if (o.counted === "none") continue;
      // Each occurrence counts in at most one month, each transaction once, in its own month.
      const key = `${o.recurringItemId}:${o.month}`;
      countedOnce.set(key, (countedOnce.get(key) ?? 0) + 1);
      if (o.transactionId !== null) {
        expect(countedTx.has(o.transactionId)).toBe(false);
        countedTx.set(o.transactionId, m.month);
        expect(o.actualDate!.slice(0, 7)).toBe(m.month);
      }
    }
    const projected = m.recurring.occurrences.filter((o) => o.counted === "projected");
    const projectedExpenses = sum(
      projected.filter((o) => o.type === "expense").map((o) => o.amount),
    );
    const projectedIncome = sum(projected.filter((o) => o.type === "income").map((o) => o.amount));
    expect(m.recurring.expenses).toBe(projectedExpenses);
    expect(m.recurring.income).toBe(projectedIncome);

    if (m.kind === "actual") {
      const o = await getMonthOverview(db, m.month);
      expect([m.income, m.expenses]).toEqual([o.totals.incomeActual, o.totals.expenseActual]);
      expect(m.recurring.expenses + m.recurring.income + m.variable).toBe(0);
    } else if (m.kind === "no-data") {
      expect([m.income, m.expenses, m.net]).toEqual([0, 0, 0]);
    } else {
      // Forecast money = actual so far + each still-expected occurrence once + variable.
      expect(m.expenses).toBe(m.actual.expenses + m.recurring.expenses + m.variable);
      expect(m.income).toBe(m.actual.income + m.recurring.income);
      if (m.kind === "forecast") expect(m.actual).toEqual({ income: 0, expenses: 0 });
    }
    // What the expected expenses are made of adds up to them; real months have no sources.
    const s = m.expenseSources;
    if (m.kind === "mixed" || m.kind === "forecast") {
      expect(m.actual.expenses + s.fixed + s.budgets + s.averages + s.typed).toBe(m.expenses);
      expect(s.fixed).toBe(m.recurring.expenses);
    } else expect(s).toEqual({ fixed: 0, budgets: 0, averages: 0, typed: 0, fellBack: [] });
    for (const v of [s.fixed, s.budgets, s.averages, s.typed, m.btwAccrued, m.btwWorth])
      expect(Number.isSafeInteger(v)).toBe(true);
  }
  for (const [key, n] of countedOnce) expect(n, key).toBe(1);
}

describe("getForecast invariants over random histories", () => {
  // 60 random worlds, each built in a fresh database: slow on a loaded machine.
  it(
    "never counts recurring money twice, stays read-only and is deterministic",
    { timeout: 120_000 },
    async () => {
      for (let seed = 1; seed <= 60; seed++) {
        const w = await randomWorld(seed);
        const before = await fullSnapshot(w.db);
        const opts = {
          today: w.today,
          months: w.months,
          history: w.history,
          pastMonths: w.pastMonths,
          // Every other world on the budget basis (carried-forward budgets), at no extra cost.
          basis: seed % 2 === 1 ? ("budget" as const) : ("averages" as const),
        };
        const f = await getForecast(w.db, opts);
        expect(await fullSnapshot(w.db), `seed ${seed}: read-only`).toEqual(before);
        expect(await getForecast(w.db, opts), `seed ${seed}: deterministic`).toEqual(f);
        expect(f.months).toHaveLength(w.pastMonths + 1 + w.months);
        await checkInvariants(w.db, f);
      }
    },
  );

  it("does not create occurrences for items that have none stored", async () => {
    const { db, addItem } = await setup();
    await addItem({ startDate: "2025-01-01" });
    await getForecast(db, { today: "2026-10-11", months: 36, pastMonths: 12 });
    expect(await db.select().from(schema.recurringOccurrences)).toEqual([]);
  });
});

describe("getForecast performance", () => {
  it("handles five years of transactions and 30 items well under a second", async () => {
    const { db, account, addItem, cover, cat } = await setup();
    const cats = await Promise.all(
      ["Boodschappen", "Eten & drinken", "Vervoer", "Overig", "Uitgaan & social"].map(cat),
    );
    const items = [];
    for (let i = 0; i < 30; i++)
      items.push(
        await addItem({
          name: `Item ${i}`,
          matchCounterparty: `Vaste last ${i}`,
          expectedAmount: 1000 + i * 100,
          dayOfMonth: (i % 28) + 1,
          frequency: i % 10 === 0 ? "quarterly" : i % 15 === 1 ? "yearly" : "monthly",
          startDate: "2021-10-01",
        }),
      );
    const rows: (typeof schema.transactions.$inferInsert)[] = [];
    let n = 0;
    for (let m = "2021-10"; m <= "2026-09"; m = addMonths(m, 1)) {
      await cover(m);
      for (const item of items)
        for (const p of planOccurrences(item, { fromMonth: m, throughMonth: m }))
          rows.push({
            accountId: account.id,
            date: p.expectedDate,
            amount: -item.expectedAmount,
            counterparty: item.matchCounterparty,
            importHash: `p${n++}`,
          });
      for (let i = 0; i < 150; i++)
        rows.push({
          accountId: account.id,
          date: clampDay(m, (i % 28) + 1),
          amount: -((i * 37) % 5000) - 1,
          categoryId: cats[i % cats.length],
          importHash: `v${n++}`,
        });
    }
    for (let i = 0; i < rows.length; i += 500)
      await db.insert(schema.transactions).values(rows.slice(i, i + 500));
    await generateOccurrences(db, { throughMonth: "2026-10" });
    await matchOccurrences(db);
    expect(rows.length).toBeGreaterThan(9000);

    const started = performance.now();
    const f = await getForecast(db, {
      today: "2026-10-11",
      months: 36,
      history: 12,
      pastMonths: 12,
    });
    const elapsed = performance.now() - started;
    expect(f.months).toHaveLength(49);
    expect(f.months.at(-1)!.recurring.expenses).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(1000);
  });
});
