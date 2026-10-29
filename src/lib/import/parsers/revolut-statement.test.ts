import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, schema } from "@/db";
import { getSavingsSettings } from "@/lib/savings/settings";
import { ImportError, importStatement } from "../service";
import { detectBank } from ".";
import { looksLikeRevolutStatement, parseRevolutStatement } from "./revolut-statement";
import { revolutParser } from "./revolut";

const fixture = (name: string) =>
  readFileSync(path.join(process.cwd(), "tests/fixtures", name), "utf8");
const statement = () => fixture("revolut-statement-sample.csv");

describe("recognising a Revolut custom statement", () => {
  it("recognises the statement layout", () => {
    expect(looksLikeRevolutStatement(statement())).toBe(true);
  });
  it("does not mistake the other exports for it", () => {
    expect(looksLikeRevolutStatement(fixture("revolut-sample.csv"))).toBe(false);
    expect(looksLikeRevolutStatement(fixture("rabobank-sample.csv"))).toBe(false);
    expect(looksLikeRevolutStatement("")).toBe(false);
  });
  it("answers quickly on a hostile file made of blank lines and spaces", () => {
    const hostile = ("\n \t".repeat(66_000) + "\n").slice(0, 200_000);
    const started = Date.now();
    expect(looksLikeRevolutStatement(hostile)).toBe(false);
    expect(Date.now() - started).toBeLessThan(500);
  });
  it("needs the title at the start of a line (not just anywhere in the text)", () => {
    expect(looksLikeRevolutStatement("note: Current Accounts Summaries are listed below")).toBe(
      false,
    );
  });
  it("is found by bank detection, as Revolut", () => {
    expect(detectBank(statement())).toBe("revolut");
    expect(detectBank(fixture("revolut-sample.csv"))).toBe("revolut");
    expect(detectBank(fixture("rabobank-sample.csv"))).toBe("rabobank");
  });
});

