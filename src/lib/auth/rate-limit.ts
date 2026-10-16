/**
 * A small sliding-window limiter for the sign-in forms. It is a first layer, not the only one:
 * Supabase has its own limits, but those count every visitor as one (all calls come from the server's
 * address), so one person hammering "forgot password" could use them up for everybody. This keeps
 * one address, and one email, from doing that.
 *
 * Limits live in the memory of one server instance: on a host with several instances each has its own
 * counts, so this slows an attacker down but does not stop a determined one. That needs a shared store
 * (and CAPTCHA); see docs/plans/auth-tenancy.md.
 */

export interface Rule {
  /** At most this many tries ... */
  max: number;
  /** ... within this many milliseconds. */
  windowMs: number;
}

export const RULES = {
  signIn: { ip: { max: 20, windowMs: 10 * 60_000 }, email: { max: 6, windowMs: 10 * 60_000 } },
  signUp: { ip: { max: 6, windowMs: 60 * 60_000 }, email: { max: 3, windowMs: 60 * 60_000 } },
  forgot: { ip: { max: 6, windowMs: 60 * 60_000 }, email: { max: 3, windowMs: 60 * 60_000 } },
} satisfies Record<string, { ip: Rule; email: Rule }>;

export type Action = keyof typeof RULES;

const store = globalThis as unknown as { __kasboekRate?: Map<string, number[]> };
const hits = (store.__kasboekRate ??= new Map<string, number[]>());
const MAX_KEYS = 20_000; // a flood of different addresses must not grow the memory without end

/** Record one try under `key`; false when the key is over its limit (the try is not counted then). */
export function allow(key: string, rule: Rule, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < rule.windowMs);
  if (recent.length >= rule.max) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.delete(key); // re-insert so the oldest keys are first
  hits.set(key, recent);
  if (hits.size > MAX_KEYS) hits.delete(hits.keys().next().value!);
  return true;
}

/** The caller's address from the proxy's header: the first entry is the client, later ones are proxies. */
export function clientAddress(headers: { get(name: string): string | null }): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (forwarded || headers.get("x-real-ip") || "unknown").slice(0, 64);
}

/**
 * Count a try of `action` from this address with this email; false when either is over its limit. Both are
 * always counted, so an attacker cannot dodge the email limit by rotating addresses.
 */
export function checkRate(
  action: Action,
  address: string,
  email: string | null,
  now = Date.now(),
): boolean {
  const rules = RULES[action];
  const byIp = allow(`${action}:ip:${address}`, rules.ip, now);
  const byEmail = email ? allow(`${action}:email:${email.toLowerCase()}`, rules.email, now) : true;
  return byIp && byEmail;
}

/** For tests. */
export function resetRateLimits() {
  hits.clear();
}
