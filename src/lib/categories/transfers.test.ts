import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { one, createDb, schema } from "@/db";
import { detectInternalTransfers } from "./transfers";

async function setup() {
  const db = await createDb(":memory:");
  const [rabo] = await db
    .insert(schema.accounts)
    .values({ name: "Rabo", bank: "rabobank", iban: "NL00RABO1" })
    .returning();
  const [revo] = await db
    .insert(schema.accounts)
    .values({ name: "Revo", bank: "revolut" })
    .returning();
  let n = 0;
  const tx = async (
    accountId: number,
    date: string,
    amount: number,
    extra: Partial<typeof schema.transactions.$inferInsert> = {},
  ) =>
    await one(
      db
        .insert(schema.transactions)
        .values({ accountId, date, amount, importHash: `h${n++}`, ...extra })
        .returning(),
    );
  const flagged = async (id: number) =>
    (await one(db.select().from(schema.transactions).where(eq(schema.transactions.id, id))))!
      .isInternalTransfer;
  return { db, rabo, revo, tx, flagged };
}

describe("detectInternalTransfers", () => {
  it("pairs opposite amounts across accounts within a few days", async () => {
    const { db, rabo, revo, tx, flagged } = await setup();
    const out = await tx(rabo.id, "2026-09-12", -20000);
    const inn = await tx(revo.id, "2026-09-13", 20000);
    expect(await detectInternalTransfers(db)).toBe(2);
    expect((await flagged(out.id)) && (await flagged(inn.id))).toBe(true);
    const category = (await one(
      db.select().from(schema.categories).where(eq(schema.categories.name, "Interne overboeking")),
    ))!;
    expect(
      (await one(db.select().from(schema.transactions).where(eq(schema.transactions.id, out.id))))
        ?.categoryId,
    ).toBe(category.id);
  });

  it("does not pair across too many days, different amounts, same account or currencies", async () => {
    const { db, rabo, revo, tx, flagged } = await setup();
    const far = await tx(rabo.id, "2026-09-01", -5000);
    await tx(revo.id, "2026-09-20", 5000);
    const amount = await tx(rabo.id, "2026-09-05", -5001);
    await tx(revo.id, "2026-09-05", 5000);
    const same = await tx(rabo.id, "2026-09-07", -700);
    await tx(rabo.id, "2026-09-07", 700);
    const cur = await tx(rabo.id, "2026-09-08", -900);
    await tx(revo.id, "2026-09-08", 900, { currency: "USD" });
    expect(await detectInternalTransfers(db)).toBe(0);
    for (const t of [far, amount, same, cur]) expect(await flagged(t.id)).toBe(false);
  });

  it("uses each transaction in at most one pair, preferring the closest date", async () => {
    const { db, rabo, revo, tx, flagged } = await setup();
    const out = await tx(rabo.id, "2026-09-10", -1000);
    const near = await tx(revo.id, "2026-09-10", 1000);
    const far = await tx(revo.id, "2026-09-12", 1000);
    expect(await detectInternalTransfers(db)).toBe(2);
    expect((await flagged(out.id)) && (await flagged(near.id))).toBe(true);
    expect(await flagged(far.id)).toBe(false);
  });

  it("flags a single side when the counterparty IBAN is one of our own accounts", async () => {
    const { db, revo, tx, flagged } = await setup();
    const t = await tx(revo.id, "2026-09-02", -1500, { counterpartyIban: "NL00RABO1" });
    expect(await detectInternalTransfers(db)).toBe(1);
    expect(await flagged(t.id)).toBe(true);
  });

  it("is idempotent", async () => {
    const { db, rabo, revo, tx } = await setup();
    await tx(rabo.id, "2026-09-12", -20000);
    await tx(revo.id, "2026-09-12", 20000);
    await detectInternalTransfers(db);
    expect(await detectInternalTransfers(db)).toBe(0);
  });
});
