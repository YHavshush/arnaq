import { merchantKey } from "./merchant";

const MAX_DESCRIPTION = 80;

const IBAN = /\b[a-z]{2}\d{2}[a-z0-9]{4}\d{6,}\b/gi;
const EMAIL = /\S+@\S+\.\S+/g;
const URL_PATH = /https?:\/\/\S+|www\.\S+/gi;
const LONG_NUMBER = /\d{4,}/g;
const BOOKKEEPING =
  /\b(pasnr|pas ?volgnr|term(inal)?|kenmerk|transactie|betaalautomaat|ref(erentie)?)\b.*$/i;

/**
 * A description that is safe to send to a model: no IBANs, e-mail addresses, links, long numbers
 * (card, account and reference numbers) or card-statement bookkeeping, cut to a short length. What is
 * left is usually the shop and what was bought.
 */
export function scrubDescription(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(BOOKKEEPING, " ")
    .replace(IBAN, " ")
    .replace(EMAIL, " ")
    .replace(URL_PATH, " ")
    .replace(LONG_NUMBER, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_DESCRIPTION)
    .trim();
}

const BUSINESS_MARKER =
  /\b(b\.?v\.?|n\.?v\.?|v\.?o\.?f\.?|stichting|gmbh|ltd|limited|inc|llc|sa|ab)\b/i;

/**
 * Money to or from a person (a counterparty with an account number and no sign of being a business)
 * is never sent: the name is a private individual's. A business, or a transaction without an account
 * number, may be.
 */
export function looksLikePrivatePerson(
  counterparty: string | null | undefined,
  counterpartyIban: string | null | undefined,
): boolean {
  if (!counterpartyIban?.trim()) return false;
  return !BUSINESS_MARKER.test(counterparty ?? "");
}

export interface ScrubbableTransaction {
  counterparty: string | null;
  counterpartyIban: string | null;
  description: string | null;
}

/** What may be sent about a transaction, or null when nothing should be sent. */
export function toClassifyFields(
  t: ScrubbableTransaction,
): { merchant: string; description: string } | null {
  if (looksLikePrivatePerson(t.counterparty, t.counterpartyIban)) return null;
  const merchant = merchantKey(t.counterparty, t.description);
  if (!merchant) return null;
  return { merchant, description: scrubDescription(t.description) };
}
