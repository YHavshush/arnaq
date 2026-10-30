import { handle, errorResponse } from "@/lib/api";
import { userDb } from "@/lib/auth/request";
import { currentUserId } from "@/lib/auth/session";
import { SMART_PROVIDERS } from "@/db/schema";
import {
  getSmartSettings,
  isEntitled,
  setSmartProvider,
  SettingsError,
  type SmartProviderId,
} from "@/lib/smart/settings";

/** GET: the person's smart settings and whether they may use arnaq AI. */
export async function GET() {
  return await handle(async () => {
    const entitled = isEntitled(await currentUserId());
    return Response.json({ ...(await userDb((db) => getSmartSettings(db))), entitled });
  });
}

/** PUT JSON: { provider: "off" | "claude", consent?: boolean } */
export async function PUT(request: Request) {
  return await handle(async () => {
    const body = await request.json();
    if (!SMART_PROVIDERS.includes(body?.provider)) return errorResponse("Unknown provider.", 400);
    const entitled = isEntitled(await currentUserId());
    try {
      await userDb((db) =>
        setSmartProvider(db, body.provider as SmartProviderId, {
          consent: body.consent === true,
          entitled,
        }),
      );
    } catch (e) {
      if (e instanceof SettingsError) return errorResponse(e.message, 403);
      throw e;
    }
    return Response.json({ ok: true });
  });
}
