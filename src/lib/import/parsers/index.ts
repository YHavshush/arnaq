import { readHeaders } from "../csv";
import type { Bank, BankParser } from "../types";
import { rabobankParser } from "./rabobank";
import { revolutParser } from "./revolut";
import { looksLikeRevolutStatement } from "./revolut-statement";

const parsers: Record<Bank, BankParser> = {
  rabobank: rabobankParser,
  revolut: revolutParser,
};

export function getParser(bank: Bank): BankParser {
  return parsers[bank];
}

/** Guess which bank produced a CSV from its header row (or, for a Revolut custom statement, its sections). Returns null if unknown. */
export function detectBank(content: string): Bank | null {
  // Revolut's multi-part custom statement has no header row of its own; it is found by its section titles.
  if (looksLikeRevolutStatement(content)) return "revolut";
  const headers = readHeaders(content);
  return (Object.values(parsers).find((p) => p.detect(headers))?.bank as Bank | undefined) ?? null;
}
