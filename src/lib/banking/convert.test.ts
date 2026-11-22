import { describe, expect, it } from "vitest";
import { applyReportedBalance, convertTransactions, decimalToCents } from "./convert";

const tx = (over: Record<string, unknown> = {}) => ({
  entry_reference: "ref-1",
  transaction_amount: { currency: "EUR", amount: "42.37" },
  credit_debit_indicator: "DBIT",
  status: "BOOK",
  booking_date: "2026-11-02",
  value_date: "2026-11-01",
  creditor: { name: "Albert Heijn 1234 Amsterdam" },
  creditor_account: { iban: "NL62BANK0000000012" },
  debtor: { name: "Jan Voorbeeld" },
  debtor_account: { iban: "NL03RABO0000000001" },
  remittance_information: ["Pasvolgnr 001", "Boodschappen"],
  ...over,
});

describe("amounts", () => {
  it("are parsed from the decimal text into integer cents, never through a float", () => {
    expect(decimalToCents("42.37")).toBe(4237);
    expect(decimalToCents("0.1")).toBe(10);
    expect(decimalToCents("1234567.89")).toBe(123456789);
    expect(decimalToCents("-5")).toBe(-500);
    expect(decimalToCents("12.300")).toBe(1230);
    expect(decimalToCents("0.29")).toBe(29); // 0.29 * 100 is 28.999999999999996 as a float
  });

  it("refuse anything that is not a plain amount, or would lose a fraction of a cent", () => {
    for (const bad of [
      "12,30",
      "1e3",
      "12.345",
      "",
      " ",
      "abc",
      "1.2.3",
      "99999999999999.00",
      null,
      5,
    ])
      expect(decimalToCents(bad), String(bad)).toBeNull();
  });
});

describe("convertTransactions", () => {
  it("takes the sign from the credit/debit indicator and the other side from it too", () => {
    const { rows, skipped } = convertTransactions([
      tx(),
      tx({
        entry_reference: "ref-2",
        credit_debit_indicator: "CRDT",
        transaction_amount: { currency: "EUR", amount: "1234.56" },
        debtor: { name: "Voorbeeld Werkgever BV" },
        debtor_account: { iban: "NL35BANK0000000013" },
        remittance_information: ["Salaris"],
      }),
    ]);
    expect(skipped).toEqual([]);
    expect(rows[0]).toEqual({
      date: "2026-11-02",
      amount: -4237,
      currency: "EUR",
      counterparty: "Albert Heijn 1234 Amsterdam",
      counterpartyIban: "NL62BANK0000000012",
      description: "Pasvolgnr 001 Boodschappen",
      sourceKey: "eb:ref:ref-1",
      balanceAfter: null,
      bankCategory: null,
    });
    expect(rows[1]).toMatchObject({
      amount: 123456,
      counterparty: "Voorbeeld Werkgever BV",
      counterpartyIban: "NL35BANK0000000013",
      description: "Salaris",
    });
  });

  it("a negative amount under DBIT is still money out, and without an indicator the amount's own sign counts", () => {
    const { rows } = convertTransactions([
      tx({ transaction_amount: { currency: "EUR", amount: "-10.00" } }),
      tx({
        credit_debit_indicator: undefined,
        transaction_amount: { currency: "EUR", amount: "-3.50" },
      }),
      tx({
        credit_debit_indicator: undefined,
        transaction_amount: { currency: "EUR", amount: "3.50" },
      }),
    ]);
    expect(rows.map((r) => r.amount)).toEqual([-1000, -350, 350]);
  });

  it("only keeps booked transactions", () => {
    const { rows } = convertTransactions([
      tx({ status: "PDNG" }),
      tx({ status: "CNCL" }),
      tx({ status: "BOOK", entry_reference: "b" }),
      tx({ status: undefined, entry_reference: "c" }),
    ]);
    expect(rows.map((r) => r.sourceKey)).toEqual(["eb:ref:b", "eb:ref:c"]);
  });

  it("uses the value date when there is no booking date, and skips rows without a date or amount", () => {
    const { rows, skipped } = convertTransactions([
      tx({ booking_date: undefined }),
      tx({ booking_date: "2026-13-40", value_date: "nope", transaction_date: null }),
      tx({ transaction_amount: { currency: "EUR", amount: "1,00" } }),
      tx({ transaction_amount: { currency: "euro", amount: "1.00" } }),
      "not an object",
    ]);
    expect(rows.map((r) => r.date)).toEqual(["2026-11-01"]);
    expect(skipped.map((s) => s.line)).toEqual([2, 3, 4, 5]);
  });

  it("skips a row dated outside the range asked for", () => {
    const { rows, skipped } = convertTransactions(
      [tx({ booking_date: "1999-01-01" }), tx({ booking_date: "2030-01-01" }), tx()],
      { from: "2026-10-01", to: "2026-11-25" },
    );
    expect(rows.map((r) => r.date)).toEqual(["2026-11-02"]);
    expect(skipped.map((s) => s.reason)).toEqual([
      "Date outside the period asked for.",
      "Date outside the period asked for.",
    ]);
  });

  it("the source key is the entry reference, else the transaction id, else a hash of the fields", () => {
    const { rows } = convertTransactions([
      tx({ entry_reference: undefined, transaction_id: "tid-9" }),
      tx({ entry_reference: undefined }),
      tx({ entry_reference: "with space" }),
    ]);
    expect(rows[0].sourceKey).toBe("eb:id:tid-9");
    expect(rows[1].sourceKey).toMatch(/^eb:h:[0-9a-f]{64}$/);
    expect(rows[2].sourceKey).toBe(rows[1].sourceKey);
    // Stable: the same fields give the same key next time.
    expect(convertTransactions([tx({ entry_reference: undefined })]).rows[0].sourceKey).toBe(
      rows[1].sourceKey,
    );
  });

  it("cleans and caps text, and drops an IBAN that is not one", () => {
    const { rows } = convertTransactions([
      tx({
        creditor: { name: `A‮B\u0000C${"x".repeat(500)}` },
        creditor_account: { iban: "<script>" },
        remittance_information: ["x".repeat(5000), 7, null],
      }),
    ]);
    expect(rows[0].counterparty).toMatch(/^ABCx+$/);
    expect(rows[0].counterparty!.length).toBe(200);
    expect(rows[0].counterpartyIban).toBeNull();
    expect(rows[0].description!.length).toBeLessThanOrEqual(1000);
  });

  it("keeps the balance after the transaction when it is in the same currency", () => {
    const { rows } = convertTransactions([
      tx({ balance_after_transaction: { currency: "EUR", amount: "-12.50" } }),
      tx({ entry_reference: "r2", balance_after_transaction: { currency: "USD", amount: "1.00" } }),
    ]);
    expect(rows.map((r) => r.balanceAfter)).toEqual([-1250, null]);
  });
});

