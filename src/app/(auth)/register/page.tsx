import { cookies } from "next/headers";
import { Suspense } from "react";
import { RegisterForm } from "@/components/arnaq/auth-forms";
import { getI18n } from "@/i18n/server";
import { requestTime } from "@/lib/api";
import { redirectIfSignedIn } from "@/lib/auth/guards";
import { SAMPLE_WISH_COOKIE } from "@/lib/welcome";

export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  await requestTime();
  await redirectIfSignedIn();
  const { t } = await getI18n();
  // Someone who chose "try it with sample data" on the introduction is told how that works.
  const wantsSample = (await cookies()).has(SAMPLE_WISH_COOKIE);
  return (
    <>
      {wantsSample && (
        <p className="bg-soft mb-3 rounded-2xl px-4 py-3 text-[14px]">{t.ui.welcome.sampleHint}</p>
      )}
      <RegisterForm />
    </>
  );
}
