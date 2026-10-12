/** Text from a bank file or a file name, made safe to store and show: no control characters
 * (Postgres cannot store NUL), no lone surrogates, no bidi overrides, and a length cap. */
export function cleanText(s: string, max: number): string {
  const wellFormed = typeof s.toWellFormed === "function" ? s.toWellFormed() : s;
  return wellFormed
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F‪-‮⁦-⁩]/g, "")
    .trim()
    .slice(0, max);
}