describe("applyReportedBalance", () => {
  it("puts the booked balance on the transaction the bank says it ends with", () => {
    const { rows } = convertTransactions([
      tx({ entry_reference: "a" }),
      tx({ entry_reference: "b" }),
    ]);
    applyReportedBalance(rows, [
      {
        type: "CLAV",
        amount: "9999.00",
        currency: "EUR",
        referenceDate: null,
        lastCommittedTransaction: "a",
      },
      {
        type: "CLBD",
        amount: "180.76",
        currency: "EUR",
        referenceDate: null,
        lastCommittedTransaction: "b",
      },
    ]);
    expect(rows.map((r) => r.balanceAfter)).toEqual([null, 18076]);
  });

  it("puts the booked balance on the newest transaction when the bank names none", () => {
    const { rows } = convertTransactions([
      tx({ entry_reference: "a", booking_date: "2026-11-02", value_date: "2026-11-02" }),
      tx({ entry_reference: "b", booking_date: "2026-11-05", value_date: "2026-11-05" }),
      tx({ entry_reference: "c", booking_date: "2026-11-05", value_date: "2026-11-05" }),
    ]);
    applyReportedBalance(rows, [
      {
        type: "CLAV",
        amount: "9999.00",
        currency: "EUR",
        referenceDate: null,
        lastCommittedTransaction: null,
      },
      {
        type: "CLBD",
        amount: "491.20",
        currency: "EUR",
        referenceDate: "2026-11-21",
        lastCommittedTransaction: null,
      },
    ]);
    expect(rows.map((r) => r.balanceAfter ?? null)).toEqual([null, null, 49120]);
  });

  it("leaves it out when the balance is older than the newest transaction", () => {
    const { rows } = convertTransactions([
      tx({ booking_date: "2026-11-05", value_date: "2026-11-05" }),
    ]);
    applyReportedBalance(rows, [
      {
        type: "CLBD",
        amount: "1.00",
        currency: "EUR",
        referenceDate: "2026-11-01",
        lastCommittedTransaction: null,
      },
    ]);
    expect(rows[0].balanceAfter ?? null).toBeNull();
  });

  it("does nothing without a reference it can find", () => {
    const { rows } = convertTransactions([tx()]);
    applyReportedBalance(rows, [
      {
        type: "CLBD",
        amount: "1.00",
        currency: "EUR",
        referenceDate: null,
        lastCommittedTransaction: "zzz",
      },
    ]);
    expect(rows[0].balanceAfter).toBeNull();
  });
});
