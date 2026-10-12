import { getDb } from "@/db";
import { handle } from "@/lib/api";
import { isObject } from "@/lib/recurring/input";
import type { RecurringType } from "@/lib/recurring/occurrences";
import { rejectSuggestion } from "@/lib/recurring/suggestions";

/** POST JSON: { key, type }. The suggestion is never offered again. */
export async function POST(request: Request) {
  return await handle(async () => {
    const body: unknown = await request.json();
    if (!isObject(body) || typeof body.key !== "string" || typeof body.type !== "string") {
      return Response.json({ error: "key and type are required." }, { status: 400 });
    }
    await rejectSuggestion(await getDb(), { key: body.key, type: body.type as RecurringType });
    return Response.json({ ok: true });
  });
}
