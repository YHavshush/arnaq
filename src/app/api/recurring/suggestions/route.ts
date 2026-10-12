import { userDb } from "@/lib/auth/request";
import { handle, requestTime, todayIso } from "@/lib/api";
import { detectSuggestions } from "@/lib/recurring/suggestions";

export async function GET() {
  await requestTime();
  return await handle(async () =>
    Response.json(await userDb((db) => detectSuggestions(db, { today: todayIso() }))),
  );
}
