import { createHash } from "node:crypto";
import { cleanText } from "@/lib/import/clean";
import type { ParsedRow, SkippedRow } from "@/lib/import/types";
import { MAX_CENTS, parseAmountToCents } from "@/lib/money";
import { isDate } from "@/lib/recurring/dates";
import type { Balance } from "./enable-banking";
import { normaliseIban } from "./enable-banking";

/**
 * Enable Banking transactions in the shape every bank file parser returns (ParsedRow), so a bank link goes through the
 * same importer as an uploaded file. Every field is untrusted: dates are checked, amounts are parsed from their decimal
 * text with integer arithmetic only (never a float), text is cleaned and capped.
 */

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const text = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  return cleanText(v.slice(0, max * 2), max) || null;
};

/**
 * Decimal text from the API ("12.30", "-5", "1.230") in cents, or null when it is not a plain amount. More than two
 * decimals is accepted only when the extra digits are zeros: a fraction of a cent is never rounded away silently.
 */
export function decimalToCents(raw: unknown): number | null {
  if (typeof raw !== "string" || raw.length > 32) return null;
  const m = /^([+-])?(\d{1,13})(?:\.(\d{1,8}))?$/.exec(raw.trim());
  if (!m) return null;
  const [, sign, whole, fraction = ""] = m;
  if (fraction.length > 2 && !/^0+$/.test(fraction.slice(2))) return null;
  try {
    const cents = parseAmountToCents(`${whole}.${fraction.slice(0, 2) || "0"}`, ".");
    if (Math.abs(cents) > MAX_CENTS) return null;
    return sign === "-" ? -cents : cents;
  } catch {
    return null;
  }
}

const currencyOf = (v: unknown): string | null => {
  const c = obj(v)?.currency;
  return typeof c === "string" && /^[A-Z]{3}$/.test(c) ? c : null;
};

const keyPart = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 && s.length <= 200 && /^[\x21-\x7e]+$/.test(s) ? s : null;
};

export interface Converted {
  rows: ParsedRow[];
  skipped: SkippedRow[];
}

/**
 * Turn one link's transactions into rows. Only booked ones count (BOOK; a missing status is taken as booked, since
 * only booked ones were asked for). With `range`, a row dated outside it is skipped. `line` in a skipped row is the
 * transaction's position, 1-based.
 */
export function convertTransactions(
  raw: unknown[],
  range?: { from: string; to: string },
): Converted {
  const rows: ParsedRow[] = [];
  const skipped: SkippedRow[] = [];
  raw.forEach((item, i) => {
    const line = i + 1;
    const t = obj(item);
    if (!t) return skipped.push({ line, reason: "Not a transaction." });
    if (t.status !== undefined && t.status !== null && t.status !== "BOOK") return; // pending, cancelled: not money yet
    const date = [t.booking_date, t.value_date, t.transaction_date].find(
      (d): d is string => typeof d === "string" && isDate(d),
    );
    if (!date) return skipped.push({ line, reason: "No valid date." });
    // A date far outside what was asked for is not believed (it would land in a month nobody fetched).
    if (range && (date < range.from || date > range.to))
      return skipped.push({ line, reason: "Date outside the period asked for." });
    const amountObj = obj(t.transaction_amount);
    const currency = currencyOf(amountObj);
    const cents = decimalToCents(amountObj?.amount);
    if (cents === null || !currency) return skipped.push({ line, reason: "No valid amount." });
    const indicator = t.credit_debit_indicator;
    const outgoing = indicator === "DBIT" ? true : indicator === "CRDT" ? false : cents < 0;
    const amount = outgoing ? -Math.abs(cents) : Math.abs(cents);

    // The other side: who was paid on money out, who paid on money in.
    const party = obj(outgoing ? t.creditor : t.debtor);
    const partyAccount = obj(outgoing ? t.creditor_account : t.debtor_account);
    const counterparty = text(party?.name, 200);
    const counterpartyIban = normaliseIban(partyAccount?.iban);
    const remittance = Array.isArray(t.remittance_information)
      ? t.remittance_information
          .slice(0, 20)
          .map((r) => text(r, 500))
          .filter((r): r is string => r !== null)
          .join(" ")
      : "";
    const description =
      text(remittance, 1000) ??
      text(t.note, 1000) ??
      text(obj(t.bank_transaction_code)?.description, 200);

    const balance = obj(t.balance_after_transaction);
    const balanceCents = currencyOf(balance) === currency ? decimalToCents(balance?.amount) : null;

    const reference = keyPart(t.entry_reference);
    const id = keyPart(t.transaction_id);
    const sourceKey = reference
      ? `eb:ref:${reference}`
      : id
        ? `eb:id:${id}`
        : `eb:h:${createHash("sha256")
            .update(
              JSON.stringify([date, amount, currency, counterparty, counterpartyIban, description]),
            )
            .digest("hex")}`;

    rows.push({
      date,
      amount,
      currency,
      counterparty,
      counterpartyIban,
      description,
      sourceKey,
      balanceAfter: balanceCents,
      bankCategory: null,
    });
  });
  return { rows, skipped };
}

/** Balance types that are the booked balance after the last booked transaction (not "available", which adds credit). */
const BOOKED = ["CLBD", "ITBD"];

/**
 * The bank's booked balance names the transaction it ends with (last_committed_transaction): that transaction's balance
 * after is then known exactly, without guessing an order. Fills it in on that one row when the row has none, which
 * gives the forecast a real balance for accounts whose bank gives no balance per transaction.
 *
 * Some banks (Rabobank and Revolut through Enable Banking) name no transaction. Then the booked balance, which is the
 * balance now, goes on the newest transaction fetched, when it carries none and the balance is not older than it.
 */
export function applyReportedBalance(rows: ParsedRow[], balances: Balance[]): void {
  for (const type of BOOKED) {
    const b = balances.find((x) => x.type === type && x.lastCommittedTransaction);
    if (!b) continue;
    const ref = keyPart(b.lastCommittedTransaction);
    const cents = decimalToCents(b.amount);
    if (!ref || cents === null) continue;
    const row = rows.find(
      (r) =>
        (r.sourceKey === `eb:ref:${ref}` || r.sourceKey === `eb:id:${ref}`) &&
        r.currency === b.currency,
    );
    if (row && row.balanceAfter == null) row.balanceAfter = cents;
    return;
  }
  for (const type of BOOKED) {
    const b = balances.find((x) => x.type === type);
    const cents = b ? decimalToCents(b.amount) : null;
    if (!b || cents === null) continue;
    const same = rows.filter((r) => r.currency === b.currency);
    // The newest day, and the last row of it in the order the bank sent them (the importer stores them in that order).
    const newest = same.reduce((max, r) => (r.date > max ? r.date : max), "");
    const row = same.filter((r) => r.date === newest).at(-1);
    const reference = b.referenceDate?.slice(0, 10) ?? null;
    if (row && row.balanceAfter == null && (reference === null || reference >= row.date))
      row.balanceAfter = cents;
    return;
  }
}
