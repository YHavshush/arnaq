import { parseAmountToCents } from "@/lib/money";
import { isDate } from "@/lib/recurring/dates";
import { readCsv } from "../csv";
import type { BankParser, ParsedRow, SkippedRow } from "../types";
import { looksLikeRevolutStatement, parseRevolutStatement } from "./revolut-statement";

const REQUIRED = ["Started Date", "Description", "Amount", "Currency", "State"];

/** The plain export names the kind of row in its Type column; these two are money moving between one's own accounts. */
const PLAIN_TYPES: Record<string, string> = { TOPUP: "Top up", EXCHANGE: "Exchange" };

/**
 * Revolut CSV export (the plain account export; the multi-part custom statement is read by revolut-statement.ts).
 * - Only COMPLETED rows are imported; PENDING and REVERTED are skipped.
 * - The fee column is folded into the amount (net effect on the balance).
 * - Non-EUR rows are imported with their own currency and are flagged downstream
 *   (never added into EUR totals).
 * Checked against a real export (Type, Product, Started Date, Completed Date, Description,
 * Amount, Fee, Currency, State, Balance).
 */
export const revolutParser: BankParser = {
  bank: "revolut",

  detect: (headers) => REQUIRED.every((h) => headers.includes(h)) && headers.includes("Product"),

  parse(content) {
    // The custom statement (several parts in one file) has its own reader; this one reads the plain export.
    if (looksLikeRevolutStatement(content)) return parseRevolutStatement(content);
    const { headers, records } = readCsv(content);
    const missing = REQUIRED.filter((h) => !headers.includes(h));
    if (missing.length) throw new Error(`Not a Revolut export, missing: ${missing.join(", ")}`);

    const rows: ParsedRow[] = [];
    const skipped: SkippedRow[] = [];

    records.forEach((r, i) => {
      const line = i + 2;
      try {
        const state = (r["State"] ?? "").trim().toUpperCase();
        if (state !== "COMPLETED") {
          skipped.push({ line, reason: `State ${state || "(empty)"}, only COMPLETED is imported` });
          return;
        }
        const started = (r["Started Date"] ?? "").trim();
        // The statement period is by completion, so a card payment started late on the 30th that
        // settled on the 1st belongs to the 1st (the bank's own month).
        const completed = (r["Completed Date"] ?? "").trim();
        const date = /^(\d{4}-\d{2}-\d{2})/.exec(completed || started)?.[1];
        if (!isDate(date)) throw new Error(`Invalid date "${completed || started}"`);
        const feeRaw = (r["Fee"] ?? "").trim();
        const fee = feeRaw === "" ? 0 : parseAmountToCents(feeRaw, ".");
        const amount = parseAmountToCents(r["Amount"] ?? "", ".") - fee;
        const currency = (r["Currency"] ?? "").trim().toUpperCase() || "EUR";
        const description = (r["Description"] ?? "").trim() || null;
        const balanceRaw = (r["Balance"] ?? "").trim();
        let balanceAfter: number | null = null;
        try {
          balanceAfter = balanceRaw === "" ? null : parseAmountToCents(balanceRaw, ".");
        } catch {
          balanceAfter = null;
        }
        rows.push({
          date,
          amount,
          currency,
          counterparty: description,
          counterpartyIban: null,
          description: fee !== 0 ? `${description ?? ""} (incl. fee)`.trim() : description,
          sourceKey: [started, description, r["Amount"], r["Fee"], currency, r["Balance"]].join(
            "|",
          ),
          balanceAfter,
          bankCategory: PLAIN_TYPES[(r["Type"] ?? "").trim().toUpperCase()] ?? null,
        });
      } catch (e) {
        skipped.push({ line, reason: e instanceof Error ? e.message : String(e) });
      }
    });

    return { rows, skipped, accountIdentifier: null };
  },
};
