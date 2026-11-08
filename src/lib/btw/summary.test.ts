import { describe, expect, it } from "vitest";
import { setup } from "@/lib/recurring/test-utils";
import { replaceBtwClients } from "./clients";
import { setBtwSettings } from "./settings";
import { btwQuarter, getBtwSummary } from "./summary";

describe("btwQuarter (the quarter the card is about)", () => {
  it("is the quarter whose payment is next due, until its due date has passed", () => {
    expect(btwQuarter("2026-10-29")).toMatchObject({
      label: "2026-Q3",
      from: "2026-07-01",
      to: "2026-09-30",
      due: "2026-10-31",
    });
    expect(btwQuarter("2026-10-31").label).toBe("2026-Q3");
    expect(btwQuarter("2026-11-01")).toMatchObject({ label: "2026-Q4", due: "2027-01-31" });
    expect(btwQuarter("2027-02-15")).toMatchObject({
      label: "2027-Q1",
      from: "2027-01-01",
      to: "2027-03-31",
      due: "2027-04-30",
    });
  });
  it("covers the year ends", () => {
    expect(btwQuarter("2026-01-10")).toMatchObject({ label: "2025-Q4", due: "2026-01-31" });
    expect(btwQuarter("2026-05-02")).toMatchObject({ label: "2026-Q2", due: "2026-07-31" });
  });
});

describe("getBtwSummary", () => {
  async function world() {
    const s = await setup();
    const savings = await s.cat("Spaarrekening");
    const taxes = await s.cat("Belastingen");
    const income = (date: string, amount: number, name = "Featurn B.V.") =>
      s.tx(date, amount, { counterparty: name });
    const pocket = (date: string, amount: number, name = "To EUR BTW") =>
      s.tx(date, amount, {
        counterparty: name,
        categoryId: savings,
        isInternalTransfer: true,
      });
    const tax = (date: string, amount: number) =>
      s.tx(date, amount, { counterparty: "Belastingdienst", categoryId: taxes });
    return { ...s, income, pocket, tax };
  }
  const run = (db: Awaited<ReturnType<typeof world>>["db"], today: string) =>
    getBtwSummary(db, { today });

  it("is the BTW inside what Featurn paid in the quarter (21 of every 121), in whole cents, ignoring other money", async () => {
    const w = await world();
    await w.income("2026-07-15", 100001);
    await w.income("2026-09-30", 50000);
    await w.income("2026-10-01", 99999); // next quarter
    await w.income("2026-08-01", 70000, "Gift from Mum"); // not the client
    await w.income("2026-08-02", -3000, "Featurn B.V."); // money out, not received
    const s = await run(w.db, "2026-10-20");
    expect(s.received).toBe(150001);
    expect(s.owed).toBe(26033); // 150001 x 21 / 121 = 26033.2 rounded
    expect(s.hasData).toBe(true);
  });

  it("counts what is in the BTW pocket (in minus out) and what is still to set aside", async () => {
    const w = await world();
    await w.income("2026-08-01", 200000);
    await w.pocket("2026-08-05", -20000);
    await w.pocket("2026-09-05", -15000);
    await w.pocket("2026-09-20", 3000, "From EUR BTW");
    await w.pocket("2026-09-21", -99900, "To Instant Access Savings"); // another savings pot
    const s = await run(w.db, "2026-10-20");
    expect(s.owed).toBe(34711); // 200000 x 21 / 121
    expect(s.pocket).toBe(32000);
    expect(s.toSetAside).toBe(2711);
    expect(s.paid).toBeNull();
  });

  it("has nothing to set aside once the pocket covers it, and keeps the surplus", async () => {
    const w = await world();
    await w.income("2026-08-01", 100000);
    await w.pocket("2026-08-05", -30000);
    const s = await run(w.db, "2026-10-20");
    expect(s.toSetAside).toBe(0);
    expect(s.pocket - s.owed).toBe(12645); // 100000 x 21 / 121 = 17355 owed
  });

  it("recognises the payment to the Belastingdienst and shows what came from the person's own money", async () => {
    const w = await world();
    await w.income("2026-08-01", 200000);
    await w.pocket("2026-09-10", -30000);
    await w.pocket("2026-10-05", 25000, "From EUR BTW"); // pulled out to pay
    await w.tax("2026-10-06", -42000);
    const s = await run(w.db, "2026-10-20");
    expect(s.paid).toEqual({ amount: 42000, date: "2026-10-06" });
    expect(s.pocket).toBe(5000); // left in the pocket
    expect(s.toSetAside).toBe(0); // paid: nothing more to set aside
    expect(s.fromOwnMoney).toBe(17000); // paid 420, 250 came out of the pocket
  });

  it("ignores a payment to the Belastingdienst from before the quarter ended", async () => {
    const w = await world();
    await w.income("2026-08-01", 100000);
    await w.tax("2026-09-15", -1500);
    expect((await run(w.db, "2026-10-20")).paid).toBeNull();
  });

  it("is quiet when the person has nothing to do with it", async () => {
    const w = await world();
    await w.tx("2026-08-01", -2000, { counterparty: "Lidl" });
    const s = await run(w.db, "2026-10-20");
    expect(s).toMatchObject({ hasData: false, received: 0, owed: 0, pocket: 0 });
  });

  it("matches on the person's own words, not only the defaults", async () => {
    const w = await world();
    await w.income("2026-08-01", 100000, "Acme Consulting");
    await w.pocket("2026-08-05", -5000, "To Tax pot");
    const s = await getBtwSummary(w.db, {
      today: "2026-10-20",
      clients: [{ name: "acme", paymentLag: 0, vatPercent: 21 }],
      pocketMatch: "tax pot",
    });
    expect(s).toMatchObject({ received: 100000, owed: 17355, pocket: 5000 });
  });

  it("follows the client and pocket word the person saved", async () => {
    const w = await world();
    await w.income("2026-08-01", 100000, "Acme Consulting");
    await w.pocket("2026-08-05", -5000, "To Tax pot");
    await replaceBtwClients(w.db, [{ name: "Acme", paymentLag: 0, vatPercent: 21 }]);
    await setBtwSettings(w.db, { pocket: "Tax pot" });
    expect(await run(w.db, "2026-10-20")).toMatchObject({
      received: 100000,
      owed: 17355,
      pocket: 5000,
    });
  });

  it("does not count what the tax office takes every month (a 20 euro instalment) as the BTW payment", async () => {
    const w = await world();
    await w.income("2026-08-01", 138000);
    // 20 euro on the 27th of four months in a row, then the real BTW payment.
    for (const d of ["2026-07-27", "2026-08-27", "2026-09-27", "2026-10-27"]) await w.tax(d, -2000);
    await w.tax("2026-10-29", -30000);
    const s = await run(w.db, "2026-10-30");
    expect(s.paid).toEqual({ amount: 30000, date: "2026-10-29" });
    expect(s.fromOwnMoney).toBe(30000);
  });
});

