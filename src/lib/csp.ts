/**
 * The Content-Security-Policy for the app: what the browser may load and where it may send things.
 *
 * It does not use a script nonce: with partial prerendering the page shell is built ahead of time, so
 * there is no per-request nonce to put on Next's inline scripts and the theme script. Scripts therefore
 * allow 'unsafe-inline'. Everything else is closed: nothing loads from another site, nothing can frame
 * the app, forms and the page's base can only point at the app itself, no plugins.
 *
 * `CSP_MODE`: "enforce", "report-only" (the browser logs violations to its console but blocks nothing;
 * the default in production until it has been checked on the real deployment), or "off" (development).
 */
export type CspMode = "enforce" | "report-only" | "off";

export function cspMode(env: NodeJS.ProcessEnv = process.env): CspMode {
  const set = env.CSP_MODE;
  if (set === "enforce" || set === "report-only" || set === "off") return set;
  return env.NODE_ENV === "production" ? "report-only" : "off";
}

export function cspHeader(
  env: NodeJS.ProcessEnv = process.env,
): { key: string; value: string } | null {
  const mode = cspMode(env);
  if (mode === "off") return null;
  const value = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
  return {
    key: mode === "enforce" ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only",
    value,
  };
}
