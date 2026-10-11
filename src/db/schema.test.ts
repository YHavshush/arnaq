import { describe, expect, it } from "vitest";
import { createDb, schema } from "./index";

describe("database", () => {
  it("applies migrations and stores money as integer cents", () => {
    const db = createDb(":memory:");

    const [account] = db
      .insert(schema.accounts)
      .values({ name: "Test", bank: "rabobank" })
      .returning()
      .all();
    db.insert(schema.transactions)
      .values({
        accountId: account.id,
        date: "2026-10-01",
        amount: -1234,
        importHash: "hash-1",
      })
      .run();

    const [row] = db.select().from(schema.transactions).all();
    expect(row.amount).toBe(-1234);
    expect(Number.isInteger(row.amount)).toBe(true);
  });

  it("rejects a duplicate import_hash", () => {
    const db = createDb(":memory:");
    const [account] = db
      .insert(schema.accounts)
      .values({ name: "Test", bank: "revolut" })
      .returning()
      .all();
    const row = { accountId: account.id, date: "2026-10-01", amount: 100, importHash: "same" };

    db.insert(schema.transactions).values(row).run();
    expect(() => db.insert(schema.transactions).values(row).run()).toThrow();
  });
});
