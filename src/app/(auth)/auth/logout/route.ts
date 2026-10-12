import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { authCookieOptions, supabaseServer } from "@/lib/supabase/server";

/** POST only: signing out must not happen by following a link or loading an image. */
export async function POST(request: Request) {
  const names = (await cookies()).getAll().map((c) => c.name);
  try {
    await (await supabaseServer()).auth.signOut({ scope: "local" });
  } catch {
    // No session, or the auth server is unreachable.
  }
  // signOut reports a failed call as a value and leaves the cookies behind, so whatever it said the
  // session cookies are removed here: signing out on a shared computer must always work.
  const response = NextResponse.redirect(new URL("/login", request.url), 303);
  for (const name of names)
    if (name.startsWith("sb-"))
      response.cookies.set(name, "", { ...authCookieOptions(), maxAge: 0 });
  return response;
}
