import { cookies } from "next/headers";
import { LOCALE_COOKIE, toLocale, type Locale } from "./config";
import { messages, type Messages } from "./messages";

/** The language of this request: the cookie the language switch sets, else English. */
export async function getLocale(): Promise<Locale> {
  return toLocale((await cookies()).get(LOCALE_COOKIE)?.value);
}

/** Locale and its messages for a server component. */
export async function getI18n(): Promise<{ locale: Locale; t: Messages }> {
  const locale = await getLocale();
  return { locale, t: messages[locale] };
}
