import { parseAmountToCents } from "@/lib/money";
import { isDate } from "@/lib/recurring/dates";
import { cleanText } from "../clean";
import type { ParsedRow, ParseResult, SkippedRow } from "../types";

/** One piece of text on a PDF page: where it starts (x), where it ends (right) and its baseline (y). */
export interface PdfItem {
  str: string;
  x: number;
  right: number;
  y: number;
}

export interface StatementResult extends ParseResult {
  /** The period printed on the statement, inclusive. */
  period: { from: string; to: string };
  currency: string;
}

export class StatementError extends Error {}

// Column layout of a Rabobank "Rekeningafschrift" (PDF points). The columns are fixed in the
// bank's template, so they are read by position: date | type | counter account | name and
// description | debit (right aligned) | credit (right aligned).
const COL = {
  date: 60,
  type: [64, 88],
  iban: [86, 204],
  text: 204,
  amounts: 415,
  creditFrom: 520,
} as const;

/** Largest vertical gap between a row's own lines (the real pitch is about 10 points). */
const MAX_NOTE_GAP = 14;

const AMOUNT_RE = /^\d{1,3}(\.\d{3})*,\d{2}$|^\d+,\d{2}$/;
const LEGEND_RE = /^(?:[a-z]{2} = |CR = |D = )/;

interface Line {
  y: number;
  items: PdfItem[];
}

/** Items on (nearly) the same baseline form a line, left to right. Top of the page first. Linear. */
function toLines(items: PdfItem[]): Line[] {
  const lines: Line[] = [];
  for (const it of items.filter((i) => i.str.trim() !== "").sort((a, b) => b.y - a.y)) {
    const last = lines.at(-1); // sorted by y, so an item can only belong to the latest line
    if (last && Math.abs(last.y - it.y) <= 1.5) last.items.push(it);
    else lines.push({ y: it.y, items: [it] });
  }
  for (const l of lines) l.items.sort((a, b) => a.x - b.x);
  return lines;
}

/** Join items into text; pieces that touch stay together, a gap becomes one space. */
function joinItems(items: PdfItem[]): string {
  let out = "";
  items.forEach((it, i) => {
    const prev = items[i - 1];
    out += (prev && it.x - prev.right > 1.5 ? " " : "") + it.str.trim();
  });
  return out.trim();
}

const textOf = (line: Line) => joinItems(line.items);

const dmyToIso = (s: string): string | null => {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s);
  const iso = m ? `${m[3]}-${m[2]}-${m[1]}` : null;
  return isDate(iso) ? iso : null;
};

interface Phrase {
  text: string;
  x: number;
  right: number;
}

/** Words that are at most a word space apart form one phrase ("Datum vanaf", "528,79 CR"). */
function phrases(line: Line): Phrase[] {
  const out: Phrase[] = [];
  for (const it of line.items) {
    const last = out.at(-1);
    if (last && it.x - last.right <= 7) {
      last.text += (it.x - last.right > 1.5 ? " " : "") + it.str.trim();
      last.right = it.right;
    } else out.push({ text: it.str.trim(), x: it.x, right: it.right });
  }
  return out;
}

/** The value printed under a label (right or left aligned under it): what overlaps the label's span. */
function valueBelow(lines: Line[], label: string): string | null {
  const li = lines.findIndex((l) => phrases(l).some((p) => p.text === label));
  if (li === -1 || !lines[li + 1]) return null;
  const at = phrases(lines[li]).find((p) => p.text === label)!;
  const cells = phrases(lines[li + 1]).filter((p) => p.right >= at.x - 20 && p.x <= at.right + 2);
  return cells.length ? cells.map((c) => c.text).join(" ") : null;
}

function hasLabel(lines: Line[], label: string): boolean {
  return lines.some((l) => phrases(l).some((p) => p.text === label));
}

