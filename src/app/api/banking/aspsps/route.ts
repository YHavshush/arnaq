import { errorResponse, handle } from "@/lib/api";
import { currentUserId } from "@/lib/auth/session";
import { linkableAspsps } from "@/lib/banking/connections";
import { EnableBankingError } from "@/lib/banking/enable-banking";
import { bankingAllowed, bankingReady, tooMany, unreachable } from "@/lib/banking/http";

/**
 * GET ?country=NL (default NL): the banks that can be linked there, personal accounts only and only banks arnaq knows:
 * [{ name, country, logo, maximumConsentValidity (seconds), bank }]. 503 while linking banks is not available.
 */
export async function GET(request: Request) {
  return await handle(async () => {
    const ready = await bankingReady();
    if ("response" in ready) return ready.response;
    if (!bankingAllowed("aspsps", await currentUserId())) return tooMany();
    const country = new URL(request.url).searchParams.get("country") ?? "NL";
    if (!/^[A-Z]{2}$/.test(country)) return errorResponse("Invalid country.", 400);
    try {
      return Response.json(await linkableAspsps(ready.config, country), {
        headers: { "cache-control": "private, max-age=300" },
      });
    } catch (e) {
      if (e instanceof EnableBankingError) return unreachable();
      throw e;
    }
  });
}
