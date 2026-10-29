import { describe, expect, it } from "vitest";
import { setup } from "./test-utils";
import { detectSuggestions } from "./suggestions";

const TODAY = "2026-10-20";

async function run(
  rows: [date: string, amount: number][],
  counterparty = "Payment from Voorbeeld Opdrachtgever",
) {
  const { db, tx } = await setup();
  for (const [date, amount] of rows) await tx(date, amount, { counterparty });
  return detectSuggestions(db, { today: TODAY });
}

describe("income suggestions allow the drift real income has", () => {
  it("suggests a monthly income that arrives on different days (the 10th, the 1st, the 5th)", async () => {
    const found = await run([
      ["2026-08-10", 50000],
      ["2026-09-01", 50000],
      ["2026-10-05", 50000],
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ type: "income", expectedAmount: 50000 });
  });

  it("allows the amount to vary a little more than a direct debit does", async () => {
    const found = await run([
      ["2026-08-05", 45000],
      ["2026-09-05", 50000],
      ["2026-10-05", 56000],
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ type: "income", expectedAmount: 50000 });
  });

  it("still refuses income that is all over the place", async () => {
    expect(
      await run([
        ["2026-08-05", 20000],
        ["2026-09-05", 90000],
        ["2026-10-05", 50000],
      ]),
    ).toHaveLength(0);
    expect(
      await run([
        ["2026-08-02", 50000],
        ["2026-09-20", 50000],
        ["2026-10-04", 50000],
      ]),
    ).toHaveLength(0);
  });

  it("does not loosen anything for costs: the same drift is not a fixed cost", async () => {
    expect(
      await run(
        [
          ["2026-08-10", -50000],
          ["2026-09-01", -50000],
          ["2026-10-05", -50000],
        ],
        "Voorbeeld Verhuurder",
      ),
    ).toHaveLength(0);
  });
});
