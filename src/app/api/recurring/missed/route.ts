import { getDb } from "@/db";
import { requestTime } from "@/lib/api";
import { getMissedOccurrences } from "@/lib/recurring/occurrences";

/** Occurrences whose payment never showed up in uploaded months, most recent first. */
export async function GET() {
  await requestTime();
  return Response.json(getMissedOccurrences(getDb()));
}
