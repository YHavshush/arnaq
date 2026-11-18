import type { Metadata } from "next";
import { Suspense } from "react";
import { LegalDocument } from "@/components/arnaq/legal-document";
import { getI18n } from "@/i18n/server";

export const metadata: Metadata = { title: "arnaq: terms" };

async function Content() {
  const { t } = await getI18n();
  return <LegalDocument doc={t.legal.terms} updated={t.legal.updated} back={t.legal.back} />;
}

/** The terms document of arnaq. Public: it is linked from the sign-in pages and from the bank-linking registration. */
export default function TermsPage() {
  return (
    <Suspense fallback={null}>
      <Content />
    </Suspense>
  );
}
