/** Lowercase, strip accents, collapse whitespace. "  Café  Voorbeeld BV " -> "cafe voorbeeld bv". */
export function normaliseCounterparty(s: string | null | undefined): string {
  return (s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Uppercase without spaces. " nl00 rabo 0000 0000 01" -> "NL00RABO0000000001". */
export function normaliseIban(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, "").toUpperCase();
}

/** The shorter side of a substring match must be at least this long, so "ab" matches nothing. */
const MIN_CONTAINED_LENGTH = 3;

/**
 * Counterparty names drift between banks and exports: Rabobank says "Spotify AB", Revolut
 * says "Spotify", a landlord shows up as "Verhuurder Voorbeeld BV" one month and truncated
 * as "Verhuurder Voorbeeld" the next. Exact equality would miss those, so after normalising
 * we accept a substring match in either direction (with a minimum length to avoid trivial
 * hits). The amount tolerance and the date window keep this loose name test honest.
 */
export function counterpartyMatches(pattern: string | null, counterparty: string | null): boolean {
  const a = normaliseCounterparty(pattern);
  const b = normaliseCounterparty(counterparty);
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= MIN_CONTAINED_LENGTH && long.includes(short);
}

export interface Identity {
  matchCounterparty: string | null;
  matchIban: string | null;
}

/**
 * Does a transaction belong to a recurring item by who it was paid to / received from?
 * When both the item and the transaction carry an IBAN, the IBAN decides (an IBAN is exact,
 * a name is not). Otherwise fall back to the counterparty name.
 */
export function identityMatches(
  item: Identity,
  t: { counterparty: string | null; counterpartyIban: string | null },
): boolean {
  const itemIban = normaliseIban(item.matchIban);
  const txIban = normaliseIban(t.counterpartyIban);
  if (itemIban && txIban) return itemIban === txIban;
  return counterpartyMatches(item.matchCounterparty, t.counterparty);
}