function money(label: string, raw: string | null): number {
  const m = raw ? /^(\S+)(?:\s+(CR|D))?$/.exec(raw) : null;
  if (!m || !AMOUNT_RE.test(m[1]))
    throw new StatementError(`Could not read "${label}" from the statement.`);
  const cents = parseAmountToCents(m[1], ",");
  return m[2] === "D" ? -cents : cents;
}

/**
 * Read a Rabobank PDF statement (already turned into positioned text) into transactions.
 * Totals on the first page are checked against what was read: both totals must match and opening
 * balance + credits - debits must equal the closing balance, otherwise the statement is refused.
 * That catches a missing, extra or mis-signed amount. It cannot see a wrong date or name, which is
 * why dates come from the bank's own "Verwerkingsdatum" and rows are read by fixed columns.
 */
export function parseRabobankStatement(pages: PdfItem[][]): StatementResult {
  const allLines = pages.map(toLines);
  const first = allLines[0] ?? [];

  const period = {
    from: dmyToIso(valueBelow(first, "Datum vanaf") ?? "") ?? "",
    to: dmyToIso(valueBelow(first, "Datum tot en met") ?? "") ?? "",
  };
  if (!period.from || !period.to)
    throw new StatementError("Could not read the period of the statement.");
  if (period.from > period.to)
    throw new StatementError("The period of the statement is not valid.");

  // "NL24 RABO 0359 8587 59 EUR": the account number followed by its currency.
  const ibanTokens = (valueBelow(first, "IBAN / Rekeningnummer") ?? "")
    .split(/\s+/)
    .filter(Boolean);
  const currency =
    ibanTokens.length > 2 && /^[A-Z]{3}$/.test(ibanTokens.at(-1)!) ? ibanTokens.pop()! : "EUR";
  const candidate = ibanTokens.join("");
  const accountIdentifier = /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(candidate) ? candidate : null;
  if (!accountIdentifier)
    throw new StatementError("Could not read the account number from the statement.");

  const opening = money("Beginsaldo", valueBelow(first, "Beginsaldo"));
  const closing = money("Eindsaldo", valueBelow(first, "Eindsaldo"));
  // A total can print blank (no money moved that way): the label is there, the value is not.
  const total = (label: string) =>
    hasLabel(first, label) && valueBelow(first, label) === null
      ? 0
      : money(label, valueBelow(first, label));
  const totalDebit = total("Totaal afgeschreven");
  const totalCredit = total("Totaal bijgeschreven");

  const rows: ParsedRow[] = [];
  const skipped: SkippedRow[] = [];
  let current: { head: Line; notes: Line[]; line: number } | null = null;
  let lineNo = 0;

  const finish = () => {
    if (!current) return;
    const { head, notes, line } = current;
    current = null;
    try {
      const dm = /^(\d{2})-(\d{2})$/.exec(joinItems(head.items.filter((i) => i.x < COL.date)));
      const amountItem = head.items.find((i) => i.x >= COL.amounts && AMOUNT_RE.test(i.str.trim()));
      if (!dm || !amountItem) throw new Error("Row without a date or an amount");
      const cents = parseAmountToCents(amountItem.str.trim(), ",");
      const amount = amountItem.right > COL.creditFrom ? cents : -cents;
      const type = joinItems(head.items.filter((i) => i.x >= COL.type[0] && i.x < COL.type[1]));
      const ibanRaw = joinItems(
        head.items.filter((i) => i.x >= COL.iban[0] && i.x < COL.iban[1]),
      ).replaceAll(" ", "");
      let name: string | null =
        cleanText(
          joinItems(
            head.items.filter(
              (i) => i.x >= COL.text && i.x < COL.amounts && !AMOUNT_RE.test(i.str.trim()),
            ),
          ),
          200,
        ) || null;
      const noteTexts = notes
        .map((n) => joinItems(n.items.filter((i) => i.x >= COL.text)))
        .filter(Boolean);
      // Some lines have an empty name column and start the name on the next line instead.
      if (
        !name &&
        noteTexts[0] &&
        !/^(Kenmerk|Verwerkingsdatum|Transactiereferentie|BETALINGSKENM)/i.test(noteTexts[0])
      )
        name = cleanText(noteTexts.shift()!, 200) || null;
      const processed = noteTexts
        .map((t) => /^Verwerkingsdatum:\s*(\d{2}-\d{2}-\d{4})$/.exec(t)?.[1])
        .find(Boolean);
      // The booking date (verwerkingsdatum) is what the bank's own CSV calls "Datum".
      const date = (processed && dmyToIso(processed)) || interestDate(dm[1], dm[2], period);
      if (!date) throw new Error("Date outside the statement period");
      const description =
        cleanText(noteTexts.filter((t) => !t.startsWith("Verwerkingsdatum:")).join(" "), 1000) ||
        null;
      const counterpartyIban = /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(ibanRaw) ? ibanRaw : null;
      rows.push({
        date,
        amount,
        currency,
        counterparty: name,
        counterpartyIban,
        description,
        sourceKey: [date, type, counterpartyIban ?? "", name ?? "", description ?? ""].join("|"),
      });
    } catch (e) {
      skipped.push({ line, reason: e instanceof Error ? e.message : String(e) });
    }
  };

  for (const lines of allLines) {
    const headerIdx = lines.findIndex((l) => textOf(l).includes("Naam/omschrijving"));
    if (headerIdx === -1) continue;
    let prevY: number | null = null;
    for (const line of lines.slice(headerIdx + 1)) {
      const text = textOf(line);
      if (text === "datum") continue;
      if (LEGEND_RE.test(text)) break; // the footer legend: everything below is not a transaction
      const dateCell = line.items[0];
      const startsRow =
        dateCell && dateCell.x < COL.date && /^\d{2}-\d{2}$/.test(dateCell.str.trim());
      // Description lines sit one line pitch (about 10 points) apart; a bigger jump below the last
      // line is page furniture (a page number, a footer), not part of the transaction.
      if (!startsRow && prevY !== null && prevY - line.y > MAX_NOTE_GAP) break;
      lineNo++;
      prevY = line.y;
      if (startsRow) {
        finish();
        current = { head: line, notes: [], line: lineNo };
      } else if (current) {
        current.notes.push(line); // also the top of a page continuing the previous page's row
      }
    }
  }
  finish();

  const debit = rows.filter((r) => r.amount < 0).reduce((s, r) => s - r.amount, 0);
  const credit = rows.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0);
  if (
    skipped.length > 0 ||
    debit !== totalDebit ||
    credit !== totalCredit ||
    opening - debit + credit !== closing
  ) {
    throw new StatementError(
      "The statement could not be read reliably: the transactions do not match the totals and balances on the statement. Nothing was imported. Download the statement again or use the CSV export.",
    );
  }
  // The statement lists its rows in order and adds up to the closing balance (checked above), so the
  // balance after each row follows from the opening balance.
  let running = opening;
  for (const r of rows) {
    running += r.amount;
    r.balanceAfter = running;
  }
  return { rows, skipped, accountIdentifier, period, currency };
}

/** dd-mm without a year, placed in the year that puts it inside the statement period. */
function interestDate(dd: string, mm: string, period: { from: string; to: string }): string | null {
  for (const y of [Number(period.from.slice(0, 4)), Number(period.to.slice(0, 4))]) {
    const iso = `${y}-${mm}-${dd}`;
    if (isDate(iso) && iso >= period.from && iso <= period.to) return iso;
  }
  return null;
}

/** Looks like a Rabobank statement? (Used before the stricter parse above.) */
export function looksLikeRabobankStatement(pages: PdfItem[][]): boolean {
  const text = (pages[0] ?? []).map((i) => i.str).join(" ");
  return (
    text.includes("Rekeningafschrift") &&
    (text.includes("Naam/omschrijving") || text.includes("Beginsaldo"))
  );
}
