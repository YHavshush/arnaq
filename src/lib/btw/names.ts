/** A client name or pocket word that cannot be stored (the message is English; it is translated at the API edge). */
export class BtwError extends Error {}

const MAX_LENGTH = 60;

/**
 * A name as typed, tidied: spaces trimmed and collapsed. Empty gives null. Too long, or without a letter or digit (the
 * match works on whole words, so punctuation alone never matches), is refused.
 */
export function cleanBtwName(v: string): string | null {
  const text = v.trim().replace(/\s+/g, " ");
  if (text.length > MAX_LENGTH) throw new BtwError(`The name is too long (max ${MAX_LENGTH}).`);
  if (text !== "" && !/[\p{L}\p{N}]/u.test(text))
    throw new BtwError("Use letters or numbers in the name.");
  return text === "" ? null : text;
}
