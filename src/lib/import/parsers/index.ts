import { readHeaders } from "../csv";
import type { Bank, BankParser } from "../types";
import { rabobankParser } from "./rabobank";
import { revolutParser } from "./revolut";

const parsers: Record<Bank, BankParser> = {
  rabobank: rabobankParser,
  revolut: revolutParser,
};

export function getParser(bank: Bank): BankParser {
  return parsers[bank];
}

/** Guess which bank produced a CSV from its header row. Returns null if unknown. */
export function detectBank(content: string): Bank | null {
  const headers = readHeaders(content);
  return (Object.values(parsers).find((p) => p.detect(headers))?.bank as Bank | undefined) ?? null;
}
