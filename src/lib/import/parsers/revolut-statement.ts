import Papa from "papaparse";
import { parseAmountToCents } from "@/lib/money";
import { isDate } from "@/lib/recurring/dates";
import type { ParsedRow, ParseResult } from "../types";

/**
 * Revolut "Custom Statement", exported as a spreadsheet (CSV). It is one file with several parts: summaries of the
 * current and savings accounts (account number, opening and closing balance), a table of the current account's
 * transactions with a running balance, and a savings table that holds interest only.
 *
 * Only the current account's transactions are read. A statement is accepted only when it adds up: the opening
 * balance plus every amount gives the closing balance, and each running balance follows from the one before it.
 * Anything else is refused whole, so a half-read statement can never skew the budget.
 *
 * Checked against a real statement (916 transactions, every balance followed). The amounts already include any
 * fee, so nothing is subtracted again.
 */
const TITLE = {
  currentSummary: "Current Accounts Summaries",
  savingsSummary: "Savings Accounts Summaries",
  transactions: "Current Accounts Transaction Statements",
  savingsTransactions: "Savings Accounts Transaction Statements",
} as const;

const NOT_RELIABLE =
  "The statement could not be read reliably: the transactions do not match the totals and balances on the statement. Nothing was imported. Download the statement again from Revolut.";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** True for a Revolut custom statement (as opposed to the plain account export or another bank). */
export function looksLikeRevolutStatement(content: string): boolean {
  // Plain scanning, not a pattern: a crafted file of blank lines must not be able to make this slow.
  const text = content.slice(0, 200_000);
  return [TITLE.currentSummary, TITLE.transactions].some((title) => {
    for (let i = text.indexOf(title); i >= 0; i = text.indexOf(title, i + 1)) {
      let j = i - 1;
      while (
        j >= 0 &&
        (text[j] === " " || text[j] === "\t" || text[j] === '"' || text[j] === "\uFEFF")
      )
        j--;
      if (j < 0 || text[j] === "\n" || text[j] === "\r") return true;
    }
    return false;
  });
}

const cell = (row: string[] | undefined, i: number) => (row?.[i] ?? "").trim();

/** "Oct 7, 2026" -> "2026-10-07". */
function parseDate(text: string): string {
  const m = /^([A-Za-z]{3})[A-Za-z]*\.? (\d{1,2}), (\d{4})$/.exec(text.trim());
  const month = m ? MONTHS.indexOf(m[1].toLowerCase()) + 1 : 0;
  if (!m || month === 0) throw new Error(`Unreadable date "${text}"`);
  const iso = `${m[3]}-${String(month).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  if (!isDate(iso)) throw new Error(`Unreadable date "${text}"`);
  return iso;
}

/** "-€1,234.56" or "€5.00" -> cents. */
function parseMoney(text: string): number {
  const cleaned = text.replace(/[\s€$£]/g, "").replace("−", "-");
  return parseAmountToCents(cleaned, ".");
}

export function parseRevolutStatement(content: string): ParseResult {
  const grid = Papa.parse<string[]>(content.replace(/^﻿/, ""), {
    skipEmptyLines: false,
    delimitersToGuess: [",", ";"],
  }).data;
  const at = (title: string, from = 0) =>
    grid.findIndex((r, i) => i >= from && cell(r, 0) === title);

  const txStart = at(TITLE.transactions);
  if (txStart < 0) throw new Error("Not a Revolut statement: the transactions part was not found.");
  const savingsTx = at(TITLE.savingsTransactions, txStart);
  const txEnd = savingsTx < 0 ? grid.length : savingsTx;

  // The current account's own opening and closing balance: the first ones in the file (the savings account's follow).
  const summaryEnd = Math.min(...[at(TITLE.savingsSummary), txStart].filter((i) => i >= 0));
  const balanceAfterLabel = (label: string): string | null => {
    for (let i = 0; i < summaryEnd; i++)
      for (let c = 0; c < (grid[i]?.length ?? 0) - 1; c++)
        if (cell(grid[i], c) === label) return cell(grid[i], c + 1);
    return null;
  };
  const openingText = balanceAfterLabel("Opening balance");
  const closingText = balanceAfterLabel("Closing balance");
  if (!openingText || !closingText)
    throw new Error(
      "The opening or closing balance is missing from the statement, so it cannot be checked.",
    );
  let opening: number;
  let closing: number;
  try {
    opening = parseMoney(openingText);
    closing = parseMoney(closingText);
  } catch {
    throw new Error("The opening or closing balance on the statement could not be read.");
  }

  // The currency named in the account's title ("Personal Account (EUR)").
  let currency = "EUR";
  for (let i = txStart + 1; i < txEnd; i++) {
    const m = /\(([A-Z]{3})\)\s*$/.exec(cell(grid[i], 0));
    if (m) {
      currency = m[1];
      break;
    }
  }

  const headerRows: number[] = [];
  for (let i = txStart + 1; i < txEnd; i++) if (cell(grid[i], 0) === "Date") headerRows.push(i);
  if (headerRows.length === 0)
    throw new Error("Not a Revolut statement: no transactions table found.");
  if (headerRows.length > 1)
    throw new Error(
      "This statement holds more than one account. Export one account at a time and upload it again.",
    );
  const headerIdx = headerRows[0];
  const header = (grid[headerIdx] ?? []).map((h) => h.trim());
  const col = (name: string) => header.indexOf(name);
  const [cDate, cDesc, cCat, cAmount, cBalance] = [
    col("Date"),
    col("Description"),
    col("Category"),
    col("Money in/out"),
    col("Balance"),
  ];
  if ([cDate, cDesc, cAmount, cBalance].includes(-1))
    throw new Error("Not a Revolut statement: the transactions table lacks expected columns.");

  const rows: ParsedRow[] = [];
  let previous = opening;
  for (let i = headerIdx + 1; i < txEnd; i++) {
    const r = grid[i] ?? [];
    const first = cell(r, 0);
    if (first === "Total" || first.startsWith("---")) break;
    if (r.every((c) => c.trim() === "")) continue;
    let date: string;
    let amount: number;
    let balanceAfter: number;
    try {
      date = parseDate(first);
      amount = parseMoney(cell(r, cAmount));
      balanceAfter = parseMoney(cell(r, cBalance));
    } catch (e) {
      throw new Error(
        `${NOT_RELIABLE} (line ${i + 1}: ${e instanceof Error ? e.message : "unreadable row"})`,
      );
    }
    if (previous + amount !== balanceAfter)
      throw new Error(
        `${NOT_RELIABLE} (the balance after line ${i + 1} does not follow from the one before)`,
      );
    previous = balanceAfter;
    const description = cell(r, cDesc) || null;
    rows.push({
      date,
      amount,
      currency,
      counterparty: description,
      counterpartyIban: null,
      description,
      sourceKey: [
        first,
        description,
        cCat >= 0 ? cell(r, cCat) : "",
        cell(r, cAmount),
        cell(r, cBalance),
      ].join("|"),
      balanceAfter,
      bankCategory: cCat >= 0 ? cell(r, cCat) || null : null,
    });
  }
  if (previous !== closing)
    throw new Error(`${NOT_RELIABLE} (the closing balance does not match the transactions)`);

  const dates = rows.map((r) => r.date).sort();
  return {
    rows,
    skipped: [],
    // The plain export carries no account number either; leaving it out keeps an existing Revolut account in use.
    accountIdentifier: null,
    period: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : undefined,
  };
}
