import { describe, expect, it } from "vitest";
import { setup } from "@/lib/recurring/test-utils";
import { checkSavingsBalance } from "./check";
import { setSavingsAnchor } from "./settings";

async function world() {
  const s = await setup();
  const savings = await s.cat("Spaarrekening");
  /** A move to savings (money out of the current account) or from savings (money in). */
  const move = (date: string, amount: number, name = "To Instant Access Savings") =>
    s.tx(date, amount, { counterparty: name, categoryId: savings, isInternalTransfer: true });
  return { ...s, move };
}

describe("checkSavingsBalance", () => {
  it("has nothing to compare with for the first balance, or for an older statement", async () => {
    const w = await world();
    expect(await checkSavingsBalance(w.db, { amount: 20000, asOf: "2026-10-12" })).toBeNull();
    await setSavingsAnchor(w.db, { amount: 20000, asOf: "2026-10-12" });
    expect(await checkSavingsBalance(w.db, { amount: 15000, asOf: "2026-10-01" })).toBeNull();
    expect(await checkSavingsBalance(w.db, { amount: 15000, asOf: "2026-10-12" })).toBeNull();
  });

  it("matches when the previous balance plus the sorted moves is what the statement says", async () => {
    const w = await world();
    await setSavingsAnchor(w.db, { amount: 20000, asOf: "2026-10-12" });
    await w.move("2026-10-15", -30000); // 300 into savings
    await w.move("2026-10-20", 10000, "From Instant Access Savings"); // 100 out
    await w.move("2026-10-10", -99900); // before the last statement: already inside its balance
    const check = await checkSavingsBalance(w.db, { amount: 40000, asOf: "2026-10-29" });
    expect(check).toMatchObject({
      expected: 40000,
      actual: 40000,
      difference: 0,
      status: "match",
      from: "2026-10-12",
      asOf: "2026-10-29",
    });
  });

  it("takes a little extra for interest, and flags a bigger gap", async () => {
    const w = await world();
    await setSavingsAnchor(w.db, { amount: 20000, asOf: "2026-10-12" });
    expect(await checkSavingsBalance(w.db, { amount: 20085, asOf: "2026-10-29" })).toMatchObject({
      difference: 85,
      status: "interest",
    });
    expect(await checkSavingsBalance(w.db, { amount: 30000, asOf: "2026-10-29" })).toMatchObject({
      difference: 10000,
      status: "off",
    });
    // Less than expected is never interest.
    expect(await checkSavingsBalance(w.db, { amount: 19000, asOf: "2026-10-29" })).toMatchObject({
      difference: -1000,
      status: "off",
    });
  });

  it("counts BTW moves too, because the statement's balance holds them", async () => {
    const w = await world();
    await setSavingsAnchor(w.db, { amount: 20000, asOf: "2026-10-12" });
    await w.move("2026-10-15", -40000, "To EUR BTW");
    expect(await checkSavingsBalance(w.db, { amount: 60000, asOf: "2026-10-29" })).toMatchObject({
      status: "match",
    });
  });
});