describe("getBtwSummary with a payment lag (the client pays about a month after the invoice)", () => {
  async function world(paymentLag: 0 | 1 | 2) {
    const s = await setup();
    const taxes = await s.cat("Belastingen");
    await replaceBtwClients(s.db, [{ name: "Featurn", paymentLag, vatPercent: 21 }]);
    const income = (date: string, amount: number) =>
      s.tx(date, amount, { counterparty: "Featurn B.V." });
    const tax = (date: string, amount: number) =>
      s.tx(date, amount, { counterparty: "Belastingdienst", categoryId: taxes });
    // Invoices dated September to December (invented amounts), each paid early the next month.
    await income("2026-10-03", 121000); // September's invoice: the third quarter
    await income("2026-11-03", 242000); // October's
    await income("2026-12-03", 363000); // November's
    await income("2027-01-05", 484000); // December's
    return { ...s, income, tax };
  }

  it("lag 1: the fourth quarter is the money that arrived in November to January", async () => {
    const w = await world(1);
    const s = await getBtwSummary(w.db, { today: "2027-01-20" });
    expect(s.quarter).toMatchObject({ label: "2026-Q4", from: "2026-10-01", to: "2026-12-31" });
    expect(s.receipts).toEqual({ from: "2026-11-01", to: "2027-01-31" });
    expect(s.received).toBe(242000 + 363000 + 484000);
    expect(s.owed).toBe(189000); // 1089000 x 21 / 121
  });

  it("lag 0: the same money, counted by the calendar quarter it arrived in (as before)", async () => {
    const w = await world(0);
    const s = await getBtwSummary(w.db, { today: "2027-01-20" });
    expect(s.receipts).toEqual({ from: "2026-10-01", to: "2026-12-31" });
    expect(s.received).toBe(121000 + 242000 + 363000);
    expect(s.owed).toBe(126000); // 726000 x 21 / 121
  });

  it("lag 1: October's money counts for the third quarter", async () => {
    const w = await world(1);
    const s = await getBtwSummary(w.db, { today: "2026-10-20" });
    expect(s.quarter.label).toBe("2026-Q3");
    expect(s.receipts).toEqual({ from: "2026-08-01", to: "2026-10-31" });
    expect(s.received).toBe(121000);
  });

  it("lag 2: the fourth quarter is the money that arrived in December to February", async () => {
    const w = await world(2);
    await w.income("2027-02-04", 121000);
    await w.income("2027-03-04", 99999); // the first quarter's
    const s = await getBtwSummary(w.db, { today: "2027-01-20" });
    expect(s.receipts).toEqual({ from: "2026-12-01", to: "2027-02-28" });
    expect(s.received).toBe(363000 + 484000 + 121000);
  });

  it("does not move the due date or where the payment to the tax office is looked for", async () => {
    const w = await world(1);
    // Inside the receipt window, but before the quarter ended: not this quarter's payment.
    await w.tax("2026-12-20", -5000);
    expect((await getBtwSummary(w.db, { today: "2027-01-20" })).paid).toBeNull();
    await w.tax("2027-01-25", -180000);
    const s = await getBtwSummary(w.db, { today: "2027-01-28" });
    expect(s.quarter.due).toBe("2027-01-31");
    expect(s.paid).toEqual({ amount: 180000, date: "2027-01-25" });
  });

  it("says whether all of the quarter's money is in: only once its receipt window has ended", async () => {
    const lag1 = await world(1);
    expect((await getBtwSummary(lag1.db, { today: "2026-11-20" })).complete).toBe(false);
    expect((await getBtwSummary(lag1.db, { today: "2027-01-31" })).complete).toBe(false);
    expect((await getBtwSummary(lag1.db, { today: "2026-10-20" })).complete).toBe(false); // Q3 until 31 Oct
    const lag0 = await world(0);
    expect((await getBtwSummary(lag0.db, { today: "2026-10-20" })).complete).toBe(true);
    expect((await getBtwSummary(lag0.db, { today: "2026-11-20" })).complete).toBe(false);
    expect((await getBtwSummary(lag0.db, { today: "2027-01-20" })).complete).toBe(true);
  });

  it("clients passed in win over the saved ones", async () => {
    const w = await world(0);
    const s = await getBtwSummary(w.db, {
      today: "2027-01-20",
      clients: [{ name: "Featurn", paymentLag: 1, vatPercent: 21 }],
    });
    expect(s.received).toBe(1089000);
  });
});
