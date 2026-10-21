"use client";

import { useRouter } from "next/navigation";
import { useSyncExternalStore, useTransition } from "react";
import { THEME_CHOICES, applyTheme, readTheme, subscribeTheme } from "@/design/theme-client";
import { LOCALES, LOCALE_LABEL, type Locale } from "@/i18n/config";
import { rememberLocale, useI18n } from "@/i18n/client";

const row = "flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left";

/** Language and theme, as two lists of choices (they used to be two icons in the top corner). */
export function AppearanceSettings() {
  const { locale, t } = useI18n();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => "system" as const);

  function chooseLocale(next: Locale) {
    if (next === locale) return;
    rememberLocale(next);
    startTransition(() => router.refresh());
  }

  const dot = (on: boolean) => (
    <span
      aria-hidden
      className={`grid size-5 shrink-0 place-items-center rounded-full border-2 ${on ? "border-select bg-select dark:bg-transparent" : "border-hair"}`}
    >
      {on && <span className="bg-action-ink dark:bg-select size-2 rounded-full dark:size-2.5" />}
    </span>
  );

  return (
    <div className="grid gap-3">
      <div className="glass overflow-hidden" role="radiogroup" aria-label={t.ui.language.group}>
        <h3 className="text-ink-muted px-4 pt-3 pb-1 text-[13px] font-semibold tracking-wide uppercase">
          {t.ui.language.group}
        </h3>
        <ul className="divide-hair divide-y">
          {LOCALES.map((value) => (
            <li key={value}>
              <button
                type="button"
                role="radio"
                aria-checked={locale === value}
                onClick={() => chooseLocale(value)}
                className={row}
              >
                {dot(locale === value)}
                <span className="font-semibold">{LOCALE_LABEL[value]}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="glass overflow-hidden" role="radiogroup" aria-label={t.ui.theme.group}>
        <h3 className="text-ink-muted px-4 pt-3 pb-1 text-[13px] font-semibold tracking-wide uppercase">
          {t.ui.theme.group}
        </h3>
        <ul className="divide-hair divide-y">
          {THEME_CHOICES.map((value) => (
            <li key={value}>
              <button
                type="button"
                role="radio"
                aria-checked={theme === value}
                onClick={() => applyTheme(value)}
                className={row}
              >
                {dot(theme === value)}
                <span className="font-semibold">{t.ui.theme[value]}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
