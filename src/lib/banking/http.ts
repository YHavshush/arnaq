import "server-only";
import { errorResponse } from "@/lib/api";
import { allow } from "@/lib/auth/rate-limit";
import {
  bankingStatus,
  type BankingConfig,
  type BankingEnvironment,
  type BankingStatus,
} from "./enable-banking";

/** The answer of every banking route while the feature is off (see bankingConfig). */
export const notConfigured = () =>
  errorResponse("Linking banks is not set up on this server.", 503);

export const unreachable = () =>
  errorResponse("Enable Banking could not be reached. Try again later.", 502);

/** Why linking banks is not available right now, as the route answers it (503). */
export function unavailable(status: Exclude<BankingStatus, { state: "on" }>): Promise<Response> {
  if (status.state === "sandbox")
    return errorResponse(
      "Linking banks is off: this server has an Enable Banking test (sandbox) application. Use the production application's key.",
      503,
    );
  if (status.state === "unreachable")
    return errorResponse("Enable Banking could not be reached. Try again later.", 503);
  return notConfigured();
}

/** The configuration and environment when linking banks works here, else the response to send. */
export async function bankingReady(): Promise<
  { config: BankingConfig; environment: BankingEnvironment } | { response: Response }
> {
  const status = await bankingStatus();
  if (status.state === "on") return { config: status.config, environment: status.environment };
  return { response: await unavailable(status) };
}

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
