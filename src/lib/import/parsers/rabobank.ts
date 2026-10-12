import { parseAmountToCents } from "@/lib/money";
import { isDate } from "@/lib/recurring/dates";
import { readCsv } from "../csv";
import type { BankParser, ParsedRow, SkippedRow } from "../types";

const REQUIRED = ["IBAN/BBAN", "Datum", "Bedrag"];

const clean = (v: string | undefined) => {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
};

/**
 * Rabobank CSV export ("CSV (kommagescheiden)" or semicolon-separated).
 * NOTE: built against an anonymised sample that follows the documented column layout.
 * Verify against a real export (see tests/fixtures/README.md).
 */
export const rabobankParser: BankParser = {
  bank: "rabobank",

  detect: (headers) => REQUIRED.every((h) => headers.includes(h)) && headers.includes("Volgnr"),

  parse(content) {
    const { headers, records } = readCsv(content);
    const missing = REQUIRED.filter((h) => !headers.includes(h));
    if (missing.length) throw new Error(`Not a Rabobank export, missing: ${missing.join(", ")}`);

    const rows: ParsedRow[] = [];
    const skipped: SkippedRow[] = [];
    let accountIdentifier: string | null = null;

    records.forEach((r, i) => {
      const line = i + 2;
      try {
        const iban = clean(r["IBAN/BBAN"]);
        accountIdentifier ??= iban;
        const date = clean(r["Datum"]);
        if (!isDate(date)) throw new Error(`Invalid date "${date}"`);
        const amount = parseAmountToCents(r["Bedrag"] ?? "", ",");
        const description =
          [r["Omschrijving-1"], r["Omschrijving-2"], r["Omschrijving-3"]]
            .map((p) => (p ?? "").trim())
            .filter(Boolean)
            .join(" ") || null;
        const volgnr = clean(r["Volgnr"]);
        rows.push({
          date,
          amount,
          currency: clean(r["Munt"]) ?? "EUR",
          counterparty: clean(r["Naam tegenpartij"]),
          counterpartyIban: clean(r["Tegenrekening IBAN/BBAN"]),
          description,
          sourceKey: [iban, volgnr, date, clean(r["Transactiereferentie"])].join("|"),
        });
      } catch (e) {
        skipped.push({ line, reason: e instanceof Error ? e.message : String(e) });
      }
    });

    return { rows, skipped, accountIdentifier };
  },
};
