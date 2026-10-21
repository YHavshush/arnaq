import { Suspense, type ReactNode } from "react";
import { AuthShell } from "@/components/arnaq/auth-shell";
import { I18nProvider } from "@/i18n/client";
import { getLocale } from "@/i18n/server";

async function Scoped({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  return (
    <I18nProvider locale={locale}>
      <AuthShell>{children}</AuthShell>
    </I18nProvider>
  );
}

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={null}>
      <Scoped>{children}</Scoped>
    </Suspense>
  );
}
