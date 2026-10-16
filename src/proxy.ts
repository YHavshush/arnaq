import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { LOCALE_COOKIE, toLocale } from "@/i18n/config";
import { localizeMessage } from "@/i18n/server-messages";
import { devAuthEnabled } from "@/lib/auth/session";
import { safeNext } from "@/lib/auth/validate";
import { supabaseConfig } from "@/lib/supabase/config";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Reachable without signing in. Everything else, pages and API alike, needs a session. */
const PUBLIC = [/^\/login$/, /^\/register$/, /^\/forgot-password$/, /^\/auth\/confirm$/];
/** Pages a signed-in person has no business on. */
const GUEST_ONLY = [/^\/login$/, /^\/register$/, /^\/forgot-password$/];

const isPublic = (path: string) => PUBLIC.some((re) => re.test(path));

/**
 * Two jobs in front of every request.
 * 1. Cross-site request guard: state-changing requests must come from this site. Browsers attach
 *    Sec-Fetch-Site / Origin to cross-site form posts (even `text/plain` ones that skip CORS
 *    preflight), so a malicious page cannot make the user's browser change data. Requests without
 *    these headers (curl, scripts, tests) are not browser CSRF and pass (they still need a session).
 * 2. Sign-in: refresh the session cookie, send visitors without one to the login page (APIs get
 *    401). This is for a pleasant experience; the check that protects data is in the data layer
 *    (userDb), which verifies the session itself and fails closed.
 */
export async function proxy(request: NextRequest) {
  if (!SAFE_METHODS.has(request.method) && crossSite(request)) return forbidden();

  const path = request.nextUrl.pathname;
  if (devAuthEnabled()) {
    // Local development: signed in as the dev user. The sign-in pages have nothing to do.
    return GUEST_ONLY.some((re) => re.test(path)) ? redirect(request, "/") : NextResponse.next();
  }

  let response = NextResponse.next({ request });
  const { url, key } = supabaseConfig();
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list)
          response.cookies.set(name, value, {
            ...options,
            httpOnly: true,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production",
            path: "/",
          });
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const signedIn =
    Boolean(data?.claims?.sub) &&
    data?.claims?.role === "authenticated" &&
    data?.claims?.is_anonymous !== true;

  if (signedIn && GUEST_ONLY.some((re) => re.test(path)))
    return carry(response, redirect(request, "/"));
  if (!signedIn && !isPublic(path)) {
    if (path.startsWith("/api/")) {
      const locale = toLocale(request.cookies.get(LOCALE_COOKIE)?.value);
      return carry(
        response,
        NextResponse.json({ error: localizeMessage("Not signed in.", locale) }, { status: 401 }),
      );
    }
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = "";
    const next = safeNext(path + request.nextUrl.search, "");
    if (next) login.searchParams.set("next", next);
    return carry(response, NextResponse.redirect(login));
  }
  return response;
}

function crossSite(request: NextRequest): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return true;
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin && host) {
    try {
      return new URL(origin).host !== host;
    } catch {
      return true;
    }
  }
  return false;
}

const redirect = (request: NextRequest, to: string) =>
  NextResponse.redirect(new URL(to, request.url));

/** A redirect or error must still carry the refreshed session cookies. */
function carry(from: NextResponse, to: NextResponse): NextResponse {
  for (const cookie of from.cookies.getAll()) to.cookies.set(cookie);
  return to;
}

function forbidden() {
  return NextResponse.json({ error: "Cross-site requests are not allowed." }, { status: 403 });
}

export const config = {
  // Everything except static files and images.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|webmanifest)$).*)",
  ],
};
