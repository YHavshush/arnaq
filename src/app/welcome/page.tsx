import { Suspense } from "react";
import { Onboarding } from "@/components/arnaq/onboarding";
import { I18nProvider } from "@/i18n/client";
import { getLocale } from "@/i18n/server";

async function Scoped() {
  const locale = await getLocale();
  return (
    <I18nProvider locale={locale}>
      <Onboarding />
    </I18nProvider>
  );
}

/** The introduction shown to a first-time visitor, before sign-up. Public. */
export default function WelcomePage() {
  return (
    <Suspense fallback={null}>
      <Scoped />
    </Suspense>
  );
}
