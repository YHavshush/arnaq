import { parseAmountToCents } from "@/lib/money";
import type { BankParser, ParsedRow, SkippedRow } from "../types";
import { clean, dateFromCompact, ibanIn } from "./shared";

/**
 * ABN AMRO export ("TXT", tab separated, no header row), also the same eight columns saved as CSV or from the XLS with
 * a header row: account number, currency, date (20260905), balance before, balance after, value date, amount (-12,34),
 * description. Each row carries the balance after it, which is what the duplicate check leans on.
 * NOTE: built against an invented sample that follows the documented layout. Verify against a real export.
 */
const HEADER_WORDS = ["rekeningnummer", "transactiedatum", "transactiebedrag", "beginsaldo"];

const splitLine = (line: string) => line.split(line.includes("\t") ? "\t" : ";");

const isDataLine = (cols: string[]) =>
  cols.length >= 8 && /^[A-Z]{3}$/.test(cols[1].trim()) && /^\d{8}$/.test(cols[2].trim());

/** A header-less ABN AMRO TXT file is found by the shape of its first line. */
export function looksLikeAbnTxt(content: string): boolean {
  const first = content
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .find((l) => l.trim() !== "");
  return first !== undefined && isDataLine(splitLine(first));
}

/** What the description says about who the money went to, by the three shapes ABN AMRO writes. */
export function abnCounterparty(description: string): string | null {
  const sepa =
    /(?:^|\s)Naam:\s*(.+?)(?=\s+(?:Omschrijving|Kenmerk|Machtiging|Incassant|IBAN|BIC):|$)/.exec(
      description,
    );
  if (sepa) return clean(sepa[1]);
  const slash = /\/NAME\/(.+?)(?=\/(?:REMI|EREF|ADDR|CSID|ISDT|BIC|IBAN)\/|$)/.exec(description);
  if (slash) return clean(slash[1]);
  // "BEA   NR:XX123 01.10.26/12.34 Albert Heijn 1234 AMSTERDAM,PAS123": the shop is between the time and ",PAS"
  const card = /\d{2}\.\d{2}\.\d{2}\/\d{2}\.\d{2}\s+(.+?)(?:,PAS\S*)?$/.exec(description);
  if (card) return clean(card[1]);
  return null;
}

export const abnamroParser: BankParser = {
  bank: "abnamro",

  // A file with a header row (saved from the XLS). The header-less TXT is found by `looksLikeAbnTxt`.
  detect: (headers) => {
    const lower = headers.map((h) => h.toLowerCase());
    return HEADER_WORDS.filter((w) => lower.includes(w)).length >= 3;
  },

  parse(content) {
    const lines = content
      .replace(/^﻿/, "")
      .split(/\r?\n/)
      .map((text, i) => ({ text, line: i + 1 }))
      .filter((l) => l.text.trim() !== "");
    if (lines.length === 0) throw new Error("Not an ABN AMRO export, the file is empty");

    const rows: ParsedRow[] = [];
    const skipped: SkippedRow[] = [];
    let accountIdentifier: string | null = null;
    let sawData = false;

    for (const { text, line } of lines) {
      const cols = splitLine(text);
      if (!isDataLine(cols)) {
        // Only a header row may be skipped quietly; anything else is reported.
        if (HEADER_WORDS.some((w) => text.toLowerCase().includes(w))) continue;
        skipped.push({ line, reason: "Not a transaction line" });
        continue;
      }
      sawData = true;
      try {
        const account = clean(cols[0]);
        accountIdentifier ??= account;
        const date = dateFromCompact(cols[2]);
        if (!date) throw new Error(`Invalid date "${cols[2]}"`);
        const amount = parseAmountToCents(cols[6], ",");
        let balanceAfter: number | null = null;
        try {
          balanceAfter = parseAmountToCents(cols[4], ",");
        } catch {
          balanceAfter = null; // a balance we cannot read is left out; the row itself is fine
        }
        const description = clean(cols.slice(7).join(" ").replace(/\s+/g, " "));
        const counterparty = description ? (abnCounterparty(description) ?? description) : null;
        rows.push({
          date,
          amount,
          currency: cols[1].trim(),
          counterparty,
          counterpartyIban: ibanIn(description),
          description,
          sourceKey: [account, date, amount, balanceAfter, description].join("|"),
          balanceAfter,
        });
      } catch (e) {
        skipped.push({ line, reason: e instanceof Error ? e.message : String(e) });
      }
    }
    if (!sawData && rows.length === 0 && skipped.length === lines.length)
      throw new Error("Not an ABN AMRO export, no transaction lines found");
    return { rows, skipped, accountIdentifier };
  },
};
