import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseConfig } from "./config";

/**
 * The auth cookies are written by the server only and are never readable by scripts (httpOnly),
 * not sent on cross-site requests (SameSite=Lax) and, in production, only over HTTPS.
 */
export function authCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
}

/** A Supabase Auth client for one request, reading and writing the session cookies. */
export async function supabaseServer() {
  const store = await cookies();
  const { url, key } = supabaseConfig();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list)
            store.set(name, value, { ...options, ...authCookieOptions() });
        } catch {
          // Called while rendering a Server Component, where cookies are read-only. The proxy
          // refreshes the session on every request, so nothing is lost.
        }
      },
    },
  });
}
