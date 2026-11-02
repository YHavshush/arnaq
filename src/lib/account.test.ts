import { describe, expect, it } from "vitest";
import { TEST_USER_B, createDb, schema } from "@/db";
import { withUser } from "@/db/scoped";
import { deleteAllMyData } from "./account";

describe("deleteAllMyData", () => {
  it("deletes one person's data, leaves everyone else's, and starts them fresh with default categories", async () => {
    const db = await createDb(":memory:", { user: null });
    const seed = async (user: string, name: string) =>
      withUser(db, user, async (tx) => {
        const [acct] = await tx
          .insert(schema.accounts)
          .values({ name, bank: "rabobank" })
          .returning();
        const [item] = await tx
          .insert(schema.recurringItems)
          .values({
            name: "Huur",
            type: "expense",
            expectedAmount: 1,
            dayOfMonth: 1,
            startDate: "2026-01-01",
          })
          .returning();
        const [occ] = await tx
          .insert(schema.recurringOccurrences)
          .values({
            recurringItemId: item.id,
            month: "2026-10",
            expectedDate: "2026-10-01",
            expectedAmount: 1,
            status: "matched",
          })
          .returning();
        await tx.insert(schema.transactions).values({
          accountId: acct.id,
          date: "2026-10-01",
          amount: -1,
          importHash: `h-${name}`,
          matchedOccurrenceId: occ.id,
        });
        await tx.insert(schema.merchantLabels).values({ merchantKey: "x", source: "model" });
        await tx
          .insert(schema.planOverrides)
          .values({ itemId: item.id, month: "2026-12", amount: 5 });
      });
    await seed("11111111-1111-1111-1111-111111111111", "mine");
    await seed(TEST_USER_B, "theirs");

    await withUser(db, "11111111-1111-1111-1111-111111111111", (tx) => deleteAllMyData(tx));

    const mine = await withUser(db, "11111111-1111-1111-1111-111111111111", async (tx) => ({
      accounts: (await tx.select().from(schema.accounts)).length,
      transactions: (await tx.select().from(schema.transactions)).length,
      labels: (await tx.select().from(schema.merchantLabels)).length,
      categories: (await tx.select().from(schema.categories)).length,
      plan: (await tx.select().from(schema.planOverrides)).length,
    }));
    expect(mine).toMatchObject({ accounts: 0, transactions: 0, labels: 0, plan: 0 });
    expect(mine.categories).toBeGreaterThan(10); // fresh defaults

    const theirs = await withUser(db, TEST_USER_B, async (tx) => ({
      accounts: (await tx.select().from(schema.accounts)).map((a) => a.name),
      transactions: (await tx.select().from(schema.transactions)).length,
      plan: (await tx.select().from(schema.planOverrides)).length,
    }));
    expect(theirs).toEqual({ accounts: ["theirs"], transactions: 1, plan: 1 });
  });
});
