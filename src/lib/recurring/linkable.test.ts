import { describe, expect, it } from "vitest";
import { createRecurringItem } from "./items";
import { listLinkableTransactions } from "./linkable";
import { setup } from "./test-utils";

const TODAY = "2026-10-31";

describe("listLinkableTransactions", () => {
  it("lists the latest of each name and amount once, newest first, with how often it happened", async () => {
    const { db, tx } = await setup();
    await tx("2026-08-01", -65000, { counterparty: "Verhuurder" });
    await tx("2026-09-01", -65000, { counterparty: "Verhuurder" });
    await tx("2026-10-01", -65000, { counterparty: "Verhuurder" });
    await tx("2026-10-05", 120000, { counterparty: "Featurn B.V." });
    const list = await listLinkableTransactions(db, { today: TODAY });
    expect(list.map((x) => [x.counterparty, x.amount, x.date, x.count])).toEqual([
      ["Featurn B.V.", 120000, "2026-10-05", 1],
      ["Verhuurder", -65000, "2026-10-01", 3],
    ]);
  });

  it("leaves out transfers between own accounts, old transactions and rows already linked to a fixed item", async () => {
    const { db, tx } = await setup();
    await tx("2026-10-02", -20000, { counterparty: "Revolut**1234*", isInternalTransfer: true });
    await tx("2025-01-02", -1000, { counterparty: "Way back" });
    await tx("2026-10-03", -999, { counterparty: "Spotify" });
    await tx("2026-10-04", -4500, { counterparty: "Gym" });
    await createRecurringItem(
      db,
      {
        name: "Spotify",
        type: "expense",
        matchCounterparty: "Spotify",
        expectedAmount: 999,
        dayOfMonth: 3,
        startDate: "2026-10-01",
      },
      { today: TODAY },
    );
    const list = await listLinkableTransactions(db, { today: TODAY });
    expect(list.map((x) => x.counterparty)).toEqual(["Gym"]);
  });
});
