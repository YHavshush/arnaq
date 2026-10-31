import { handle } from "@/lib/api";
import { userDb } from "@/lib/auth/request";
import { resortOpen } from "@/lib/categories/resort";

/** POST: sort the open transactions again with what arnaq knows now. Answers { sorted, open }. */
export async function POST() {
  return await handle(async () => Response.json(await userDb((db) => resortOpen(db))));
}
