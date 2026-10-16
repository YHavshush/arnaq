/**
 * The address the app is served from, from `APP_URL` (for example https://kasboek.example). When it is
 * set, redirects are built from it and the cross-site check compares the browser's Origin with it, so
 * neither depends on the Host header (which a proxy may rewrite and a client may choose). Not set (local
 * development): the request's own address is used. Anything that is not a plain http(s) address is ignored.
 */
export function appUrl(env: NodeJS.ProcessEnv = process.env): URL | null {
  const raw = env.APP_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return new URL(url.origin);
  } catch {
    return null;
  }
}

/** Where a redirect to `path` should point: the configured address, else the request's. */
export function redirectTarget(path: string, requestUrl: string, env?: NodeJS.ProcessEnv): URL {
  return new URL(path, appUrl(env) ?? requestUrl);
}
