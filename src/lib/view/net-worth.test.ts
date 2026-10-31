import { describe, expect, it } from "vitest";
import { schema } from "@/db";
import { setSavingsAnchor } from "@/lib/savings/settings";
import { setup } from "@/lib/recurring/test-utils";
import { loadNetWorth } from "./load";

describe("loadNetWorth", () => {
  it("lists each account's balance with its date, and adds the savings: balance on the statement plus moves since", async () => {
    const { db, tx, cat } = await setup();
    const [revolut] = await db
      .insert(schema.accounts)
      .values({ name: "Revolut", bank: "revolut" })
      .returning();
    // Rabobank (the account setup made): two transactions, the newest leaves 1,000.00.
    await tx("2026-10-20", -5000, { balanceAfter: 110000 });
    await tx("2026-10-27", -10000, { balanceAfter: 100000 });
    // Revolut: the newest transaction leaves 205.13.
    await db.insert(schema.transactions).values({
      accountId: revolut.id,
      date: "2026-10-28",
      amount: -1000,
      balanceAfter: 20513,
      importHash: "r1",
    });
    await setSavingsAnchor(db, { amount: 20085, asOf: "2026-10-29" });
    // 100 euro taken out of savings after the statement day: savings go down.
    await tx("2026-10-30", 10000, {
      categoryId: await cat("Spaarrekening"),
      isInternalTransfer: true,
    });

    const w = await loadNetWorth(db, "2026-10-31");
    expect(w.accounts.map((a) => [a.name, a.balance, a.asOf])).toEqual([
      ["Rabo", 100000, "2026-10-27"],
      ["Revolut", 20513, "2026-10-28"],
    ]);
    expect(w.accountsTotal).toBe(120513);
    expect(w.savings).toMatchObject({
      base: 20085,
      baseDate: "2026-10-29",
      fromStatement: true,
      since: -10000,
      saved: 10085,
      moves: 1,
    });
    expect(w.total).toBe(120513 + 10085);
  });

  it("is empty for a person without balances or savings", async () => {
    const { db } = await setup();
    const w = await loadNetWorth(db, "2026-10-31");
    expect(w).toMatchObject({ accounts: [], total: 0, hasAny: false });
  });
});
