import { parseAmountToCents } from "@/lib/money";
import { readCsv } from "../csv";
import type { BankParser, ParsedRow, SkippedRow } from "../types";
import { clean, dateFromCompact, dateFromDutchOrIso, ibanIn } from "./shared";

const REQUIRED = ["Datum", "Naam / Omschrijving", "Af Bij"];

/** The amount column is called "Bedrag (EUR)"; any header that starts with "Bedrag" is it. */
const amountHeader = (headers: string[]) => headers.find((h) => h.startsWith("Bedrag"));

/**
 * ING export ("Alle afschriften" as CSV, comma or semicolon separated): Datum (20260905), Naam / Omschrijving, Rekening,
 * Tegenrekening, Code, Af Bij ("Af" or "Bij"), Bedrag (EUR) (a positive 12,34), Mutatiesoort, Mededelingen and, in the
 * newer export, Saldo na mutatie. The sign comes from Af Bij, not from the amount.
 * NOTE: built against an invented sample that follows the documented layout. Verify against a real export.
 */
export const ingParser: BankParser = {
  bank: "ing",

  detect: (headers) =>
    REQUIRED.every((h) => headers.includes(h)) &&
    headers.includes("Mutatiesoort") &&
    amountHeader(headers) !== undefined,

  parse(content) {
    const { headers, records } = readCsv(content);
    const bedrag = amountHeader(headers);
    const missing = [
      ...REQUIRED.filter((h) => !headers.includes(h)),
      ...(bedrag ? [] : ["Bedrag (EUR)"]),
    ];
    if (missing.length || !bedrag)
      throw new Error(`Not an ING export, missing: ${missing.join(", ")}`);

    const rows: ParsedRow[] = [];
    const skipped: SkippedRow[] = [];
    let accountIdentifier: string | null = null;

    records.forEach((r, i) => {
      const line = i + 2;
      try {
        const account = clean(r["Rekening"]);
        accountIdentifier ??= account;
        const raw = clean(r["Datum"]);
        const date = dateFromCompact(raw ?? "") ?? dateFromDutchOrIso(raw ?? "");
        if (!date) throw new Error(`Invalid date "${raw}"`);
        const direction = (r["Af Bij"] ?? "").trim().toLowerCase();
        if (direction !== "af" && direction !== "bij")
          throw new Error(`Af Bij must be Af or Bij, not "${r["Af Bij"] ?? ""}"`);
        const magnitude = Math.abs(parseAmountToCents(r[bedrag] ?? "", ","));
        const amount = direction === "af" ? -magnitude : magnitude;
        const memo = clean(r["Mededelingen"]);
        const name = clean(r["Naam / Omschrijving"]);
        const saldoRaw = clean(r["Saldo na mutatie"]);
        let balanceAfter: number | null = null;
        try {
          balanceAfter = saldoRaw ? parseAmountToCents(saldoRaw, ",") : null;
        } catch {
          balanceAfter = null; // a balance we cannot read is left out; the row itself is fine
        }
        rows.push({
          date,
          amount,
          currency: "EUR",
          counterparty: name,
          counterpartyIban: clean(r["Tegenrekening"]) ?? ibanIn(memo),
          description: memo,
          sourceKey: [account, date, amount, saldoRaw, name, memo].join("|"),
          balanceAfter,
        });
      } catch (e) {
        skipped.push({ line, reason: e instanceof Error ? e.message : String(e) });
      }
    });

    return { rows, skipped, accountIdentifier };
  },
};
