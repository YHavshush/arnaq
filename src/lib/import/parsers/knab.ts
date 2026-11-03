import { parseAmountToCents } from "@/lib/money";
import { readCsv } from "../csv";
import type { BankParser, ParsedRow, SkippedRow } from "../types";
import { clean, dateFromDutchOrIso } from "./shared";

const REQUIRED = ["Rekeningnummer", "Transactiedatum", "CreditDebet", "Bedrag"];

/**
 * Knab export (CSV, semicolon separated): Rekeningnummer, Transactiedatum (05-09-2026), Valutacode, CreditDebet
 * (Credit or Debet), Bedrag (12,34), Tegenrekeningnummer, Tegenrekeninghouder, Omschrijving, Referentie, and more. The
 * sign comes from CreditDebet. There is no balance column.
 * NOTE: built against an invented sample that follows the documented layout. Verify against a real export.
 */
export const knabParser: BankParser = {
  bank: "knab",

  detect: (headers) => REQUIRED.every((h) => headers.includes(h)),

  parse(content) {
    const { headers, records } = readCsv(content);
    const missing = REQUIRED.filter((h) => !headers.includes(h));
    if (missing.length) throw new Error(`Not a Knab export, missing: ${missing.join(", ")}`);

    const rows: ParsedRow[] = [];
    const skipped: SkippedRow[] = [];
    let accountIdentifier: string | null = null;

    records.forEach((r, i) => {
      const line = i + 2;
      try {
        const account = clean(r["Rekeningnummer"]);
        accountIdentifier ??= account;
        const date = dateFromDutchOrIso(r["Transactiedatum"]);
        if (!date) throw new Error(`Invalid date "${r["Transactiedatum"] ?? ""}"`);
        const direction = (r["CreditDebet"] ?? "").trim().toLowerCase();
        const credit = direction === "c" || direction === "credit";
        const debit = direction === "d" || direction === "debet" || direction === "debit";
        if (!credit && !debit)
          throw new Error(`CreditDebet must be Credit or Debet, not "${r["CreditDebet"] ?? ""}"`);
        const magnitude = Math.abs(parseAmountToCents(r["Bedrag"] ?? "", ","));
        const amount = debit ? -magnitude : magnitude;
        const name = clean(r["Tegenrekeninghouder"]);
        const description = clean(r["Omschrijving"]);
        rows.push({
          date,
          amount,
          currency: clean(r["Valutacode"])?.toUpperCase() ?? "EUR",
          counterparty: name,
          counterpartyIban: clean(r["Tegenrekeningnummer"]),
          description,
          sourceKey: [account, date, amount, clean(r["Referentie"]), name, description].join("|"),
          balanceAfter: null,
        });
      } catch (e) {
        skipped.push({ line, reason: e instanceof Error ? e.message : String(e) });
      }
    });

    return { rows, skipped, accountIdentifier };
  },
};
