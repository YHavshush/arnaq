import { handle, todayIso } from "@/lib/api";
import { userDb } from "@/lib/auth/request";
import { currentUserId } from "@/lib/auth/session";
import { PROVIDERS } from "@/lib/smart/providers";
import { runSmart } from "@/lib/smart/run";
import { getSmartSettings, isEntitled, resolveProvider } from "@/lib/smart/settings";

/**
 * POST: ask the language model about the transactions that are still open (only when the person has
 * switched it on, agreed to the current consent text and may use it). The result says what happened;
 * a failure never changes data, the person just sorts those by hand.
 */
export async function POST() {
  return await handle(async () => {
    const entitled = isEntitled(await currentUserId());
    const settings = await userDb((db) => getSmartSettings(db));
    const provider = resolveProvider(settings, entitled, PROVIDERS);
    if (!provider) return Response.json({ status: "off", asked: 0, applied: 0, suggested: 0 });
    return Response.json(
      await runSmart({ run: (fn) => userDb(fn) }, provider, { today: todayIso() }),
    );
  });
}
