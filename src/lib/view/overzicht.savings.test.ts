import { describe, expect, it } from "vitest";
import { generateOccurrences } from "@/lib/recurring/occurrences";
import { matchOccurrences } from "@/lib/recurring/matching";
import { setup } from "@/lib/recurring/test-utils";
import { loadOverzicht } from "./load";

const TODAY = "2026-10-11";
const reserve = {
  name: "BTW reserve",
  type: "expense" as const,
  matchCounterparty: "EUR BTW",
  expectedAmount: 50000,
  dayOfMonth: 5,
  startDate: "2026-01-01",
};

/** A month with some everyday spending, with or without a monthly deposit item (paid or not). */
async function home(deposit: "none" | "unpaid" | "paid") {
  const { db, addItem, cat, tx, cover } = await setup();
  await cover("2026-10");
  await tx("2026-10-02", -30000, {
    counterparty: "Supermarkt",
    categoryId: await cat("Boodschappen"),
  });
  if (deposit !== "none") {
    const savings = await cat("Spaarrekening");
    await addItem({ ...reserve, categoryId: savings });
    if (deposit === "paid")
      await tx("2026-10-05", -50000, {
        counterparty: "To EUR BTW",
        categoryId: savings,
        isInternalTransfer: true,
      });
    await generateOccurrences(db, { throughMonth: "2026-10" });
    await matchOccurrences(db);
  }
  return loadOverzicht(db, "2026-10", TODAY, "en");
}

describe("the home screen with a savings deposit item", () => {
  it.each(["unpaid", "paid"] as const)(
    "does not count a %s deposit as fixed costs or spending",
    async (deposit) => {
      const without = await home("none");
      const withDeposit = await home(deposit);
      expect(withDeposit.spent).toBe(without.spent);
      expect(withDeposit.planned).toBe(without.planned);
      expect(withDeposit.free).toBe(without.free);
      expect(withDeposit.used).toBe(without.used);
      // The Savings tile is meant to change: it shows what was set aside.
      const rest = (tiles: typeof without.tiles) => tiles.filter((t) => t.key !== "sparen");
      expect(rest(withDeposit.tiles)).toEqual(rest(without.tiles));
      expect(withDeposit.pace).toEqual(without.pace);
    },
  );
});
