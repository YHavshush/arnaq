import { normaliseCounterparty } from "@/lib/recurring/normalise";

/** Whole-word, accent- and case-insensitive: "btw" is in "To EUR BTW" but not in "Tubtwo". */
export const words = (s: string | null | undefined) =>
  ` ${normaliseCounterparty(s)
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;

/** True when the needle appears as a whole word in any of the texts. */
export const mentions = (text: Array<string | null>, needle: string) =>
  words(text.filter(Boolean).join(" ")).includes(words(needle));
