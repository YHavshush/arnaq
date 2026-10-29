import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDb, schema } from "@/db";
import { matchExisting } from "./dedupe";
import { importStatement } from "./service";
import type { ParsedRow } from "./types";

const statement = () =>
  readFileSync(path.join(process.cwd(), "tests/fixtures/revolut-statement-sample.csv"), "utf8");

/** The same nine transactions as the statement fixture, in Revolut's plain export layout (a different file, same money). */
const PLAIN_HEADER =
  "Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance";
const PLAIN_ROWS = [
  [
    "CARD_PAYMENT",
    "2026-10-01 09:00:00",
    "2026-10-01 09:00:05",
    "Voorbeeld Supermarkt",
    "-20.50",
    "129.50",
  ],
  [
    "CARD_PAYMENT",
    "2026-10-01 10:00:00",
    "2026-10-01 10:00:05",
    "Cafe De Proef, Utrecht",
    "-4.00",
    "125.50",
  ],
  [
    "TOPUP",
    "2026-10-02 08:00:00",
    "2026-10-02 08:00:05",
    "Apple Pay top-up by *0000",
    "1500.00",
    "1625.50",
  ],
  [
    "TRANSFER",
    "2026-10-03 08:00:00",
    "2026-10-03 08:00:05",
    "To Instant Access Savings",
    "-300.00",
    "1325.50",
  ],
  [
    "TRANSFER",
    "2026-10-05 08:00:00",
    "2026-10-05 08:00:05",
    "From Instant Access Savings",
    "50.00",
    "1375.50",
  ],
  ["REFUND", "2026-10-06 08:00:00", "2026-10-06 08:00:05", "Voorbeeld Webshop", "5.00", "1380.50"],
  ["REFUND", "2026-10-06 08:01:00", "2026-10-06 08:01:05", "Voorbeeld Webshop", "5.00", "1385.50"],
  [
    "ATM",
    "2026-10-07 08:00:00",
    "2026-10-07 08:00:05",
    "Cash withdrawal at Voorbeeld Bank",
    "-100.00",
    "1285.50",
  ],
  [
    "CARD_PAYMENT",
    "2026-10-09 08:00:00",
    "2026-10-09 08:00:05",
    "Voorbeeld Cinema",
    "-11.00",
    "1274.50",
  ],
];
const plainCsv = (tweak?: (rows: string[][]) => string[][]) =>
  [
    PLAIN_HEADER,
    ...(tweak ? tweak(PLAIN_ROWS.map((r) => [...r])) : PLAIN_ROWS).map(
      ([type, started, completed, desc, amount, balance]) =>
        `${type},Current,${started},${completed},"${desc}",${amount},0.00,EUR,COMPLETED,${balance}`,
    ),
  ].join("\n");

const row = (over: Partial<ParsedRow>): ParsedRow => ({
  date: "2026-10-01",
  amount: -1000,
  currency: "EUR",
  counterparty: "Shop",
  counterpartyIban: null,
  description: null,
  sourceKey: "k",
  balanceAfter: 50000,
  ...over,
});
const existing = (
  over: Partial<{
    date: string;
    amount: number;
    balanceAfter: number | null;
    counterparty: string | null;
  }>,
) => ({
  date: "2026-10-01",
  amount: -1000,
  balanceAfter: 50000 as number | null,
  counterparty: "Shop" as string | null,
  ...over,
});

describe("matchExisting (the same money seen again, in whatever file)", () => {
  it("matches on date, amount and the running balance", () => {
    expect([...matchExisting([existing({})], [row({})])]).toEqual([0]);
  });
  it("matches although the bank dated it a day or two differently (started vs settled)", () => {
    expect(matchExisting([existing({ date: "2026-10-02" })], [row({})]).size).toBe(1);
    expect(matchExisting([existing({ date: "2026-10-05" })], [row({})]).size).toBe(0);
  });
  it("does not match when the balance differs (a different payment of the same size)", () => {
    expect(matchExisting([existing({ balanceAfter: 40000 })], [row({})]).size).toBe(0);
  });
  it("does not match a different amount", () => {
    expect(matchExisting([existing({ amount: -1001 })], [row({})]).size).toBe(0);
  });
  it("falls back to date, amount and shop name when a balance is missing", () => {
    expect(
      matchExisting([existing({ balanceAfter: null })], [row({ balanceAfter: null })]).size,
    ).toBe(1);
    expect(
      matchExisting(
        [existing({ balanceAfter: null, counterparty: " SHOP " })],
        [row({ balanceAfter: null })],
      ).size,
    ).toBe(1);
    expect(
      matchExisting(
        [existing({ balanceAfter: null, counterparty: "Other" })],
        [row({ balanceAfter: null })],
      ).size,
    ).toBe(0);
  });
  it("lets one stored transaction absorb only one new one (two identical coffees stay two)", () => {
    const incoming = [row({ balanceAfter: null }), row({ balanceAfter: null })];
    expect([...matchExisting([existing({ balanceAfter: null })], incoming)]).toEqual([0]);
  });
});

describe("importing the same money from two different file layouts", () => {
  it("a statement after the plain export adds nothing", async () => {
    const db = await createDb(":memory:");
    const first = await importStatement(db, { content: plainCsv(), filename: "plain.csv" });
    expect(first.rowsImported).toBe(9);
    const second = await importStatement(db, { content: statement(), filename: "statement.csv" });
    expect(second).toMatchObject({ rowsImported: 0, rowsDuplicate: 9 });
    expect(await db.select().from(schema.transactions)).toHaveLength(9);
  });
  it("the plain export after a statement adds nothing either", async () => {
    const db = await createDb(":memory:");
    await importStatement(db, { content: statement(), filename: "statement.csv" });
    const second = await importStatement(db, { content: plainCsv(), filename: "plain.csv" });
    expect(second).toMatchObject({ rowsImported: 0, rowsDuplicate: 9 });
    expect(await db.select().from(schema.transactions)).toHaveLength(9);
  });
  it("still recognises a payment the plain export settled a day later", async () => {
    const db = await createDb(":memory:");
    await importStatement(db, {
      content: plainCsv((rows) => {
        rows[0][2] = "2026-10-02 00:10:00"; // settled the next day
        return rows;
      }),
      filename: "plain.csv",
    });
    const second = await importStatement(db, { content: statement(), filename: "statement.csv" });
    expect(second.rowsImported).toBe(0);
  });
  it("imports only what is new when the statement reaches further than the earlier file", async () => {
    const db = await createDb(":memory:");
    await importStatement(db, {
      content: plainCsv((rows) => rows.slice(0, 5)),
      filename: "plain-part.csv",
    });
    const second = await importStatement(db, { content: statement(), filename: "statement.csv" });
    expect(second).toMatchObject({ rowsImported: 4, rowsDuplicate: 5 });
    expect(await db.select().from(schema.transactions)).toHaveLength(9);
  });
});
