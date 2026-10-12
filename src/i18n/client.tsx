"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";
import { LOCALE_COOKIE, type Locale } from "./config";
import { messages, type Messages } from "./messages";

const Context = createContext<{ locale: Locale; t: Messages }>({
  locale: "en",
  t: messages.en,
});

/**
 * Gives client components the language. Only the locale crosses from the server: the catalogs
 * hold functions (plurals, sentences), which cannot be passed as props, so each client bundle
 * carries both small catalogs and picks one here.
 */
export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return <Context value={{ locale, t: messages[locale] }}>{children}</Context>;
}

export const useI18n = () => useContext(Context);

/** Remember the choice for a year. The server reads this cookie on the next request. */
export function rememberLocale(locale: Locale): void {
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
}
