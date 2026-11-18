import { errorResponse } from "@/lib/api";
import { redirectTarget } from "@/lib/app-url";
import { userDb } from "@/lib/auth/request";
import { UnauthenticatedError, currentUserId } from "@/lib/auth/session";
import { completeCallback, isWellFormedState } from "@/lib/banking/connections";
import { bankingStatus } from "@/lib/banking/enable-banking";
import { bankingAllowed } from "@/lib/banking/http";
import type { CallbackResult } from "@/lib/banking/types";

/**
 * GET ?code&state (or ?error&state): the bank sends the person back here. Only for the signed-in person who started
 * the link (the proxy sends a visitor without a session to the login page). Always ends with a redirect to Settings
 * with one of a fixed set of results, also when something breaks on the way: nothing from the request is echoed back,
 * and the target is APP_URL, never a header.
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
  try {
    const status = await bankingStatus();
    if (status.state !== "on") return to("unavailable");
    const params = new URL(request.url).searchParams;
    const state = params.get("state");
    // Only a state arnaq could have made counts against the limit; junk is turned away without a lookup anyway.
    if (isWellFormedState(state) && !bankingAllowed("callback", userId)) return to("failed");
    return to(
      await completeCallback(status.config, userDb, {
        state,
        code: params.get("code"),
        error: params.get("error"),
      }),
    );
  } catch {
    // A database or other failure: the person lands back in Settings with a plain "did not work", not an error page.
    console.warn("Enable Banking: the return from the bank failed.");
    return to("failed");
  }
}
