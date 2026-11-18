import Link from "next/link";
import type { ReactNode } from "react";
import { getI18n } from "@/i18n/server";
import { LanguageSwitcher } from "./language-switcher";
import { WordmarkReveal } from "./motion";
import { ThemeSwitcher } from "./theme-switcher";

/** The frame of the sign-in pages: the brand, the two switches, and a calm centred card. */
export async function AuthShell({ children }: { children: ReactNode }) {
  const { t } = await getI18n();
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col px-4 py-6">
      <header className="flex items-center justify-between pb-10">
        <WordmarkReveal title={t.ui.brand} className="h-7 w-auto" />
        <div className="flex gap-2">
          <LanguageSwitcher />
          <ThemeSwitcher />
        </div>
      </header>
      <main id="main" className="flex-1">
        <p className="text-ink-muted mb-4 px-1 text-[15px]">{t.auth.brandLine}</p>
        {children}
      </main>
      <footer className="text-ink-muted flex flex-wrap items-center justify-center gap-x-4 gap-y-1 pt-6 text-[13px]">
        <Link href="/welcome" className="underline underline-offset-4">
          {t.ui.welcome.again}
        </Link>
        <Link href="/privacy" className="underline underline-offset-4">
          {t.legal.privacyLink}
        </Link>
        <Link href="/terms" className="underline underline-offset-4">
          {t.legal.termsLink}
        </Link>
      </footer>
    </div>
  );
}
