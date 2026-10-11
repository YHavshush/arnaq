import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectBank } from ".";
import { rabobankParser } from "./rabobank";
import { revolutParser } from "./revolut";

const fixture = (name: string) =>
  readFileSync(path.join(process.cwd(), "tests/fixtures", name), "utf8");

describe("rabobank parser", () => {
  const result = rabobankParser.parse(fixture("rabobank-sample.csv"));

  it("parses all rows with integer cents", () => {
    expect(result.rows).toHaveLength(7);
    expect(result.skipped).toEqual([]);
    expect(result.rows.map((r) => r.amount)).toEqual([
      -65000, -4237, 123456, -999, -20000, -450, -450,
    ]);
  });
  it("reads counterparty, IBAN, joined description and own IBAN", () => {
    expect(result.accountIdentifier).toBe("NL00RABO0000000001");
    expect(result.rows[0]).toMatchObject({
      date: "2026-09-01",
      counterparty: "Verhuurder Voorbeeld BV",
      counterpartyIban: "NL00BANK0000000011",
      description: "Huur september",
      currency: "EUR",
    });
    expect(result.rows[1].description).toBe("Pasvolgnr 001 02-09-2026 12:34 Transactie 1A2B3C");
  });
  it("turns empty counterparty IBAN into null", () => {
    expect(result.rows[5].counterpartyIban).toBeNull();
  });
  it("handles semicolon-separated files and a BOM", () => {
    const semi = "﻿" + fixture("rabobank-sample.csv").replaceAll('","', '";"');
    const r = rabobankParser.parse(semi);
    expect(r.rows).toHaveLength(7);
    expect(r.rows[2].amount).toBe(123456);
  });
  it("skips a broken row instead of failing the file", () => {
    const bad = fixture("rabobank-sample.csv").replace('"-9,99"', '"oops"');
    const r = rabobankParser.parse(bad);
    expect(r.rows).toHaveLength(6);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0].line).toBe(5);
  });
  it("rejects a file from another bank", () => {
    expect(() => rabobankParser.parse(fixture("revolut-sample.csv"))).toThrow(/Not a Rabobank/);
  });
});

describe("revolut parser", () => {
  const result = revolutParser.parse(fixture("revolut-sample.csv"));

  it("imports only COMPLETED rows", () => {
    expect(result.rows).toHaveLength(6);
    expect(result.skipped.map((s) => s.line)).toEqual([4, 5]);
  });
  it("folds the fee into the amount", () => {
    const atm = result.rows.find((r) => r.counterparty === "Cash at Station")!;
    expect(atm.amount).toBe(-5150);
    expect(atm.description).toContain("fee");
  });
  it("keeps the original currency", () => {
    expect(result.rows.find((r) => r.counterparty === "Train Ticket London")).toMatchObject({
      currency: "GBP",
      amount: -1200,
    });
  });
  it("gives identical-looking rows distinct source keys", () => {
    const coffee = result.rows.filter((r) => r.counterparty === "Coffee Voorbeeld");
    expect(coffee).toHaveLength(2);
    expect(coffee[0].sourceKey).not.toBe(coffee[1].sourceKey);
  });
});

describe("detectBank", () => {
  it("recognises both banks and rejects unknown files", () => {
    expect(detectBank(fixture("rabobank-sample.csv"))).toBe("rabobank");
    expect(detectBank(fixture("revolut-sample.csv"))).toBe("revolut");
    expect(detectBank("a,b,c\n1,2,3\n")).toBeNull();
  });
});
