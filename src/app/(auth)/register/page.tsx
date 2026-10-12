import { Suspense } from "react";
import { RegisterForm } from "@/components/kasboek/auth-forms";
import { requestTime } from "@/lib/api";
import { redirectIfSignedIn } from "@/lib/auth/guards";

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
  return <RegisterForm />;
}
