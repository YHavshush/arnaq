import { NextResponse, type NextRequest } from "next/server";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Cross-site request guard for the API. State-changing requests must come from this site:
 * browsers attach Sec-Fetch-Site / Origin to cross-site form posts (even `text/plain` ones
 * that skip CORS preflight), so a malicious page cannot make the user's browser change data.
 * Requests without these headers (curl, scripts, tests) are not browser CSRF and pass.
 * Milestone 9 adds authentication here as well.
 */
export function proxy(request: NextRequest) {
  if (SAFE_METHODS.has(request.method)) return NextResponse.next();

  const site = request.headers.get("sec-fetch-site");
  if (site === "cross-site") return forbidden();

  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) return forbidden();
    } catch {
      return forbidden();
    }
  }
  return NextResponse.next();
}

function forbidden() {
  return NextResponse.json({ error: "Cross-site requests are not allowed." }, { status: 403 });
}

export const config = { matcher: "/api/:path*" };
