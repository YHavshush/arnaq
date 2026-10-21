import { Suspense } from "react";
import { LoginForm } from "@/components/arnaq/auth-forms";
import { requestTime } from "@/lib/api";
import { redirectIfSignedIn } from "@/lib/auth/guards";
import { safeNext } from "@/lib/auth/validate";

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <Suspense fallback={null}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  await requestTime();
  await redirectIfSignedIn();
  const params = await searchParams;
  const raw = params.next;
  return (
    <LoginForm
      next={safeNext(Array.isArray(raw) ? raw[0] : raw)}
      confirmed={params.confirmed === "1"}
    />
  );
}
