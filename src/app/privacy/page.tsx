import type { Metadata } from "next";
import { Suspense } from "react";
import { LegalDocument } from "@/components/arnaq/legal-document";
import { getI18n } from "@/i18n/server";

export const metadata: Metadata = { title: "arnaq: privacy" };

async function Content() {
  const { t } = await getI18n();
  return <LegalDocument doc={t.legal.privacy} updated={t.legal.updated} back={t.legal.back} />;
}

/** The privacy document of arnaq. Public: it is linked from the sign-in pages and from the bank-linking registration. */
export default function PrivacyPage() {
  return (
    <Suspense fallback={null}>
      <Content />
    </Suspense>
  );
}
