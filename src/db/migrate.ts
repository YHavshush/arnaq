import { createDb } from "./index";

// Applies pending migrations and seeds defaults. Needed for a hosted Postgres (DATABASE_URL);
// local PGlite does the same on open.
async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error(
      "Set DATABASE_URL to a postgres:// connection string (Supabase: the direct one).",
    );
    process.exit(1);
  }
  await createDb(url, { migrate: true });
  console.log("Database is up to date.");
  process.exit(0);
}

main().catch((e) => {
  // Never print the error object: driver errors can include the connection string.
  console.error("Migration failed:", e instanceof Error ? e.name : "unknown error");
  process.exit(1);
});
