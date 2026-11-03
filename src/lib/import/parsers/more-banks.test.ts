import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectBank } from ".";
import { createDb, schema } from "@/db";
import { importCsv } from "../service";
import { decodeBankText } from "../text";
import { abnCounterparty, abnamroParser } from "./abnamro";
import { ingParser } from "./ing";
import { knabParser } from "./knab";

const fixture = (name: string) =>
  readFileSync(path.join(process.cwd(), "tests/fixtures", name), "utf8");

describe("ING parser", () => {
  const result = ingParser.parse(fixture("ing-sample.csv"));

  it("reads every row, with the sign from Af Bij and integer cents", () => {
    expect(result.skipped).toEqual([]);
    expect(result.rows.map((r) => r.amount)).toEqual([-65000, -4237, 123456, -450, -450, 1500]);
    expect(result.accountIdentifier).toBe("NL00INGB0000000001");
  });
  it("keeps the balance after each row, and it follows from the amounts", () => {
    expect(result.rows[0].balanceAfter).toBe(235000);
    result.rows.slice(1).forEach((r, i) => {
      expect(r.balanceAfter! - r.amount).toBe(result.rows[i].balanceAfter);
    });
  });
  it("reads name, counterparty IBAN (also from the message) and date", () => {
    expect(result.rows[0]).toMatchObject({
      date: "2026-09-01",
      counterparty: "Verhuurder Voorbeeld BV",
      counterpartyIban: "NL00BANK0000000011",
    });
    expect(result.rows[1].counterpartyIban).toBeNull();
    expect(result.rows[2].counterpartyIban).toBe("NL00BANK0000000013");
  });
  it("rejects an Af Bij that is neither, row by row", () => {
    const bad = fixture("ing-sample.csv").replace('"Bij";"15,00"', '"?";"15,00"');
    const r = ingParser.parse(bad);
    expect(r.rows).toHaveLength(5);
    expect(r.skipped).toHaveLength(1);
  });
  it("works with a comma separated file and without the balance column", () => {
    const comma = fixture("ing-sample.csv")
      .split("\n")
      .map((l) => l.replaceAll('";"', '","').replace(/^"/, '"'))
      .join("\n")
      .replaceAll(',"Saldo na mutatie"', "")
      .replace(/,"\d+,\d\d",""$/gm, "");
    const r = ingParser.parse(comma);
    expect(r.rows).toHaveLength(6);
    expect(r.rows[0].balanceAfter).toBeNull();
  });
});

describe("Knab parser", () => {
  const result = knabParser.parse(fixture("knab-sample.csv"));

  it("reads every row, with the sign from CreditDebet", () => {
    expect(result.skipped).toEqual([]);
    expect(result.rows.map((r) => r.amount)).toEqual([-65000, -4237, 123456, -450, -450, 1500]);
    expect(result.accountIdentifier).toBe("NL00KNAB0000000001");
  });
  it("turns 05-09-2026 into 2026-09-05 and reads the names", () => {
    expect(result.rows[2]).toMatchObject({
      date: "2026-09-05",
      counterparty: "Voorbeeld Werkgever BV",
      counterpartyIban: "NL00BANK0000000013",
      description: "Salaris augustus",
    });
  });
  it("skips a row whose CreditDebet or date is unreadable, and says why", () => {
    const bad = fixture("knab-sample.csv")
      .replace(";Debet;650,00", ";Onbekend;650,00")
      .replace("02-09-2026;EUR", "32-13-2026;EUR");
    const r = knabParser.parse(bad);
    expect(r.rows).toHaveLength(4);
    expect(r.skipped.map((s) => s.line)).toEqual([2, 3]);
  });
});

describe("ABN AMRO parser", () => {
  const result = abnamroParser.parse(fixture("abnamro-sample.txt"));

  it("reads the header-less tab separated file", () => {
    expect(result.skipped).toEqual([]);
    expect(result.rows.map((r) => r.amount)).toEqual([-65000, -4237, 123456, -1500, -450]);
    expect(result.accountIdentifier).toBe("123456789");
    expect(result.rows[0].date).toBe("2026-09-01");
  });
  it("keeps the balance after each row, and it follows from the amounts", () => {
    result.rows.slice(1).forEach((r, i) => {
      expect(r.balanceAfter! - r.amount).toBe(result.rows[i].balanceAfter);
    });
  });
  it("finds who was paid in each of the description shapes", () => {
    expect(result.rows.map((r) => r.counterparty)).toEqual([
      "Verhuurder Voorbeeld BV",
      "Albert Heijn 1234 AMSTERDAM",
      "Voorbeeld Werkgever BV",
      "Sportclub Voorbeeld",
      "Café de Hoek",
    ]);
    expect(result.rows[0].counterpartyIban).toBe("NL00BANK0000000011");
    expect(result.rows[3].counterpartyIban).toBe("NL00BANK0000000014");
  });
  it("falls back to the whole description when the shape is unknown", () => {
    expect(abnCounterparty("Rente over 3e kwartaal")).toBeNull();
  });
  it("reads the same columns when they come with a header row and semicolons", () => {
    const text = fixture("abnamro-sample.txt").replaceAll("\t", ";");
    const withHeader =
      "Rekeningnummer;Muntsoort;Transactiedatum;Beginsaldo;Eindsaldo;Rentedatum;Transactiebedrag;Omschrijving\n" +
      text;
    expect(detectBank(withHeader)).toBe("abnamro");
    expect(abnamroParser.parse(withHeader).rows).toHaveLength(5);
  });
  it("refuses a file with no transaction lines", () => {
    expect(() => abnamroParser.parse("hello\nworld\n")).toThrow(/ABN AMRO/);
  });
});

describe("detecting the bank", () => {
  it("tells all five apart", () => {
    expect(detectBank(fixture("ing-sample.csv"))).toBe("ing");
    expect(detectBank(fixture("knab-sample.csv"))).toBe("knab");
    expect(detectBank(fixture("abnamro-sample.txt"))).toBe("abnamro");
    expect(detectBank(fixture("rabobank-sample.csv"))).toBe("rabobank");
    expect(detectBank(fixture("revolut-sample.csv"))).toBe("revolut");
  });
  it("says nothing for a file it does not know", () => {
    expect(detectBank("a,b,c\n1,2,3\n")).toBeNull();
  });
});

describe("text encoding", () => {
  it("reads UTF-8 as UTF-8 and Windows-1252 as Windows-1252", () => {
    expect(decodeBankText(new TextEncoder().encode("Café"))).toBe("Café");
    expect(decodeBankText(Uint8Array.from([0x43, 0x61, 0x66, 0xe9]))).toBe("Café");
  });
});

describe("importing through the service", () => {
  it.each([
    ["ing-sample.csv", "ing", 6, "NL00INGB0000000001"],
    ["knab-sample.csv", "knab", 6, "NL00KNAB0000000001"],
    ["abnamro-sample.txt", "abnamro", 5, "123456789"],
  ])(
    "%s becomes an account and its transactions, and a re-upload adds nothing",
    async (file, bank, n, id) => {
      const db = await createDb(":memory:");
      const first = await importCsv(db, { content: fixture(file), filename: file });
      expect(first).toMatchObject({ bank, month: "2026-09", rowsImported: n, rowsSkipped: 0 });
      const [account] = await db.select().from(schema.accounts);
      expect(account).toMatchObject({ bank, iban: id });
      const again = await importCsv(db, { content: fixture(file), filename: file });
      expect(again).toMatchObject({ rowsImported: 0, rowsDuplicate: n });
    },
  );
});
