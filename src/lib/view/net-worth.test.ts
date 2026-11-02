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

  describe("BTW in net worth", () => {
    async function world() {
      const w = await setup();
      const savings = await w.cat("Spaarrekening");
      const taxes = await w.cat("Belastingen");
      // The account's balance after the newest row: 1,000.00.
      await w.tx("2026-07-01", 100000, { balanceAfter: 100000 });
      const pocket = (date: string, amount: number) =>
        w.tx(date, amount, {
          counterparty: "To EUR BTW",
          categoryId: savings,
          isInternalTransfer: true,
        });
      return { ...w, pocket, taxes };
    }

    it("takes off the BTW still owed and adds what is in the pocket: money not yet paid to the tax office is not yours", async () => {
      const w = await world();
      await w.tx("2026-08-01", 200000, { counterparty: "Featurn B.V." });
      await w.pocket("2026-08-05", -10000);
      const n = await loadNetWorth(w.db, "2026-10-20");
      // Owed: 200000 x 21 / 121 = 34711. In the pocket: 10000.
      expect(n.btw).toEqual({ owed: 34711, pocket: 10000, paid: false, net: 10000 - 34711 });
      expect(n.total).toBe(n.accountsTotal + n.savings.saved + 10000 - 34711);
    });

    it("counts a spare pocket as money once nothing is owed", async () => {
      const w = await world();
      await w.pocket("2026-08-05", -50000);
      const n = await loadNetWorth(w.db, "2026-10-20");
      expect(n.btw).toMatchObject({ owed: 0, pocket: 50000, net: 50000 });
      expect(n.total).toBe(n.accountsTotal + n.savings.saved + 50000);
    });

    it("owes nothing for a quarter that is paid, whatever the pocket says", async () => {
      const w = await world();
      await w.tx("2026-08-01", 200000, { counterparty: "Featurn B.V." });
      await w.pocket("2026-08-05", -34711);
      await w.tx("2026-10-25", -34711, { counterparty: "Belastingdienst", categoryId: w.taxes });
      const n = await loadNetWorth(w.db, "2026-10-26");
      expect(n.btw.paid).toBe(true);
      expect(n.btw.net).toBe(n.btw.pocket);
    });

    it("changes nothing for someone without BTW data", async () => {
      const w = await world();
      const n = await loadNetWorth(w.db, "2026-10-20");
      expect(n.btw).toEqual({ owed: 0, pocket: 0, paid: false, net: 0 });
      expect(n.total).toBe(n.accountsTotal + n.savings.saved);
    });
  });
});
