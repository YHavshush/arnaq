import { describe, expect, it } from "vitest";
import { TEST_USER_A, TEST_USER_B, createDb, schema, type Db } from "@/db";
import { withUser } from "@/db/scoped";
import { deleteAllMyData } from "@/lib/account";
import { buildExport } from "@/lib/export";
import { restoreFromBackup } from "@/lib/restore";
import { getIncomeTaxPayments, setIncomeTaxPaymentYear } from "./payments";
import { getIncomeTaxSettings, setIncomeTaxSettings } from "./settings";
import { addIncomeTaxYear, getIncomeTaxYears } from "./years";

/** Person A with two tax years, their own settings and one payment picked as income tax (invented numbers). */
async function seeded() {
  const db = await createDb(":memory:", { user: null });
  await withUser(db, TEST_USER_A, async (tx) => {
    const [acct] = await tx
      .insert(schema.accounts)
      .values({ name: "Rabo", bank: "rabobank" })
      .returning();
    const [paid] = await tx
      .insert(schema.transactions)
      .values({
        accountId: acct.id,
        date: "2026-07-10",
        amount: -84000,
        counterparty: "Belastingdienst",
        importHash: "h-aanslag",
      })
      .returning();
    await addIncomeTaxYear(tx, { year: 2025, rate: 0, knownAmount: 84000 });
    await addIncomeTaxYear(tx, { year: 2026, rate: 490 });
    await setIncomeTaxSettings(tx, { pocket: "IB pot", potInSavings: true });
    await setIncomeTaxPaymentYear(tx, paid.id, 2025);
  });
  const backup = JSON.parse(
    JSON.stringify(await withUser(db, TEST_USER_A, (tx) => buildExport(tx))),
  );
  return { db, backup };
}

const stateOf = async (tx: Db) => ({
  years: (await getIncomeTaxYears(tx)).map(({ year, rate, knownAmount }) => ({
    year,
    rate,
    knownAmount,
  })),
  settings: await getIncomeTaxSettings(tx),
  payments: (await getIncomeTaxPayments(tx)).map(({ date, amount, year }) => ({
    date,
    amount,
    year,
  })),
});

const DEFAULTS = { on: true, pocket: "Inkomstenbelasting", potInSavings: false };

describe("the income tax reserve in a backup", () => {
  it("a version 12 backup brings back the tax years, the settings and the picked payments", async () => {
    const { db, backup } = await seeded();
    expect(backup.version).toBe(12);
    expect(backup.tables.incomeTaxYears[0]).not.toHaveProperty("userId");
    await withUser(db, TEST_USER_B, (tx) => restoreFromBackup(tx, backup));
    const ofB = await withUser(db, TEST_USER_B, stateOf);
    expect(ofB).toEqual(await withUser(db, TEST_USER_A, stateOf));
    expect(ofB).toEqual({
      years: [
        { year: 2025, rate: 0, knownAmount: 84000 },
        { year: 2026, rate: 490, knownAmount: null },
      ],
      settings: { on: true, pocket: "IB pot", potInSavings: true },
      payments: [{ date: "2026-07-10", amount: 84000, year: 2025 }],
    });
  });

  it("an older backup restores with income tax off: no years, the default settings, nothing picked", async () => {
    const { db, backup } = await seeded();
    const old = JSON.parse(JSON.stringify(backup));
    old.version = 11;
    delete old.tables.incomeTaxYears;
    for (const k of ["incomeTaxOn", "incomeTaxPocket", "incomeTaxPotInSavings"])
      delete old.tables.userSettings[0][k];
    for (const r of old.tables.transactions) delete r.incomeTaxYear;
    await withUser(db, TEST_USER_B, (tx) => restoreFromBackup(tx, old));
    expect(await withUser(db, TEST_USER_B, stateOf)).toEqual({
      years: [],
      settings: DEFAULTS,
      payments: [],
    });
  });

  it("a damaged backup never crashes: bad entries are skipped", async () => {
    const { db, backup } = await seeded();
    const damaged = JSON.parse(JSON.stringify(backup));
    damaged.tables.incomeTaxYears = [
      { year: "2026", rate: 490 },
      { year: 2026, rate: 99999 },
      { year: 1999, rate: 490 },
      { year: 2026, rate: 490, knownAmount: -5 },
      null,
      [],
      { year: 2026, rate: 490 },
      { year: 2026, rate: 650 },
    ];
    damaged.tables.userSettings[0].incomeTaxOn = "yes";
    damaged.tables.userSettings[0].incomeTaxPocket = "...";
    damaged.tables.userSettings[0].incomeTaxPotInSavings = 1;
    for (const r of damaged.tables.transactions) r.incomeTaxYear = 1800;
    await withUser(db, TEST_USER_B, (tx) => restoreFromBackup(tx, damaged));
    expect(await withUser(db, TEST_USER_B, stateOf)).toEqual({
      years: [{ year: 2026, rate: 490, knownAmount: null }],
      settings: DEFAULTS,
      payments: [],
    });

    const notAList = JSON.parse(JSON.stringify(backup));
    notAList.tables.incomeTaxYears = "nope";
    await withUser(db, TEST_USER_B, (tx) => restoreFromBackup(tx, notAList));
    expect((await withUser(db, TEST_USER_B, stateOf)).years).toEqual([]);
  });

  it("erase all data removes the tax years and the settings, and leaves the other person's", async () => {
    const { db } = await seeded();
    await withUser(db, TEST_USER_B, (tx) => addIncomeTaxYear(tx, { year: 2026, rate: 650 }));
    await withUser(db, TEST_USER_A, (tx) => deleteAllMyData(tx));
    expect(await withUser(db, TEST_USER_A, stateOf)).toEqual({
      years: [],
      settings: DEFAULTS,
      payments: [],
    });
    expect((await withUser(db, TEST_USER_B, stateOf)).years).toEqual([
      { year: 2026, rate: 650, knownAmount: null },
    ]);
  });
});
