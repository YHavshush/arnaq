import { userDb } from "@/lib/auth/request";
import { handle, requestTime } from "@/lib/api";
import { getMissedOccurrences } from "@/lib/recurring/occurrences";

/** Occurrences whose payment never showed up in uploaded months, most recent first. */
export async function GET() {
  await requestTime();
  return await handle(async () => Response.json(await userDb((db) => getMissedOccurrences(db))));
}
