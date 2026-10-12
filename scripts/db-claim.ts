// Moves the rows that existed before accounts did (owner: the all-zero sentinel) to a real user.
//   DATABASE_URL=<direct connection as the database owner> npm run db:claim -- <user id>
// The user id is the "id" of the user in Supabase Auth (Authentication > Users). Needs the owner
// role (postgres): the app's own role cannot see sentinel rows, which is the point.
import { createDb } from "../src/db";
import { claimSentinelRows } from "../src/db/claim";

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  const userId = process.argv[2];
  if (!url || !userId) {
    console.error("Usage: DATABASE_URL=postgres://... npm run db:claim -- <user id>");
    process.exit(1);
  }
  const db = await createDb(url);
  const moved = await claimSentinelRows(db, userId);
  console.log("Moved:", moved);
  process.exit(0);
}

main().catch((e) => {
  console.error("Claim failed:", e instanceof Error ? e.name : "unknown error");
  process.exit(1);
});
