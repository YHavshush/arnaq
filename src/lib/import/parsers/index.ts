import { readHeaders } from "../csv";
import type { Bank, BankParser } from "../types";
import { abnamroParser, looksLikeAbnTxt } from "./abnamro";
import { ingParser } from "./ing";
import { knabParser } from "./knab";
import { rabobankParser } from "./rabobank";
import { revolutParser } from "./revolut";
import { looksLikeRevolutStatement } from "./revolut-statement";

const parsers: Record<Bank, BankParser> = {
  rabobank: rabobankParser,
  revolut: revolutParser,
  abnamro: abnamroParser,
  ing: ingParser,
  knab: knabParser,
};

export function getParser(bank: Bank): BankParser {
  return parsers[bank];
}

/** Guess which bank produced a CSV from its header row (or, for a Revolut custom statement, its sections). Returns null if unknown. */
export function detectBank(content: string): Bank | null {
  // Revolut's multi-part custom statement has no header row of its own; it is found by its section titles.
  if (looksLikeRevolutStatement(content)) return "revolut";
  // ABN AMRO's TXT has no header row at all; it is found by the shape of its first line.
  if (looksLikeAbnTxt(content)) return "abnamro";
  const headers = readHeaders(content);
  return (Object.values(parsers).find((p) => p.detect(headers))?.bank as Bank | undefined) ?? null;
}
