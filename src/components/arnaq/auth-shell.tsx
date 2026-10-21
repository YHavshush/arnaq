import type { ReactNode } from "react";
import { getI18n } from "@/i18n/server";
import { LanguageSwitcher } from "./language-switcher";
import { Wordmark } from "./logo";
import { ThemeSwitcher } from "./theme-switcher";

/** The frame of the sign-in pages: the brand, the two switches, and a calm centred card. */
export async function AuthShell({ children }: { children: ReactNode }) {
  const { t } = await getI18n();
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col px-4 py-6">
      <header className="flex items-center justify-between pb-10">
        <Wordmark title={t.ui.brand} className="h-7 w-auto" />
        <div className="flex gap-2">
          <LanguageSwitcher />
          <ThemeSwitcher />
        </div>
      </header>
      <main id="main" className="flex-1">
        <p className="text-ink-muted mb-4 px-1 text-[15px]">{t.auth.brandLine}</p>
        {children}
      </main>
    </div>
  );
}
