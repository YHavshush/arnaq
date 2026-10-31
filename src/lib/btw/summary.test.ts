import { describe, expect, it } from "vitest";
import { setup } from "@/lib/recurring/test-utils";
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
      incomeMatch: "acme",
      pocketMatch: "tax pot",
    });
    expect(s).toMatchObject({ received: 100000, owed: 17355, pocket: 5000 });
  });

  it("follows the client and pocket word the person saved", async () => {
    const w = await world();
    await w.income("2026-08-01", 100000, "Acme Consulting");
    await w.pocket("2026-08-05", -5000, "To Tax pot");
    await setBtwSettings(w.db, { client: "Acme", pocket: "Tax pot" });
    expect(await run(w.db, "2026-10-20")).toMatchObject({
      received: 100000,
      owed: 17355,
      pocket: 5000,
    });
  });
});
