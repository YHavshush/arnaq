import { Suspense } from "react";
import { ResetForm } from "@/components/kasboek/auth-forms";
import { requestTime } from "@/lib/api";
import { requireSignedIn } from "@/lib/auth/guards";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  await requestTime();
  const user = await requireSignedIn(); // the confirmation link signs the person in first
  return <ResetForm email={user.email} />;
}
