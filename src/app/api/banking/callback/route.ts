import { errorResponse } from "@/lib/api";
import { redirectTarget } from "@/lib/app-url";
import { userDb } from "@/lib/auth/request";
import { UnauthenticatedError, currentUserId } from "@/lib/auth/session";
import { completeCallback } from "@/lib/banking/connections";
import { bankingConfig } from "@/lib/banking/enable-banking";
import { bankingAllowed } from "@/lib/banking/http";
import type { CallbackResult } from "@/lib/banking/types";

/**
 * GET ?code&state (or ?error&state): the bank sends the person back here. Only for the signed-in person who started
 * the link (the proxy sends a visitor without a session to the login page). Always ends with a redirect to Settings
 * with one of a fixed set of results: nothing from the request is echoed back, and the target is APP_URL, never a
 * header.
 */
export async function GET(request: Request) {
  let userId: string;
  try {
    userId = await currentUserId();
  } catch (e) {
    if (e instanceof UnauthenticatedError) return errorResponse("Not signed in.", 401);
    throw e;
  }
  const to = (result: CallbackResult) =>
    new Response(null, {
      status: 303,
      headers: {
        location: redirectTarget(`/settings?bank=${result}`, request.url).toString(),
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      },
    });
  const config = bankingConfig();
  if (!config) return to("unavailable");
  if (!bankingAllowed("callback", userId)) return to("failed");
  const params = new URL(request.url).searchParams;
  return to(
    await completeCallback(config, userDb, {
      state: params.get("state"),
      code: params.get("code"),
      error: params.get("error"),
    }),
  );
}
