import { describe, expect, it } from "vitest";
import { generateOccurrences } from "./occurrences";
import { syncRecurring } from "./sync";
import { setup } from "./test-utils";

describe("syncRecurring catches up on its own", () => {
  it("links an income that arrived 10 days after its expected day, with no new upload (15-day window for income)", async () => {
    const { db, tx, addItem, occ } = await setup();
    // The item was added when matching only allowed 5 days: its October occurrence is still open.
    const item = await addItem({
      name: "featurn B.V.",
      type: "income",
      matchCounterparty: "featurn B.V.",
      expectedAmount: 96800,
      tolerance: 9680,
      dayOfMonth: 4,
      startDate: "2026-10-01",
    });
    await generateOccurrences(db, { throughMonth: "2026-10" });
    const payment = await tx("2026-10-14", 96800, { counterparty: "featurn B.V." });
    expect((await occ(item.id, "2026-10")).status).toBe("expected");

    const result = await syncRecurring(db, { throughMonth: "2026-10", today: "2026-10-31" });
    expect(result.matched).toBe(1);
    expect(await occ(item.id, "2026-10")).toMatchObject({
      status: "matched",
      transactionId: payment.id,
    });
    // Nothing new the second time.
    expect(await syncRecurring(db, { throughMonth: "2026-10", today: "2026-10-31" })).toMatchObject(
      {
        matched: 0,
        missed: 0,
      },
    );
  });

  it("a cost 10 days late still does not match (5-day window)", async () => {
    const { db, tx, addItem, occ } = await setup();
    const item = await addItem({
      name: "Gym",
      matchCounterparty: "Gym",
      expectedAmount: 2999,
      dayOfMonth: 4,
      startDate: "2026-10-01",
    });
    await generateOccurrences(db, { throughMonth: "2026-10" });
    await tx("2026-10-14", -2999, { counterparty: "Gym" });
    await syncRecurring(db, { throughMonth: "2026-10", today: "2026-10-31" });
    expect((await occ(item.id, "2026-10")).status).not.toBe("matched");
  });
});
