"use client";

import { Palette } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { THEME_CHOICES, applyTheme, readTheme, subscribeTheme } from "@/design/theme-client";
import { useI18n } from "@/i18n/client";

/** Light, Dark, Dark + or follow the system. The only setting the app has. */
export function ThemeSwitcher() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const choice = useSyncExternalStore(subscribeTheme, readTheme, () => "system" as const);
  const box = useRef<HTMLDivElement>(null);

  // Follow the system while "System" is chosen.
  useEffect(() => {
    if (choice !== "system") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = () => applyTheme("system");
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [choice]);

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

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={t.ui.theme.choose}
        onClick={() => setOpen((o) => !o)}
        className="glass grid size-11 place-items-center rounded-full"
      >
        <Palette className="size-[18px]" />
      </button>
      {open && (
        <div
          role="radiogroup"
          aria-label={t.ui.theme.group}
          className="glass-nav fade-in absolute top-12 right-0 z-30 grid w-44 gap-0.5 rounded-2xl p-1.5"
        >
          {THEME_CHOICES.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={choice === value}
              onClick={() => {
                applyTheme(value);
                setOpen(false);
              }}
              className="aria-checked:bg-soft aria-checked:text-accent flex h-11 items-center rounded-xl px-3 text-left text-[15px] font-medium"
            >
              {t.ui.theme[value]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
