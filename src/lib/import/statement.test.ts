import { describe, expect, it } from "vitest";
import { createDb, schema } from "@/db";
import { coveredMonths } from "@/lib/recurring/occurrences";
import {
  statementPages,
  toPdfBytes,
  type StatementRow,
} from "../../../tests/helpers/statement-pdf";
import { revolutParser } from "./parsers/revolut";
import { ImportError, importStatement, periodFromFilename } from "./service";

const rows: StatementRow[] = [
  {
    rente: "02-09",
    type: "ei",
    iban: "NL00 TEST 0000 0000 11",
    name: "Streamdienst",
    processed: "02-09-2026",
    debit: 999,
  },
  {
    rente: "25-09",
    type: "cb",
    iban: "NL00 TEST 0000 0000 22",
    name: "Werkgever Voorbeeld BV",
    processed: "25-09-2026",
    credit: 185000,
  },
  {
    rente: "30-09",
    type: "ei",
    iban: "NL00 TEST 0000 0000 44",
    name: "Huisbaas Voorbeeld",
    processed: "30-09-2026",
    debit: 79000,
  },
];
const pdf = (spec: Parameters<typeof statementPages>[0]) => toPdfBytes(statementPages(spec));

describe("importing a Rabobank PDF statement", () => {
  it("imports it, resolves the account from the IBAN and stores the declared period", async () => {
    const db = await createDb(":memory:");
    const s = await importStatement(db, {
      content: pdf({ rows }),
      filename: "afschrift.pdf",
      today: "2026-10-05",
    });
    expect(s).toMatchObject({
      bank: "rabobank",
      month: "2026-09",
      rowsImported: 3,
      rowsDuplicate: 0,
      period: { from: "2026-09-01", to: "2026-09-30" },
    });
    const [account] = await db.select().from(schema.accounts);
    expect(account.iban).toBe("NL00RABO0000000001");
    const [imp] = await db.select().from(schema.imports);
    expect([imp.periodFrom, imp.periodTo]).toEqual(["2026-09-01", "2026-09-30"]);
    // Re-uploading the same statement adds nothing.
    const again = await importStatement(db, {
      content: pdf({ rows }),
      filename: "afschrift.pdf",
      today: "2026-10-05",
    });
    expect([again.rowsImported, again.rowsDuplicate]).toEqual([0, 3]);
  });

  it("refuses a PDF that is not a Rabobank statement, and a statement that does not add up", async () => {
    const db = await createDb(":memory:");
    const other = toPdfBytes([[{ str: "Factuur", x: 40, right: 80, y: 700 }]]);
    await expect(importStatement(db, { content: other, filename: "x.pdf" })).rejects.toThrow(
      /geen Rabobank-afschrift/,
    );
    await expect(
      importStatement(db, { content: pdf({ rows, totals: { debit: 1 } }), filename: "x.pdf" }),
    ).rejects.toThrow(ImportError);
    expect(await db.select().from(schema.transactions)).toEqual([]);
  });
});

describe("which months count as uploaded", () => {
  const imp = async (
    db: Awaited<ReturnType<typeof createDb>>,
    content: Uint8Array | string,
    filename: string,
  ) => importStatement(db, { content, filename });

  it("only months that lie fully inside a declared period", async () => {
    const db = await createDb(":memory:");
    await imp(db, pdf({ from: "26-08-2026", to: "11-10-2026", rows: [] }), "a.pdf");
    expect([...(await coveredMonths(db))]).toEqual(["2026-09"]); // August and October are only partly covered
  });

  it("two consecutive statements of one account together cover the month they share", async () => {
    const db = await createDb(":memory:");
    await imp(db, pdf({ from: "01-09-2026", to: "15-09-2026", rows: [] }), "a.pdf");
    expect(await coveredMonths(db)).toEqual(new Set());
    await imp(db, pdf({ from: "16-09-2026", to: "30-09-2026", rows: [] }), "b.pdf");
    expect([...(await coveredMonths(db))]).toEqual(["2026-09"]);
  });

  it("a plain CSV without a declared period still covers its month", async () => {
    const db = await createDb(":memory:");
    const csv =
      "Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance\nCard Payment,Current,2026-09-12 09:15:02,2026-09-12 09:15:04,Winkel,-5.00,0.00,EUR,COMPLETED,10.00\n";
    await imp(db, csv, "export.csv");
    expect([...(await coveredMonths(db))]).toEqual(["2026-09"]);
  });
});

describe("Revolut statements", () => {
  const header =
    "Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance\n";

  it("books a payment on its completion date (the statement's own month)", () => {
    const r = revolutParser.parse(
      `${header}Card Payment,Current,2026-09-30 23:50:00,2026-10-01 09:52:34,Winkel,-11.81,0.00,EUR,COMPLETED,65.60\n`,
    );
    expect(r.rows[0].date).toBe("2026-10-01");
  });

  it("reads the period from the file name Revolut gives its exports", () => {
    expect(periodFromFilename("account-statement_2026-10-01_2026-10-12_en_857c7e.csv")).toEqual({
      from: "2026-10-01",
      to: "2026-10-12",
    });
    expect(periodFromFilename("export.csv")).toBeUndefined();
    expect(periodFromFilename("a_2026-10-12_2026-10-01.csv")).toBeUndefined();
  });

  it("a statement that stops mid-month does not mark that month as uploaded", async () => {
    const db = await createDb(":memory:");
    const csv = `${header}Card Payment,Current,2026-10-02 09:00:00,2026-10-02 09:00:01,Winkel,-5.00,0.00,EUR,COMPLETED,10.00\n`;
    const s = await importStatement(db, {
      content: csv,
      filename: "account-statement_2026-10-01_2026-10-12_en_x.csv",
    });
    expect(s.period).toEqual({ from: "2026-10-01", to: "2026-10-12" });
    expect(await coveredMonths(db)).toEqual(new Set());
  });
});
