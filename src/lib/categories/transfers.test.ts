import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb, schema } from "@/db";
import { detectInternalTransfers } from "./transfers";

function setup() {
  const db = createDb(":memory:");
  const [rabo] = db
    .insert(schema.accounts)
    .values({ name: "Rabo", bank: "rabobank", iban: "NL00RABO1" })
    .returning()
    .all();
  const [revo] = db
    .insert(schema.accounts)
    .values({ name: "Revo", bank: "revolut" })
    .returning()
    .all();
  let n = 0;
  const tx = (
    accountId: number,
    date: string,
    amount: number,
    extra: Partial<typeof schema.transactions.$inferInsert> = {},
  ) =>
    db
      .insert(schema.transactions)
      .values({ accountId, date, amount, importHash: `h${n++}`, ...extra })
      .returning()
      .get();
  const flagged = (id: number) =>
    db.select().from(schema.transactions).where(eq(schema.transactions.id, id)).get()!
      .isInternalTransfer;
  return { db, rabo, revo, tx, flagged };
}

describe("detectInternalTransfers", () => {
  it("pairs opposite amounts across accounts within a few days", () => {
    const { db, rabo, revo, tx, flagged } = setup();
    const out = tx(rabo.id, "2026-09-12", -20000);
    const inn = tx(revo.id, "2026-09-13", 20000);
    expect(detectInternalTransfers(db)).toBe(2);
    expect(flagged(out.id) && flagged(inn.id)).toBe(true);
    const category = db
      .select()
      .from(schema.categories)
      .where(eq(schema.categories.name, "Interne overboeking"))
      .get()!;
    expect(
      db.select().from(schema.transactions).where(eq(schema.transactions.id, out.id)).get()
        ?.categoryId,
    ).toBe(category.id);
  });

  it("does not pair across too many days, different amounts, same account or currencies", () => {
    const { db, rabo, revo, tx, flagged } = setup();
    const far = tx(rabo.id, "2026-09-01", -5000);
    tx(revo.id, "2026-09-20", 5000);
    const amount = tx(rabo.id, "2026-09-05", -5001);
    tx(revo.id, "2026-09-05", 5000);
    const same = tx(rabo.id, "2026-09-07", -700);
    tx(rabo.id, "2026-09-07", 700);
    const cur = tx(rabo.id, "2026-09-08", -900);
    tx(revo.id, "2026-09-08", 900, { currency: "USD" });
    expect(detectInternalTransfers(db)).toBe(0);
    expect([far, amount, same, cur].some((t) => flagged(t.id))).toBe(false);
  });

  it("uses each transaction in at most one pair, preferring the closest date", () => {
    const { db, rabo, revo, tx, flagged } = setup();
    const out = tx(rabo.id, "2026-09-10", -1000);
    const near = tx(revo.id, "2026-09-10", 1000);
    const far = tx(revo.id, "2026-09-12", 1000);
    expect(detectInternalTransfers(db)).toBe(2);
    expect(flagged(out.id) && flagged(near.id)).toBe(true);
    expect(flagged(far.id)).toBe(false);
  });

  it("flags a single side when the counterparty IBAN is one of our own accounts", () => {
    const { db, revo, tx, flagged } = setup();
    const t = tx(revo.id, "2026-09-02", -1500, { counterpartyIban: "NL00RABO1" });
    expect(detectInternalTransfers(db)).toBe(1);
    expect(flagged(t.id)).toBe(true);
  });

  it("is idempotent", () => {
    const { db, rabo, revo, tx } = setup();
    tx(rabo.id, "2026-09-12", -20000);
    tx(revo.id, "2026-09-12", 20000);
    detectInternalTransfers(db);
    expect(detectInternalTransfers(db)).toBe(0);
  });
});
