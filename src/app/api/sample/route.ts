import { handle, todayIso } from "@/lib/api";
import { userDb } from "@/lib/auth/request";
import { clearSample, hasSample, loadSample } from "@/lib/sample/sample";

/** GET: is there sample data in this account? */
export async function GET() {
  return await handle(async () => Response.json({ loaded: await userDb((db) => hasSample(db)) }));
}

/** POST: fill an empty account with sample data, so a new person can look around. */
export async function POST() {
  return await handle(async () =>
    Response.json(await userDb((db) => loadSample(db, todayIso())), { status: 201 }),
  );
}

/** DELETE: remove the sample data ("use my own"). */
export async function DELETE() {
  return await handle(async () =>
    Response.json({ removed: await userDb((db) => clearSample(db)) }),
  );
}
