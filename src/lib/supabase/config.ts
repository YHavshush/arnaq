/**
 * Where Supabase Auth lives. Both values are public by design (the publishable key only allows
 * what Auth allows an anonymous visitor); they are still read on the server only, so the browser
 * never talks to Supabase directly and the auth cookies can stay httpOnly.
 */
export function supabaseConfig(env: NodeJS.ProcessEnv = process.env): { url: string; key: string } {
  const url = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be set.");
  let host: URL;
  try {
    host = new URL(url);
  } catch {
    throw new Error("SUPABASE_URL is not a valid URL.");
  }
  if (host.protocol !== "https:" && host.hostname !== "localhost" && host.hostname !== "127.0.0.1")
    throw new Error("SUPABASE_URL must be https.");
  // The secret (service_role / sb_secret_) key must never be used here.
  if (
    /^sb_secret_/.test(key) ||
    /service_role/i.test(Buffer.from(key.split(".")[1] ?? "", "base64").toString())
  )
    throw new Error("SUPABASE_PUBLISHABLE_KEY must be the publishable key, never a secret key.");
  return { url, key };
}
