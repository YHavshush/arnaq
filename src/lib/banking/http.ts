import { errorResponse } from "@/lib/api";
import { allow } from "@/lib/auth/rate-limit";

/** The answer of every banking route while the feature is off (see bankingConfig). */
export const notConfigured = () =>
  errorResponse("Linking banks is not set up on this server.", 503);

export const unreachable = () =>
  errorResponse("Enable Banking could not be reached. Try again later.", 502);

/** Per person limits on the banking routes: each one costs a call to Enable Banking and often to the bank. */
const LIMITS = {
  aspsps: { max: 30, windowMs: 60_000 },
  connect: { max: 10, windowMs: 10 * 60_000 },
  callback: { max: 20, windowMs: 10 * 60_000 },
  disconnect: { max: 20, windowMs: 10 * 60_000 },
  sync: { max: 6, windowMs: 10 * 60_000 },
} as const;

export function bankingAllowed(what: keyof typeof LIMITS, userId: string): boolean {
  return allow(`banking:${what}:${userId}`, LIMITS[what]);
}

export const tooMany = () => errorResponse("Too many requests. Wait a minute and try again.", 429);
