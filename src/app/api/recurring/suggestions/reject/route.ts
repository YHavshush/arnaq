import { userDb } from "@/lib/auth/request";
import { handle, errorResponse } from "@/lib/api";
import { isObject } from "@/lib/recurring/input";
import type { RecurringType } from "@/lib/recurring/occurrences";
import { rejectSuggestion } from "@/lib/recurring/suggestions";

/** POST JSON: { key, type }. The suggestion is never offered again. */
export async function POST(request: Request) {
  return await handle(async () => {
    const body: unknown = await request.json();
    if (!isObject(body) || typeof body.key !== "string" || typeof body.type !== "string") {
      return errorResponse("key and type are required.", 400);
    }
    const { key } = body;
    await userDb((db) => rejectSuggestion(db, { key, type: body.type as RecurringType }));
    return Response.json({ ok: true });
  });
}
