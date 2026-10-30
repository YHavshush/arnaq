import { cache } from "react";
import { supabaseServer } from "@/lib/supabase/server";

/** Who is making this request. */
export class UnauthenticatedError extends Error {
  constructor() {
    super("Not signed in.");
  }
}

/** The one user of local development without a sign-in (see devAuthEnabled). */
export const DEV_USER_ID = "00000000-0000-0000-0000-0000000000d1";

/**
 * Local development without an auth server: `KASBOEK_DEV_AUTH=1`, only while running `next dev` on
 * a local database. A hosted database or a production build never accepts it, so this cannot
 * become a back door by a stray environment variable.
 */
export function devAuthEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.KASBOEK_DEV_AUTH !== "1") return false;
  if (env.NODE_ENV !== "development") return false;
  return !/^postgres(ql)?:\/\//i.test(env.DATABASE_URL?.trim() ?? "");
}

export interface SessionUser {
  id: string;
  email: string | null;
}

/**
 * The signed-in user, or UnauthenticatedError. The session cookie is verified here (its signature
 * and expiry, locally when the project uses asymmetric keys), not just looked at: this is the check
 * that matters, the proxy only makes it pleasant. Remembered for the rest of the request.
 */
export const currentUser = cache(async (): Promise<SessionUser> => {
  if (devAuthEnabled()) return { id: DEV_USER_ID, email: "dev@localhost" };
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub || claims.role !== "authenticated" || claims.is_anonymous === true)
    throw new UnauthenticatedError();
  return { id: claims.sub, email: typeof claims.email === "string" ? claims.email : null };
});

/** The signed-in user's id, or throws UnauthenticatedError. Everything that touches data asks this first. */
export async function currentUserId(): Promise<string> {
  return (await currentUser()).id;
}

/**
 * Was this session started by a recovery link (or a one-time code) in the last few minutes? A new password may be set
 * without the old one only then: a stolen session cookie alone must not be able to take the account over.
 * `amr` is the sign-in record inside the signed session token.
 */
export function hasRecentRecovery(amr: unknown, nowSeconds: number, maxAgeSeconds = 900): boolean {
  if (!Array.isArray(amr)) return false;
  return amr.some((entry) => {
    if (typeof entry !== "object" || entry === null) return false;
    const { method, timestamp } = entry as { method?: unknown; timestamp?: unknown };
    return (
      (method === "recovery" || method === "otp") &&
      typeof timestamp === "number" &&
      timestamp <= nowSeconds &&
      nowSeconds - timestamp <= maxAgeSeconds
    );
  });
}

/** True when the current session came from a recovery link just now (see `hasRecentRecovery`). */
export async function sessionIsRecentRecovery(): Promise<boolean> {
  if (devAuthEnabled()) return true;
  const { data } = await (await supabaseServer()).auth.getClaims();
  return hasRecentRecovery(data?.claims?.amr, Math.floor(Date.now() / 1000));
}
