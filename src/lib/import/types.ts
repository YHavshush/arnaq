import type { BANKS } from "@/db/schema";

export type Bank = (typeof BANKS)[number];

/** One bank transaction in the shape every parser returns. Amount in integer cents. */
export interface ParsedRow {
  date: string; // YYYY-MM-DD
  amount: number; // cents, negative = outgoing
  currency: string;
  counterparty: string | null;
  counterpartyIban: string | null;
  description: string | null;
  /** Stable per-row identity from the bank file, used for the dedupe hash. */
  sourceKey: string;
  /** The account balance after this row, in cents, when the file says so (or it can be worked out). */
  balanceAfter?: number | null;
}

export interface SkippedRow {
  line: number; // 1-based line in the file, header = 1
  reason: string;
}

export interface ParseResult {
  rows: ParsedRow[];
  skipped: SkippedRow[];
  /** Own account identifier found in the file (Rabobank IBAN), if any. */
  accountIdentifier: string | null;
  /** The period the file says it covers (YYYY-MM-DD, inclusive), when it says so. */
  period?: { from: string; to: string };
}

export interface BankParser {
  bank: Bank;
  /** True when the CSV header looks like this bank's export. */
  detect(headers: string[]): boolean;
  parse(content: string): ParseResult;
}
