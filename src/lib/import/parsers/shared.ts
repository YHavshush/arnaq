import { isDate } from "@/lib/recurring/dates";

/** A cell, trimmed; null when empty. */
export const clean = (v: string | undefined): string | null => {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
};

/** "20260905" to "2026-09-05" (ING, ABN AMRO); null when it is not a real date. */
export function dateFromCompact(v: string | undefined): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec((v ?? "").trim());
  const iso = m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  return iso && isDate(iso) ? iso : null;
}

/** "05-09-2026" or "2026-09-05" to "2026-09-05" (Knab); null when it is not a real date. */
export function dateFromDutchOrIso(v: string | undefined): string | null {
  const t = (v ?? "").trim();
  const dmy = /^(\d{2})[-/](\d{2})[-/](\d{4})$/.exec(t);
  const iso = dmy ? `${dmy[3]}-${dmy[2]}-${dmy[1]}` : /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
  return iso && isDate(iso) ? iso : null;
}

const IBAN = /\b[A-Z]{2}\d{2}[A-Z0-9]{4}\d{7}[A-Z0-9]{0,16}\b/;
/** An IBAN written in free text ("IBAN: NL91ABNA0417164300"); null when there is none. */
export const ibanIn = (text: string | null): string | null =>
  text ? (IBAN.exec(text)?.[0] ?? null) : null;
