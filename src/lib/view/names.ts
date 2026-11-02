const LEGAL = /\s+(n\.?v\.?|b\.?v\.?|v\.?o\.?f\.?|c\.?v\.?|ltd|gmbh|inc)$/i;

/**
 * A name as a person would write it: banks shout them in capitals and add the legal form ("FBTO ZORGVERZEKERINGEN NV").
 * The legal form goes, and a name that is all capitals is written as words, keeping short ones (FBTO, NS) in capitals.
 * A name that already has lower case is left as it is.
 */
export function displayName(name: string): string {
  const trimmed = name.trim();
  const stripped = trimmed.replace(LEGAL, "").trim() || trimmed;
  const letters = stripped.replace(/[^A-Za-z]/g, "");
  if (letters.length < 4 || stripped !== stripped.toUpperCase()) return stripped;
  return stripped
    .split(/(\s+)/)
    .map((word) =>
      /^[A-Z0-9.&]{1,4}$/.test(word) ? word : word.charAt(0) + word.slice(1).toLowerCase(),
    )
    .join("");
}
