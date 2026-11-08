import { describe, expect, it } from "vitest";
import { replaceBtwClients } from "@/lib/btw/clients";
import { setup } from "@/lib/recurring/test-utils";
import { loadNetWorth } from "@/lib/view/load";
import { getForecast } from "./forecast";

const TODAY = "2026-10-20";

/**
 * Invented numbers. The client pays each invoice early the next month: 2,000.00 on 3 July (June's invoice), 1,000.00
 * on 3 August, 3 September and 3 October. From November the client's invoice of 2,420.00 is a fixed income item on the
 * 3rd (BTW inside it: 420.00). The third quarter (due 31 October) is not paid yet.
 */
async function world(paymentLag: 0 | 1) {
  const s = await setup();
  await replaceBtwClients(s.db, [{ name: "Featurn", paymentLag, vatPercent: 21 }]);
  await s.cover("2026-07", "2026-09");
  const paid = (date: string, amount: number) =>
    s.tx(date, amount, { counterparty: "Featurn B.V." });
  await paid("2026-07-03", 200000);
  await paid("2026-08-03", 100000);
  await paid("2026-09-03", 100000);
  await paid("2026-10-03", 100000);
  await s.addItem({
    name: "Featurn invoice",
    type: "income",
    matchCounterparty: "Featurn B.V.",
    expectedAmount: 242000,
    dayOfMonth: 3,
    startDate: "2026-11-01",
    categoryId: await s.cat("Salaris / bijbaan"),
  });
  const forecast = await getForecast(s.db, { today: TODAY, months: 2, pastMonths: 1 });
  return { ...s, forecast };
}

describe("getForecast with a payment lag", () => {
  it("the BTW owed now follows the lag: lag 0 counts July to September's money, lag 1 August to October's", async () => {
    const lag0 = await world(0);
    const lag1 = await world(1);
    expect(lag0.forecast.btwNow).toBe(-69421); // 400000 x 21 / 121
    expect(lag1.forecast.btwNow).toBe(-52066); // 300000 x 21 / 121
    // The forecast and the net worth card agree for every lag.
    expect(lag1.forecast.btwNow).toBe((await loadNetWorth(lag1.db, TODAY)).btw.net);
  });

  it("the BTW on money still expected builds up in the month it arrives, for every lag", async () => {
    const accrued = (f: Awaited<ReturnType<typeof world>>["forecast"]) =>
      f.months.map((m) => [m.month, m.btwAccrued]);
    const lag0 = await world(0);
    const lag1 = await world(1);
    expect(accrued(lag1.forecast)).toEqual([
      ["2026-09", 0],
      ["2026-10", 0],
      ["2026-11", 42000],
      ["2026-12", 42000],
    ]);
    expect(accrued(lag0.forecast)).toEqual(accrued(lag1.forecast));
    // So the BTW part of net worth ahead differs only by what is owed now.
    const dec = (f: typeof lag0.forecast) => f.months.at(-1)!.btwWorth;
    expect(dec(lag1.forecast) - dec(lag0.forecast)).toBe(-52066 - -69421);
    expect(dec(lag1.forecast)).toBe(-52066 - 2 * 42000);
  });
});
