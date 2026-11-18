import { errorResponse, handle, requestLocale } from "@/lib/api";
import { appUrl } from "@/lib/app-url";
import { userDb } from "@/lib/auth/request";
import { currentUserId } from "@/lib/auth/session";
import { beginConnect } from "@/lib/banking/connections";
import { bankingConfig } from "@/lib/banking/enable-banking";
import { bankingAllowed, notConfigured, tooMany } from "@/lib/banking/http";

/**
 * POST JSON { aspsp: { name, country } }: start linking that bank. Answers { url }, the address at Enable Banking and
 * the bank where the person gives consent; the browser opens it, and the bank sends them back to
 * APP_URL/api/banking/callback. 422 for a bank that cannot be linked, 503 while linking banks is not set up.
 */
export async function POST(request: Request) {
  return await handle(async () => {
    const config = bankingConfig();
    const base = appUrl();
    if (!config || !base) return notConfigured();
    if (!bankingAllowed("connect", await currentUserId())) return tooMany();
    const body = (await request.json()) as unknown;
    const aspsp = (body as { aspsp?: unknown } | null)?.aspsp as
      { name?: unknown; country?: unknown } | undefined;
    const name = aspsp?.name;
    const country = aspsp?.country;
    if (
      typeof name !== "string" ||
      name.length < 1 ||
      name.length > 100 ||
      typeof country !== "string" ||
      !/^[A-Z]{2}$/.test(country)
    )
      return errorResponse("Choose a bank.", 400);
    const { url } = await beginConnect(config, userDb, {
      aspsp: { name, country },
      language: await requestLocale(),
      appUrl: base,
    });
    return Response.json({ url }, { headers: { "cache-control": "no-store" } });
  });
}