describe("parseRevolutStatement", () => {
  const result = parseRevolutStatement(statement());

  it("reads every transaction of the current account, with integer cents", () => {
    expect(result.rows.map((r) => r.amount)).toEqual([
      -2050, -400, 150000, -30000, 5000, 500, 500, -10000, -1100,
    ]);
    expect(result.skipped).toEqual([]);
  });
  it("reads dates like 'Oct 1, 2026' as ISO dates", () => {
    expect(result.rows[0].date).toBe("2026-10-01");
    expect(result.rows[8].date).toBe("2026-10-09");
  });
  it("reads thousands separators and quoted descriptions", () => {
    expect(result.rows[2]).toMatchObject({ amount: 150000, balanceAfter: 162550 });
    expect(result.rows[1].description).toBe("Cafe De Proef, Utrecht");
  });
  it("uses the description as counterparty, in EUR", () => {
    expect(result.rows[0]).toMatchObject({
      counterparty: "Voorbeeld Supermarkt",
      counterpartyIban: null,
      currency: "EUR",
    });
  });
  it("keeps the balance after each row", () => {
    expect(result.rows.map((r) => r.balanceAfter)).toEqual([
      12950, 12550, 162550, 132550, 137550, 138050, 138550, 128550, 127450,
    ]);
  });
  it("gives identical-looking rows different keys (same shop, day and amount)", () => {
    const keys = result.rows.map((r) => r.sourceKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("declares the period from the first to the last transaction", () => {
    expect(result.period).toEqual({ from: "2026-10-01", to: "2026-10-09" });
  });
  it("leaves the account to be found as before (no identifier), so an existing Revolut account is reused", () => {
    expect(result.accountIdentifier).toBeNull();
  });
  it("reads the savings balance the statement reports, for the day the statement ends", () => {
    expect(result.savingsBalance).toEqual({ amount: 20000, asOf: "2026-10-09" });
  });
  it("leaves the savings balance out when the statement has no savings account", () => {
    const text = statement();
    const withoutSavings =
      text.slice(0, text.indexOf("Savings Accounts Summaries")) +
      text.slice(text.indexOf("Current Accounts Transaction Statements"));
    expect(parseRevolutStatement(withoutSavings).savingsBalance).toBeUndefined();
  });
  it("ignores the savings interest table and the totals row", () => {
    expect(result.rows).toHaveLength(9);
    expect(result.rows.some((r) => /Net Interest/.test(r.description ?? ""))).toBe(false);
  });
  it("keeps the moves to and from the savings pot as ordinary rows", () => {
    const savings = result.rows.filter((r) => /Instant Access Savings/.test(r.description ?? ""));
    expect(savings.map((r) => r.amount)).toEqual([-30000, 5000]);
  });
});

describe("a statement that does not add up is refused", () => {
  const withClosing = (value: string) =>
    statement().replace('Closing balance,"€1,274.50"', `Closing balance,"${value}"`);

  it("when the closing balance does not match the transactions", () => {
    expect(() => parseRevolutStatement(withClosing("€1,274.51"))).toThrow(
      /does not add up|reliably/i,
    );
  });
  it("when a running balance does not follow from the one before", () => {
    const broken = statement().replace('"€1,625.50"', '"€1,625.51"');
    expect(() => parseRevolutStatement(broken)).toThrow(/reliably|does not add up/i);
  });
  it("when the opening or closing balance is missing", () => {
    const noOpening = statement().replace("Opening balance,€150.00", "Opening balance,");
    expect(() => parseRevolutStatement(noOpening)).toThrow(/balance/i);
  });
  it("when the file holds more than one current account", () => {
    const text = statement();
    const table = text.slice(text.indexOf("Transaction statement,,,"), text.indexOf("Total,,,"));
    const twice = text.replace("Total,,,", `${table}\nTotal,,,`);
    expect(() => parseRevolutStatement(twice)).toThrow(/more than one|one account/i);
  });
  it("when a row has a date or amount it cannot read", () => {
    const badDate = statement().replace('"Oct 3, 2026"', '"3rd of October"');
    expect(() => parseRevolutStatement(badDate)).toThrow(/reliably|date/i);
    const badAmount = statement().replace("-€300.00", "-€abc");
    expect(() => parseRevolutStatement(badAmount)).toThrow(/reliably|amount/i);
  });
});

describe("the Revolut parser", () => {
  it("reads a custom statement through the same entry point as the plain export", () => {
    const viaParser = revolutParser.parse(statement());
    expect(viaParser.rows).toHaveLength(9);
    expect(viaParser.period).toEqual({ from: "2026-10-01", to: "2026-10-09" });
  });
  it("still reads the plain export", () => {
    expect(revolutParser.parse(fixture("revolut-sample.csv")).rows.length).toBeGreaterThan(0);
  });
});

describe("importing a custom statement", () => {
  it("imports the rows, the period and the balances", async () => {
    const db = await createDb(":memory:");
    const s = await importStatement(db, { content: statement(), filename: "statement.csv" });
    expect(s).toMatchObject({
      bank: "revolut",
      month: "2026-10",
      rowsImported: 9,
      rowsDuplicate: 0,
      rowsSkipped: 0,
      period: { from: "2026-10-01", to: "2026-10-09" },
    });
    const rows = await db.select().from(schema.transactions).orderBy(schema.transactions.id);
    expect(rows).toHaveLength(9);
    expect(rows[8].balanceAfter).toBe(127450);
  });
  it("stores the savings balance from the statement, so the total never has to be typed", async () => {
    const db = await createDb(":memory:");
    const summary = await importStatement(db, { content: statement(), filename: "statement.csv" });
    expect(await getSavingsSettings(db)).toMatchObject({ anchor: 20000, anchorDate: "2026-10-09" });
    expect(summary.savingsBalance).toEqual({ amount: 20000, asOf: "2026-10-09" });
  });
  it("reuses the existing Revolut account instead of making a second one", async () => {
    const db = await createDb(":memory:");
    await db.insert(schema.accounts).values({ name: "Revolut", bank: "revolut" });
    await importStatement(db, { content: statement(), filename: "statement.csv" });
    expect(await db.select().from(schema.accounts)).toHaveLength(1);
  });
  it("sorts the moves to and from the savings pot into the Savings category", async () => {
    const db = await createDb(":memory:");
    await importStatement(db, { content: statement(), filename: "statement.csv" });
    const rows = await db
      .select({ description: schema.transactions.description, type: schema.categories.type })
      .from(schema.transactions)
      .leftJoin(schema.categories, eq(schema.categories.id, schema.transactions.categoryId));
    const savingsMoves = rows.filter((r) => /Instant Access Savings/.test(r.description ?? ""));
    expect(savingsMoves).toHaveLength(2);
    expect(savingsMoves.every((r) => r.type === "savings")).toBe(true);
  });
  it("uploading the same statement again never double counts", async () => {
    const db = await createDb(":memory:");
    await importStatement(db, { content: statement(), filename: "statement.csv" });
    const again = await importStatement(db, { content: statement(), filename: "again.csv" });
    expect(again).toMatchObject({ rowsImported: 0, rowsDuplicate: 9 });
    expect(await db.select().from(schema.transactions)).toHaveLength(9);
  });
  it("tells the person plainly when a statement does not add up, and imports nothing", async () => {
    const db = await createDb(":memory:");
    const broken = statement().replace(
      'Closing balance,"€1,274.50"',
      'Closing balance,"€1,999.00"',
    );
    await expect(
      importStatement(db, { content: broken, filename: "s.csv" }),
    ).rejects.toBeInstanceOf(ImportError);
    expect(await db.select().from(schema.transactions)).toHaveLength(0);
  });
});
