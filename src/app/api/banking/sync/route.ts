import { errorResponse, handle, requestLocale, todayIso } from "@/lib/api";
import { userDb } from "@/lib/auth/request";
import { currentUserId } from "@/lib/auth/session";
import { localizeMessage } from "@/i18n/server-messages";
import { psuHeadersFromRequest } from "@/lib/banking/enable-banking";
import { bankingAllowed, bankingReady, tooMany } from "@/lib/banking/http";
import { syncBankLinks } from "@/lib/banking/sync";

/** People whose refresh is running on this server: one at a time each (it asks the banks and holds a connection). */
const running = new Set<string>();

/**
 * POST: "Refresh now". Reads the new booked transactions of every linked account and imports them like an uploaded
 * file, each account as soon as it is read. Answers { links: [{ linkId, accountName, status: ok | expired | failed |
 * stopped, imported, duplicate, error? }] }; "stopped" means the refresh ran out of time, and refreshing again goes on.
 */
export async function POST(request: Request) {
  return await handle(async () => {
    const ready = await bankingReady();
    if ("response" in ready) return ready.response;
    const userId = await currentUserId();
    if (running.has(userId)) return errorResponse("A refresh is already running.", 409);
    if (!bankingAllowed("sync", userId)) return tooMany();
    running.add(userId);
    try {
      const links = await syncBankLinks(ready.config, userDb, {
        today: todayIso(),
        environment: ready.environment,
        // This route is the button: the person is here, so the bank may be told (IP address and browser, checked).
        presence: { by: "pressed-refresh", psu: psuHeadersFromRequest(request.headers) },
      });
      const locale = await requestLocale();
      return Response.json({
        links: links.map((l) => (l.error ? { ...l, error: localizeMessage(l.error, locale) } : l)),
      });
    } finally {
      running.delete(userId);
    }
  });
}
