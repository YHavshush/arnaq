import { errorResponse, handle, requestLocale, todayIso } from "@/lib/api";
import { userDb } from "@/lib/auth/request";
import { currentUserId } from "@/lib/auth/session";
import { localizeMessage } from "@/i18n/server-messages";
import { bankingConfig } from "@/lib/banking/enable-banking";
import { bankingAllowed, notConfigured, tooMany } from "@/lib/banking/http";
import { syncBankLinks } from "@/lib/banking/sync";

/** People whose refresh is running on this server: one at a time each (it asks the banks and holds a connection). */
const running = new Set<string>();

/**
 * POST: "Refresh now". Reads the new booked transactions of every linked account and imports them like an uploaded
 * file. Answers { links: [{ linkId, accountName, status: ok | expired | failed, imported, duplicate, error? }] }.
 */
export async function POST() {
  return await handle(async () => {
    const config = bankingConfig();
    if (!config) return notConfigured();
    const userId = await currentUserId();
    if (running.has(userId)) return errorResponse("A refresh is already running.", 409);
    if (!bankingAllowed("sync", userId)) return tooMany();
    running.add(userId);
    try {
      const links = await syncBankLinks(config, userDb, { today: todayIso() });
      const locale = await requestLocale();
      return Response.json({
        links: links.map((l) => (l.error ? { ...l, error: localizeMessage(l.error, locale) } : l)),
      });
    } finally {
      running.delete(userId);
    }
  });
}
