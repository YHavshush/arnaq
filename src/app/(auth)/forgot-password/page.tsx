import { Suspense } from "react";
import { ForgotForm } from "@/components/kasboek/auth-forms";
import { requestTime } from "@/lib/api";
import { redirectIfSignedIn } from "@/lib/auth/guards";

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={null}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  await requestTime();
  await redirectIfSignedIn();
  return <ForgotForm />;
}
