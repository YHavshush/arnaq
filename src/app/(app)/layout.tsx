import { Suspense, type ReactNode } from "react";
import { AppShell } from "@/components/kasboek/shell";
import { I18nProvider } from "@/i18n/client";
import { getLocale } from "@/i18n/server";

/** The language comes from a cookie (request time), so it is read inside Suspense. */
async function Scoped({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  return (
    <I18nProvider locale={locale}>
      <AppShell>{children}</AppShell>
    </I18nProvider>
  );
}

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense fallback={null}>
      <Scoped>{children}</Scoped>
    </Suspense>
  );
}
