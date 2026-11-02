/**
 * Cloudflare Turnstile (CAPTCHA) for the sign-in forms. It is off until `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is set, so
 * nothing changes in development or before the keys exist. When it is on, Supabase's own CAPTCHA protection must be on
 * too (Auth > Attack Protection, with the Turnstile secret): Supabase checks the token, the app only passes it on.
 */
export const TURNSTILE_FIELD = "cf-turnstile-response";

export const captchaEnabled = (env: NodeJS.ProcessEnv = process.env) =>
  Boolean(env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);

/** The token Turnstile put in the form, for Supabase's `options.captchaToken`; undefined when there is none. */
export function captchaTokenOf(form: FormData): string | undefined {
  const v = form.get(TURNSTILE_FIELD);
  return typeof v === "string" && v.length > 0 && v.length <= 4096 ? v : undefined;
}
