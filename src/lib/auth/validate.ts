/** Shortest password we accept. Supabase's own minimum (Authentication > Providers > Email) should be the same or higher. */
export const MIN_PASSWORD = 10;
const MAX_PASSWORD = 72; // bcrypt ignores anything past 72 bytes

export function isEmail(value: unknown): value is string {
  return (
    typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)
  );
}

export type PasswordProblem = "short" | "long" | null;

export function passwordProblem(value: unknown): PasswordProblem {
  if (typeof value !== "string" || value.length < MIN_PASSWORD) return "short";
  return new TextEncoder().encode(value).length > MAX_PASSWORD ? "long" : null;
}

/**
 * Where to go after signing in. Only a path on this site is accepted: anything else (another host,
 * `//host`, `/\host`, a scheme, control characters) falls back, so a login link cannot be turned
 * into an open redirect. Auth pages are refused too, which would loop.
 */
export function safeNext(raw: unknown, fallback = "/"): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 200) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return fallback;
  try {
    const url = new URL(raw, "http://kasboek.invalid");
    if (url.origin !== "http://kasboek.invalid") return fallback;
    if (/^\/(login|register|forgot-password|auth)(\/|$)/.test(url.pathname)) return fallback;
    return url.pathname + url.search;
  } catch {
    return fallback;
  }
}

/** The token types a confirmation link may carry (a subset of Supabase's EmailOtpType: the ones the email templates use). */
export const OTP_TYPES = ["recovery", "email_change", "email"] as const;
export type OtpType = (typeof OTP_TYPES)[number];
export const isOtpType = (v: unknown): v is OtpType =>
  typeof v === "string" && (OTP_TYPES as readonly string[]).includes(v);
