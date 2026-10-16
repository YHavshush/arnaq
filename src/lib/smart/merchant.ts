import { normaliseCounterparty } from "@/lib/recurring/normalise";

/**
 * Payment processors and terminals put themselves in front of the shop's name:
 * "CCV*Bakkerij Voorbeeld", "SumUp  *Kapper", "Paypal *Etsy". The shop is what follows.
 */
const PROCESSOR_PREFIX =
  /^(ccv\s*\*?|sumup\s*\*?|zettle\s*_?\s*\*?|izettle\s*\*?|paypal\s*\*?|mollie\s*\*?|adyen\s*\*?|stripe\s*\*?|bcm\s*\*?|pay\.nl\s*\*?|square\s*\*?|sq\s*\*)\s*/;

/** Words that are not part of a name: legal forms and card-statement noise. */
const NOISE = new Set([
  "bv",
  "b.v.",
  "b.v",
  "nv",
  "n.v.",
  "n.v",
  "vof",
  "v.o.f.",
  "cv",
  "c.v.",
  "ltd",
  "limited",
  "gmbh",
  "inc",
  "llc",
  "sa",
  "ab",
  "nederland",
  "netherlands",
  "holland",
  "the",
]);

/** Everything from one of these words on is statement bookkeeping, not a name. */
const CUT_AT = new Set([
  "pasnr",
  "pas",
  "term",
  "terminal",
  "kenmerk",
  "ref",
  "referentie",
  "datum",
  "transactie",
  "betaalautomaat",
]);

const COUNTRY_CODES = new Set([
  "nl",
  "de",
  "be",
  "uk",
  "gb",
  "ie",
  "fr",
  "es",
  "it",
  "us",
  "lu",
  "at",
  "pl",
  "se",
  "dk",
]);

const MAX_WORDS = 3;

/**
 * A short, stable key for "who was paid": the normalised name without branch numbers, legal forms,
 * processors and card bookkeeping, at most three words. "Albert Heijn 1234 Zoetermeer NLD" and
 * "ALBERT HEIJN 5678 DELFT" both start "albert heijn"; learned labels and the history layer work on it.
 * Empty when there is nothing to go on (the transaction is then left to the person).
 */
export function merchantKey(
  counterparty: string | null | undefined,
  description?: string | null,
): string {
  let text = normaliseCounterparty(counterparty);
  const fromProcessor = PROCESSOR_PREFIX.test(text);
  text = text.replace(PROCESSOR_PREFIX, "");
  // The processor's own name tells us nothing; the shop is in the rest, or in the description.
  if (!text || (fromProcessor && text.length < 3)) text = normaliseCounterparty(description);
  if (!text) return "";

  const words: string[] = [];
  for (const raw of text.split(/[\s/|,;]+/)) {
    const word = raw.replace(/^[^a-z0-9]+|[^a-z0-9.&'-]+$/g, "");
    if (!word) continue;
    if (CUT_AT.has(word)) break;
    if (/\d/.test(word)) continue; // branch numbers, terminal ids, dates
    if (NOISE.has(word)) continue;
    words.push(word);
    if (words.length === MAX_WORDS + 1) break;
  }
  // A trailing country code ("... nl") is not part of the name.
  while (words.length > 1 && COUNTRY_CODES.has(words[words.length - 1])) words.pop();
  return words.slice(0, MAX_WORDS).join(" ");
}
