import { readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb, schema } from "@/db";
import { ImportError, buildImportHashes, importCsv } from "./service";

const fixture = (name: string) =>
  readFileSync(path.join(process.cwd(), "tests/fixtures", name), "utf8");
const count = (db: ReturnType<typeof createDb>) =>
  db.select().from(schema.transactions).all().length;

describe("importCsv", () => {
  it("imports a Rabobank file, auto-creating the account from the IBAN", () => {
    const db = createDb(":memory:");
    const s = importCsv(db, { content: fixture("rabobank-sample.csv"), filename: "rabo.csv" });
    expect(s).toMatchObject({
      bank: "rabobank",
      month: "2026-09",
      rowsImported: 7,
      rowsDuplicate: 0,
      rowsSkipped: 0,
    });
    const [account] = db.select().from(schema.accounts).all();
    expect(account.iban).toBe("NL00RABO0000000001");
    expect(count(db)).toBe(7);
  });

  it("re-uploading the same month never double counts", () => {
    const db = createDb(":memory:");
    importCsv(db, { content: fixture("rabobank-sample.csv"), filename: "rabo.csv" });
    const again = importCsv(db, {
      content: fixture("rabobank-sample.csv"),
      filename: "rabo-again.csv",
    });
    expect(again).toMatchObject({ rowsImported: 0, rowsDuplicate: 7 });
    expect(count(db)).toBe(7);
    expect(db.select().from(schema.imports).all()).toHaveLength(2); // both uploads are logged
    expect(db.select().from(schema.accounts).all()).toHaveLength(1);
  });

  it("an overlapping file only adds the new rows", () => {
    const db = createDb(":memory:");
    const lines = fixture("revolut-sample.csv").trimEnd().split("\n");
    importCsv(db, { content: lines.slice(0, 5).join("\n"), filename: "a.csv" });
    const s = importCsv(db, { content: lines.join("\n"), filename: "b.csv" });
    expect(s.rowsImported).toBe(4);
    expect(s.rowsDuplicate).toBe(2);
  });

  it("keeps two identical rows from the same file apart", () => {
    const db = createDb(":memory:");
    const s = importCsv(db, { content: fixture("rabobank-sample.csv"), filename: "r.csv" });
    expect(s.rowsImported).toBe(7); // the two 4,50 coffees both land
    const hashes = buildImportHashes(1, [
      {
        date: "2026-09-01",
        amount: -1,
        currency: "EUR",
        counterparty: null,
        counterpartyIban: null,
        description: null,
        sourceKey: "k",
      },
      {
        date: "2026-09-01",
        amount: -1,
        currency: "EUR",
        counterparty: null,
        counterpartyIban: null,
        description: null,
        sourceKey: "k",
      },
    ]);
    expect(new Set(hashes).size).toBe(2);
  });

  it("Revolut: skips non-completed rows, flags foreign currency, logs counts", () => {
    const db = createDb(":memory:");
    const s = importCsv(db, { content: fixture("revolut-sample.csv"), filename: "rev.csv" });
    expect(s).toMatchObject({
      bank: "revolut",
      rowsTotal: 8,
      rowsImported: 6,
      rowsSkipped: 2,
      foreignCurrencyRows: 1,
    });
    expect(s.warnings.join(" ")).toMatch(/not in EUR/);
    const [log] = db.select().from(schema.imports).where(eq(schema.imports.id, s.importId)).all();
    expect(log).toMatchObject({ rowsTotal: 8, rowsImported: 6, rowsSkipped: 2, month: "2026-09" });
  });

  it("uses an explicit account and month, and rejects a bank mismatch", () => {
    const db = createDb(":memory:");
    const [rev] = db
      .insert(schema.accounts)
      .values({ name: "Revolut", bank: "revolut" })
      .returning()
      .all();
    const s = importCsv(db, {
      content: fixture("revolut-sample.csv"),
      filename: "r.csv",
      accountId: rev.id,
      month: "2026-09",
    });
    expect(s.accountId).toBe(rev.id);
    expect(() =>
      importCsv(db, {
        content: fixture("rabobank-sample.csv"),
        filename: "x.csv",
        accountId: rev.id,
      }),
    ).toThrow(/looks like a rabobank/);
  });

  it("rejects unknown files and bad months", () => {
    const db = createDb(":memory:");
    expect(() => importCsv(db, { content: "a,b\n1,2\n", filename: "x.csv" })).toThrow(ImportError);
    expect(() =>
      importCsv(db, {
        content: fixture("revolut-sample.csv"),
        filename: "x.csv",
        month: "2026-13",
      }),
    ).toThrow(/Invalid month/);
  });

  it("the same transaction on two different accounts is not a duplicate", () => {
    const db = createDb(":memory:");
    const a = db
      .insert(schema.accounts)
      .values({ name: "A", bank: "revolut" })
      .returning()
      .all()[0];
    const b = db
      .insert(schema.accounts)
      .values({ name: "B", bank: "revolut" })
      .returning()
      .all()[0];
    importCsv(db, { content: fixture("revolut-sample.csv"), filename: "r.csv", accountId: a.id });
    const s = importCsv(db, {
      content: fixture("revolut-sample.csv"),
      filename: "r.csv",
      accountId: b.id,
    });
    expect(s.rowsImported).toBe(6);
  });
});

describe("importCsv categorisation", () => {
  it("applies rules and flags the Rabobank to Revolut transfer once both sides are in", () => {
    const db = createDb(":memory:");
    importCsv(db, { content: fixture("rabobank-sample.csv"), filename: "rabo.csv" });
    const catOf = (cp: string) => {
      const t = db
        .select()
        .from(schema.transactions)
        .where(eq(schema.transactions.counterparty, cp))
        .get()!;
      return t.categoryId
        ? db.select().from(schema.categories).where(eq(schema.categories.id, t.categoryId)).get()!
            .name
        : null;
    };
    expect(catOf("Spotify AB")).toBe("Abonnementen");
    expect(catOf("Albert Heijn 1234 Amsterdam")).toBe("Boodschappen");
    expect(catOf("Verhuurder Voorbeeld BV")).toBe("Huur");
    expect(catOf("Koffie Voorbeeld")).toBeNull();

    importCsv(db, { content: fixture("revolut-sample.csv"), filename: "rev.csv" });
    const transfers = db
      .select()
      .from(schema.transactions)
      .where(eq(schema.transactions.isInternalTransfer, true))
      .all();
    expect(transfers.map((t) => t.amount).sort()).toEqual([-20000, 20000]);
  });
});
