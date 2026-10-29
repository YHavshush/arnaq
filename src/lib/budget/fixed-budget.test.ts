import { describe, expect, it } from "vitest";
import { setup } from "@/lib/recurring/test-utils";
import { getForecast } from "@/lib/forecast/forecast";
import { setBudget } from "./budgets";
import { getMonthOverview } from "./overview";

const rent = {
  name: "Huur",
  matchCounterparty: "Verhuurder",
  expectedAmount: 80000,
  dayOfMonth: 1,
  startDate: "2026-01-01",
};
const lineOf = async (db: Parameters<typeof getMonthOverview>[0], month: string, name: string) =>
  (await getMonthOverview(db, month)).expenses.find((l) => l.name === name)!;

describe("a category's fixed items are its budget", () => {
  it("rent as a fixed item is the Huur budget, with nothing typed", async () => {
    const { db, addItem, cat } = await setup();
    await addItem({ ...rent, categoryId: await cat("Huur") });
    expect(await lineOf(db, "2026-10", "Huur")).toMatchObject({
      budget: 80000,
      fixed: 80000,
      extra: null,
    });
  });

  it("a typed budget above the fixed amount is the budget (fixed 30 plus 20 everyday: type 50)", async () => {
    const { db, addItem, cat } = await setup();
    const abonnementen = await cat("Abonnementen");
    await addItem({
      name: "Spotify",
      matchCounterparty: "Spotify",
      expectedAmount: 3000,
      categoryId: abonnementen,
    });
    await setBudget(db, abonnementen, "2026-10", 5000);
    expect(await lineOf(db, "2026-10", "Abonnementen")).toMatchObject({
      budget: 5000,
      fixed: 3000,
      extra: 5000,
    });
  });

  it("a typed budget that already includes the rent is not counted twice, and one below it is lifted", async () => {
    const { db, addItem, cat } = await setup();
    const huur = await cat("Huur");
    await addItem({ ...rent, categoryId: huur });
    await setBudget(db, huur, "2026-10", 80000);
    expect((await lineOf(db, "2026-10", "Huur")).budget).toBe(80000);
    await setBudget(db, huur, "2026-10", 50000);
    expect((await lineOf(db, "2026-10", "Huur")).budget).toBe(80000);
  });

  it("adds up several items in one category and counts the real remaining against the sum", async () => {
    const { db, addItem, cat, tx } = await setup();
    const abonnementen = await cat("Abonnementen");
    for (const [name, amount] of [
      ["Spotify", 1000],
      ["Netflix", 1500],
    ] as const)
      await addItem({
        name,
        matchCounterparty: name,
        expectedAmount: amount,
        categoryId: abonnementen,
      });
    await tx("2026-10-10", -1000, { counterparty: "Spotify", categoryId: abonnementen });
    expect(await lineOf(db, "2026-10", "Abonnementen")).toMatchObject({
      budget: 2500,
      actual: 1000,
      remaining: 1500,
    });
  });

  it("follows the schedule: a quarterly item is a budget only in its months", async () => {
    const { db, addItem, cat } = await setup();
    await addItem({
      name: "Kwartaal",
      matchCounterparty: "Kwartaal",
      expectedAmount: 9000,
      frequency: "quarterly",
      startDate: "2026-01-15",
      dayOfMonth: 15,
      categoryId: await cat("Abonnementen"),
    });
    expect((await lineOf(db, "2026-10", "Abonnementen")).budget).toBe(9000);
    expect((await lineOf(db, "2026-11", "Abonnementen")).budget).toBeNull();
  });

  it("ignores inactive and ended items, income items and savings items", async () => {
    const { db, addItem, cat } = await setup();
    const huur = await cat("Huur");
    await addItem({ ...rent, name: "Uit", active: false, categoryId: huur });
    await addItem({ ...rent, name: "Voorbij", endDate: "2026-06-30", categoryId: huur });
    await addItem({
      name: "Salaris",
      type: "income",
      matchCounterparty: "Werkgever",
      expectedAmount: 200000,
      categoryId: await cat("Salaris / bijbaan"),
    });
    await addItem({
      name: "BTW reserve",
      matchCounterparty: "EUR BTW",
      expectedAmount: 50000,
      categoryId: await cat("Spaarrekening"),
    });
    const overview = await getMonthOverview(db, "2026-10");
    expect(overview.expenses.find((l) => l.name === "Huur")!.budget).toBeNull();
    expect(overview.expenses.every((l) => l.fixed === 0)).toBe(true);
    expect(overview.totals.totalBudget).toBeNull();
  });

  it("the total budget (when none is set) includes the fixed amounts, and is still not an explicit total", async () => {
    const { db, addItem, cat } = await setup();
    await addItem({ ...rent, categoryId: await cat("Huur") });
    const { totals } = await getMonthOverview(db, "2026-10");
    expect(totals).toMatchObject({ totalBudget: 80000, totalBudgetIsExplicit: false });
  });

  it("the forecast uses the same budget", async () => {
    const { db, addItem, cat } = await setup();
    await addItem({ ...rent, categoryId: await cat("Huur") });
    const f = await getForecast(db, { today: "2026-10-11", months: 1, pastMonths: 0 });
    expect(f.months[1].categories.find((c) => c.name === "Huur")).toMatchObject({ budget: 80000 });
  });
});
