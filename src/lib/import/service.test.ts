import { readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { one, createDb, schema } from "@/db";
import { ImportError, buildImportHashes, importCsv } from "./service";

const fixture = (name: string) =>
  readFileSync(path.join(process.cwd(), "tests/fixtures", name), "utf8");
const count = async (db: Awaited<ReturnType<typeof createDb>>) =>
  (await db.select().from(schema.transactions)).length;

describe("importCsv", () => {
  it("imports a Rabobank file, auto-creating the account from the IBAN", async () => {
    const db = await createDb(":memory:");
    const s = await importCsv(db, {
      content: fixture("rabobank-sample.csv"),
      filename: "rabo.csv",
    });
    expect(s).toMatchObject({
      bank: "rabobank",
      month: "2026-09",
      rowsImported: 7,
      rowsDuplicate: 0,
      rowsSkipped: 0,
    });
    const [account] = await db.select().from(schema.accounts);
    expect(account.iban).toBe("NL00RABO0000000001");
    expect(await count(db)).toBe(7);
  });

  it("re-uploading the same month never double counts", async () => {
    const db = await createDb(":memory:");
    await importCsv(db, { content: fixture("rabobank-sample.csv"), filename: "rabo.csv" });
    const again = await importCsv(db, {
      content: fixture("rabobank-sample.csv"),
      filename: "rabo-again.csv",
    });
    expect(again).toMatchObject({ rowsImported: 0, rowsDuplicate: 7 });
    expect(await count(db)).toBe(7);
    expect(await db.select().from(schema.imports)).toHaveLength(2); // both uploads are logged
    expect(await db.select().from(schema.accounts)).toHaveLength(1);
  });

  it("an overlapping file only adds the new rows", async () => {
    const db = await createDb(":memory:");
    const lines = fixture("revolut-sample.csv").trimEnd().split("\n");
    await importCsv(db, { content: lines.slice(0, 5).join("\n"), filename: "a.csv" });
    const s = await importCsv(db, { content: lines.join("\n"), filename: "b.csv" });
    expect(s.rowsImported).toBe(4);
    expect(s.rowsDuplicate).toBe(2);
  });

  it("keeps two identical rows from the same file apart", async () => {
    const db = await createDb(":memory:");
    const s = await importCsv(db, { content: fixture("rabobank-sample.csv"), filename: "r.csv" });
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

  it("Revolut: skips non-completed rows, flags foreign currency, logs counts", async () => {
    const db = await createDb(":memory:");
    const s = await importCsv(db, { content: fixture("revolut-sample.csv"), filename: "rev.csv" });
    expect(s).toMatchObject({
      bank: "revolut",
      rowsTotal: 8,
      rowsImported: 6,
      rowsSkipped: 2,
      foreignCurrencyRows: 1,
    });
    expect(s.warnings.join(" ")).toMatch(/not in EUR/);
    const [log] = await db.select().from(schema.imports).where(eq(schema.imports.id, s.importId));
    expect(log).toMatchObject({ rowsTotal: 8, rowsImported: 6, rowsSkipped: 2, month: "2026-09" });
  });

  it("uses an explicit account and month, and rejects a bank mismatch", async () => {
    const db = await createDb(":memory:");
    const [rev] = await db
      .insert(schema.accounts)
      .values({ name: "Revolut", bank: "revolut" })
      .returning();
    const s = await importCsv(db, {
      content: fixture("revolut-sample.csv"),
      filename: "r.csv",
      accountId: rev.id,
      month: "2026-09",
    });
    expect(s.accountId).toBe(rev.id);
    await expect(
      importCsv(db, {
        content: fixture("rabobank-sample.csv"),
        filename: "x.csv",
        accountId: rev.id,
      }),
    ).rejects.toThrow(/looks like a rabobank/);
  });

  it("rejects unknown files and bad months", async () => {
    const db = await createDb(":memory:");
    await expect(importCsv(db, { content: "a,b\n1,2\n", filename: "x.csv" })).rejects.toThrow(
      ImportError,
    );
    await expect(
      importCsv(db, {
        content: fixture("revolut-sample.csv"),
        filename: "x.csv",
        month: "2026-13",
      }),
    ).rejects.toThrow(/Invalid month/);
  });

  it("the same transaction on two different accounts is not a duplicate", async () => {
    const db = await createDb(":memory:");
    const a = (
      await db.insert(schema.accounts).values({ name: "A", bank: "revolut" }).returning()
    )[0];
    const b = (
      await db.insert(schema.accounts).values({ name: "B", bank: "revolut" }).returning()
    )[0];
    await importCsv(db, {
      content: fixture("revolut-sample.csv"),
      filename: "r.csv",
      accountId: a.id,
    });
    const s = await importCsv(db, {
      content: fixture("revolut-sample.csv"),
      filename: "r.csv",
      accountId: b.id,
    });
    expect(s.rowsImported).toBe(6);
  });
});

describe("importCsv categorisation", () => {
  it("applies rules and flags the Rabobank to Revolut transfer once both sides are in", async () => {
    const db = await createDb(":memory:");
    await importCsv(db, { content: fixture("rabobank-sample.csv"), filename: "rabo.csv" });
    const catOf = async (cp: string) => {
      const t = (await one(
        db.select().from(schema.transactions).where(eq(schema.transactions.counterparty, cp)),
      ))!;
      return t.categoryId
        ? (await one(
            db.select().from(schema.categories).where(eq(schema.categories.id, t.categoryId)),
          ))!.name
        : null;
    };
    expect(await catOf("Spotify AB")).toBe("Abonnementen");
    expect(await catOf("Albert Heijn 1234 Amsterdam")).toBe("Boodschappen");
    expect(await catOf("Verhuurder Voorbeeld BV")).toBe("Huur");
    expect(await catOf("Koffie Voorbeeld")).toBeNull();

    await importCsv(db, { content: fixture("revolut-sample.csv"), filename: "rev.csv" });
    const transfers = await db
      .select()
      .from(schema.transactions)
      .where(eq(schema.transactions.isInternalTransfer, true));
    expect(transfers.map((t) => t.amount).sort()).toEqual([-20000, 20000]);
  });
});
