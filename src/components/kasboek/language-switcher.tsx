"use client";

import { Languages } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { LOCALES, LOCALE_LABEL, type Locale } from "@/i18n/config";
import { rememberLocale, useI18n } from "@/i18n/client";

/** English or Dutch. Remembered in a cookie; the page is reloaded in the new language. */
export function LanguageSwitcher() {
  const { locale, t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (
        e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  function choose(next: Locale) {
    setOpen(false);
    if (next === locale) return;
    rememberLocale(next);
    startTransition(() => router.refresh());
  }

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={t.ui.language.choose}
        onClick={() => setOpen((o) => !o)}
        className="glass grid size-11 place-items-center rounded-full"
      >
        <Languages className="size-[18px]" />
      </button>
      {open && (
        <div
          role="radiogroup"
          aria-label={t.ui.language.group}
          className="glass-nav fade-in absolute top-12 right-0 z-30 grid w-44 gap-0.5 rounded-2xl p-1.5"
        >
          {LOCALES.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              lang={value}
              aria-checked={locale === value}
              onClick={() => choose(value)}
              className="aria-checked:bg-soft aria-checked:text-accent flex h-11 items-center rounded-xl px-3 text-left text-[15px] font-medium"
            >
              {LOCALE_LABEL[value]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
