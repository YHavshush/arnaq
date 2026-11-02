import { describe, expect, it } from "vitest";
import { createDb, schema } from "@/db";
import { EXPORT_VERSION, buildExport, csvText, transactionsCsv } from "./export";

describe("buildExport", () => {
  it("contains every table with the stored rows, in cents, and is plain JSON", async () => {
    const db = await createDb(":memory:");
    const [account] = await db
      .insert(schema.accounts)
      .values({ name: "Rabo", bank: "rabobank" })
      .returning();
    await db
      .insert(schema.transactions)
      .values({ accountId: account.id, date: "2026-09-01", amount: -1234, importHash: "h1" });
    const out = await buildExport(db, new Date("2026-10-12T10:00:00Z"));
    expect(out).toMatchObject({
      app: "arnaq",
      version: EXPORT_VERSION,
      exportedAt: "2026-10-12T10:00:00.000Z",
    });
    expect(Object.keys(out.tables).sort()).toEqual(
      [
        "accounts",
        "budgets",
        "categories",
        "categorisationRules",
        "imports",
        "merchantLabels",
        "monthlyTotalBudget",
        "planOverrides",
        "recurringItems",
        "recurringOccurrences",
        "recurringSuggestionRejections",
        "transactions",
        "userSettings",
      ].sort(),
    );
    expect(out.tables.transactions).toHaveLength(1);
    expect(out.tables.transactions[0].amount).toBe(-1234);
    expect("userId" in out.tables.transactions[0]).toBe(false);
    expect(out.tables.categories.length).toBeGreaterThan(10); // the seeded defaults
    expect(JSON.parse(JSON.stringify(out))).toEqual(out);
  });

  it("covers every table in the schema (a new table cannot be forgotten)", async () => {
    const { is, getTableName } = await import("drizzle-orm");
    const { PgTable } = await import("drizzle-orm/pg-core");
    const declared = Object.values(schema)
      .filter((t) => is(t, PgTable))
      .map((t) => getTableName(t as never))
      .filter((n) => n !== "app_users" && n !== "ai_usage") // owner bookkeeping and cap counters, not the person's data
      .sort();
    const out = await buildExport(await createDb(":memory:"));
    const exported = Object.keys(out.tables)
      .map((k) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`))
      .sort();
    expect(exported).toEqual(declared);
  });
});

describe("csvText (bank text goes into spreadsheets)", () => {
  it("neutralises formulas and escapes quotes, separators and newlines", () => {
    expect(csvText('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(csvText("+31 6 123")).toBe("'+31 6 123");
    expect(csvText("-lijn")).toBe("'-lijn");
    expect(csvText("@bron")).toBe("'@bron");
    expect(csvText("a;b")).toBe('"a;b"');
    expect(csvText('zeg "hoi"')).toBe('"zeg ""hoi"""');
    expect(csvText("regel1\nregel2")).toBe('"regel1\nregel2"');
    expect(csvText("Albert Heijn")).toBe("Albert Heijn");
    expect(csvText(null)).toBe("");
  });
});

describe("transactionsCsv", () => {
  it("has a header, decimal commas, a BOM and uncategorised rows too", async () => {
    const db = await createDb(":memory:");
    const [account] = await db
      .insert(schema.accounts)
      .values({ name: "Rabo", bank: "rabobank" })
      .returning();
    await db.insert(schema.transactions).values([
      {
        accountId: account.id,
        date: "2026-09-01",
        amount: -1234,
        importHash: "a",
        counterparty: "=cmd|' /C calc'!A0",
      },
      {
        accountId: account.id,
        date: "2026-09-02",
        amount: 500000,
        importHash: "b",
        counterparty: "Werkgever",
      },
    ]);
    const csv = await transactionsCsv(db);
    expect(csv.startsWith("﻿Datum;Rekening;Bedrag")).toBe(true);
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain(";5000,00;");
    expect(lines[2]).toContain(";-12,34;");
    expect(lines[2]).toContain("'=cmd");
  });
});
