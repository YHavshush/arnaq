import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { TEST_USER_B, schema } from "@/db";
import { withUser } from "@/db/scoped";
import { setup } from "@/lib/recurring/test-utils";
import { PlanError, getPlanOverrides, setPlanOverride } from "./overrides";

const TODAY = "2026-11-02";

async function world() {
  const s = await setup();
  const groceries = await s.cat("Boodschappen");
  const rent = await s.addItem({ name: "Huur", expectedAmount: 100000, dayOfMonth: 1 });
  return { ...s, groceries, rent };
}

describe("setPlanOverride", () => {
  it("stores one month by default and replaces it when typed again", async () => {
    const { db, groceries } = await world();
    const set = (amount: number | null) =>
      setPlanOverride(
        db,
        { kind: "category", id: groceries, month: "2026-12", amount, scope: "month" },
        TODAY,
      );
    expect(await set(25000)).toEqual({ months: ["2026-12"] });
    await set(30000);
    expect(await getPlanOverrides(db)).toEqual([
      { kind: "category", id: groceries, month: "2026-12", amount: 30000 },
    ]);
    await set(null);
    expect(await getPlanOverrides(db)).toEqual([]);
  });

  it("'after' fills this and every later month up to 24 months after the current month, and clears them all", async () => {
    const { db, rent } = await world();
    const res = await setPlanOverride(
      db,
      { kind: "item", id: rent.id, month: "2027-03", amount: 110000, scope: "after" },
      TODAY,
    );
    expect(res.months[0]).toBe("2027-03");
    expect(res.months.at(-1)).toBe("2028-11"); // 2026-11 + 24
    expect(res.months).toHaveLength(21);
    const rows = await getPlanOverrides(db);
    expect(rows).toHaveLength(21);
    expect(rows.every((r) => r.amount === 110000 && r.kind === "item")).toBe(true);
    // A single month inside it can still differ.
    await setPlanOverride(
      db,
      { kind: "item", id: rent.id, month: "2027-06", amount: 0, scope: "month" },
      TODAY,
    );
    expect((await getPlanOverrides(db, { from: "2027-06", to: "2027-06" }))[0].amount).toBe(0);
    // Clearing with "after" from April leaves March.
    await setPlanOverride(
      db,
      { kind: "item", id: rent.id, month: "2027-04", amount: null, scope: "after" },
      TODAY,
    );
    expect(await getPlanOverrides(db)).toEqual([
      { kind: "item", id: rent.id, month: "2027-03", amount: 110000 },
    ]);
  });

  it("accepts the current month (its part still to come) but refuses past months and months too far ahead", async () => {
    const { db, groceries } = await world();
    const at = (month: string) =>
      setPlanOverride(
        db,
        { kind: "category", id: groceries, month, amount: 100, scope: "month" },
        TODAY,
      );
    await expect(at("2026-11")).resolves.toEqual({ months: ["2026-11"] });
    await expect(at("2026-10")).rejects.toThrow(PlanError);
    await expect(at("2028-11")).resolves.toEqual({ months: ["2028-11"] });
    await expect(at("2028-12")).rejects.toThrow(PlanError);
    await expect(at("2026-13")).rejects.toThrow(PlanError);
  });

  it("refuses bad amounts, kinds, scopes and ids", async () => {
    const { db, groceries, rent } = await world();
    const income = await (async () => {
      const [c] = await db
        .select()
        .from(schema.categories)
        .where(eq(schema.categories.type, "income"));
      return c.id;
    })();
    const base = { kind: "category", id: groceries, month: "2026-12", amount: 100, scope: "month" };
    for (const bad of [
      { amount: -1 },
      { amount: 1.5 },
      { amount: "100" },
      { amount: 1e13 },
      { kind: "btw" },
      { kind: "other" },
      { scope: "year" },
      { id: 999999 },
      { id: "1" },
      { id: income }, // only expense categories have everyday spending to plan
      { kind: "item", id: 999999 },
      { kind: "item", id: rent.id + 1000 },
    ])
      await expect(
        setPlanOverride(db, { ...base, ...bad }, TODAY),
        JSON.stringify(bad),
      ).rejects.toThrow(PlanError);
    expect(await getPlanOverrides(db)).toEqual([]);
  });

  it("another person's category or item is unknown", async () => {
    const { db, groceries, rent } = await world();
    await withUser(db, TEST_USER_B, async (tx) => {
      await expect(
        setPlanOverride(
          tx,
          { kind: "category", id: groceries, month: "2026-12", amount: 1, scope: "month" },
          TODAY,
        ),
      ).rejects.toThrow(PlanError);
      await expect(
        setPlanOverride(
          tx,
          { kind: "item", id: rent.id, month: "2026-12", amount: 1, scope: "after" },
          TODAY,
        ),
      ).rejects.toThrow(PlanError);
      expect(await getPlanOverrides(tx)).toEqual([]);
    });
  });
});

describe("plan_overrides table", () => {
  it("holds exactly one target, a whole non-negative amount and a real month", async () => {
    const { db, groceries, rent } = await world();
    const insert = (values: Partial<typeof schema.planOverrides.$inferInsert>) =>
      db.insert(schema.planOverrides).values({ month: "2026-12", amount: 1, ...values });
    await expect(insert({ categoryId: groceries, itemId: rent.id })).rejects.toThrow();
    await expect(insert({})).rejects.toThrow();
    await expect(insert({ categoryId: groceries, amount: -1 })).rejects.toThrow();
    await expect(insert({ categoryId: groceries, month: "2026-1" })).rejects.toThrow();
    await insert({ categoryId: groceries });
    await expect(insert({ categoryId: groceries })).rejects.toThrow(); // one per category and month
    await insert({ itemId: rent.id });
    await expect(insert({ itemId: rent.id })).rejects.toThrow(); // one per item and month
  });

  it("goes when its category or item is deleted", async () => {
    const { db, rent } = await world();
    const [mine] = await db
      .insert(schema.categories)
      .values({ name: "Mijn hobby", type: "expense" })
      .returning();
    await db.insert(schema.planOverrides).values([
      { categoryId: mine.id, month: "2026-12", amount: 1 },
      { itemId: rent.id, month: "2026-12", amount: 2 },
    ]);
    await db.delete(schema.categories).where(eq(schema.categories.id, mine.id));
    await db.delete(schema.recurringItems).where(eq(schema.recurringItems.id, rent.id));
    expect(await db.select().from(schema.planOverrides)).toEqual([]);
  });
});
