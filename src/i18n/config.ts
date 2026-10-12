/** English is the default; Dutch is the second language. Add a language here and in messages/. */
export const LOCALES = ["en", "nl"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "kasboek-lang";
export const LOCALE_LABEL: Record<Locale, string> = { en: "English", nl: "Nederlands" };

/** The BCP 47 tag used for number and date formatting (euros, month names). */
export const INTL_LOCALE: Record<Locale, string> = { en: "en-IE", nl: "nl-NL" };

export const isLocale = (v: unknown): v is Locale =>
  typeof v === "string" && (LOCALES as readonly string[]).includes(v);

export const toLocale = (v: unknown): Locale => (isLocale(v) ? v : DEFAULT_LOCALE);
