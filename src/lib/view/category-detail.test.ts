import { describe, expect, it } from "vitest";
import { setBudget } from "@/lib/budget/budgets";
import { setup } from "@/lib/recurring/test-utils";
import { loadCategoryDetail } from "./category-detail";

describe("loadCategoryDetail (every transaction behind one category and month)", () => {
  it("lists the month's transactions of the category, newest first, with the same totals as Today", async () => {
    const { db, tx, cat } = await setup();
    const food = await cat("Eten & drinken");
    const other = await cat("Boodschappen");
    await tx("2026-10-02", -1200, {
      counterparty: "Cafe A",
      categoryId: food,
      categorySource: "rule",
    });
    await tx("2026-10-20", -3000, {
      counterparty: "Diner B",
      categoryId: food,
      categorySource: "user",
    });
    await tx("2026-10-20", -500, { counterparty: "Snack C", categoryId: food });
    await tx("2026-10-10", -9999, { counterparty: "Not here", categoryId: other });
    await tx("2026-09-30", -777, { counterparty: "Last month", categoryId: food });
    await setBudget(db, food, "2026-10", 4000);
    const d = (await loadCategoryDetail(db, food, "2026-10"))!;
    expect(d.rows.map((r) => r.counterparty)).toEqual(["Snack C", "Diner B", "Cafe A"]);
    expect(d.total).toBe(4700);
    expect(d.count).toBe(3);
    expect(d.budget).toBe(4000);
    expect(d.over).toBe(700);
    expect(d.category).toMatchObject({ id: food, type: "expense" });
  });

  it("leaves out rows in another currency than the account (they are not in the totals either)", async () => {
    const { db, tx, cat } = await setup();
    const food = await cat("Eten & drinken");
    await tx("2026-10-02", -1200, { counterparty: "Local", categoryId: food });
    await tx("2026-10-03", -9900, { counterparty: "Abroad", categoryId: food, currency: "USD" });
    const d = (await loadCategoryDetail(db, food, "2026-10"))!;
    expect(d.rows.map((r) => r.counterparty)).toEqual(["Local"]);
    expect(d.total).toBe(1200);
  });

  it("income and savings categories show their own direction as a positive total", async () => {
    const { db, tx, cat } = await setup();
    const gift = await cat("Familie / gift");
    await tx("2026-10-05", 50000, { counterparty: "Oren", categoryId: gift });
    expect((await loadCategoryDetail(db, gift, "2026-10"))!).toMatchObject({
      total: 50000,
      count: 1,
    });
    const savings = await cat("Spaarrekening");
    await tx("2026-10-06", -20000, {
      counterparty: "Spaar",
      categoryId: savings,
      isInternalTransfer: true,
    });
    expect((await loadCategoryDetail(db, savings, "2026-10"))!).toMatchObject({
      total: 20000,
      count: 1,
    });
  });

  it("returns null for a category that does not exist, and the neighbouring months", async () => {
    const { db, cat } = await setup();
    expect(await loadCategoryDetail(db, 999999, "2026-10")).toBeNull();
    const d = (await loadCategoryDetail(db, await cat("Huur"), "2026-01"))!;
    expect(d).toMatchObject({ prev: "2025-12", next: "2026-02", rows: [], total: 0 });
  });
});
