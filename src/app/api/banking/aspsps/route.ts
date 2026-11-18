import { errorResponse, handle } from "@/lib/api";
import { currentUserId } from "@/lib/auth/session";
import { linkableAspsps } from "@/lib/banking/connections";
import { EnableBankingError, bankingConfig } from "@/lib/banking/enable-banking";
import { bankingAllowed, notConfigured, tooMany, unreachable } from "@/lib/banking/http";

/**
 * GET ?country=NL (default NL): the banks that can be linked there, personal accounts only and only banks arnaq knows:
 * [{ name, country, logo, maximumConsentValidity (seconds), bank }]. 503 while linking banks is not set up.
 */
export async function GET(request: Request) {
  return await handle(async () => {
    const config = bankingConfig();
    if (!config) return notConfigured();
    if (!bankingAllowed("aspsps", await currentUserId())) return tooMany();
    const country = new URL(request.url).searchParams.get("country") ?? "NL";
    if (!/^[A-Z]{2}$/.test(country)) return errorResponse("Invalid country.", 400);
    try {
      return Response.json(await linkableAspsps(config, country), {
        headers: { "cache-control": "private, max-age=300" },
      });
    } catch (e) {
      if (e instanceof EnableBankingError) return unreachable();
      throw e;
    }
  });
}
