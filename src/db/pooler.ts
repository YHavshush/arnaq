/**
 * Supabase's session pooler (port 5432) gives every open connection its own database connection, and serverless
 * instances keep theirs open while frozen, so a handful of instances fill all 15 and the app fails with "max clients
 * reached". The transaction pooler (port 6543, same host and login) shares them. The app only uses transaction-local
 * settings and no prepared statements, so it works there: use it for the running app.
 */
export function forTransactionPooler(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname.endsWith(".pooler.supabase.com") && u.port === "5432") {
      u.port = "6543";
      return u.toString();
    }
  } catch {
    // Not a URL we can read: leave it as it is.
  }
  return url;
}
