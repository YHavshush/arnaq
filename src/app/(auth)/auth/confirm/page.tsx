import { Suspense } from "react";
import { ConfirmForm, InvalidLink } from "@/components/kasboek/auth-forms";
import { requestTime } from "@/lib/api";
import { isOtpType, safeNext } from "@/lib/auth/validate";

export default function ConfirmPage({ searchParams }: PageProps<"/auth/confirm">) {
  return (
    <Suspense fallback={null}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * The link in the email lands here and only shows a button. The token is used when the button is
 * pressed (a server action), so a mail scanner that opens the link cannot use it up.
 */
async function Content({ searchParams }: Pick<PageProps<"/auth/confirm">, "searchParams">) {
  await requestTime();
  const params = await searchParams;
  const tokenHash = one(params.token_hash);
  const type = one(params.type);
  if (!tokenHash || tokenHash.length > 300 || !isOtpType(type)) return <InvalidLink />;
  return <ConfirmForm tokenHash={tokenHash} type={type} next={safeNext(one(params.next))} />;
}
