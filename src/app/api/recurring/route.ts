import { userDb } from "@/lib/auth/request";
import { handle, requestTime, todayIso } from "@/lib/api";
import { readItemBody } from "@/lib/recurring/input";
import { createRecurringItem, listRecurringItems } from "@/lib/recurring/items";

export async function GET() {
  await requestTime();
  return await handle(async () => Response.json(await userDb((db) => listRecurringItems(db))));
}

/**
 * POST JSON: { name, type, expectedAmount, dayOfMonth, startDate, matchCounterparty?,
 * matchIban?, tolerance?, frequency?, categoryId?, endDate?, active? }. Amounts in cents.
 * Also plans occurrences through this month and matches existing transactions.
 */
export async function POST(request: Request) {
  return await handle(async () => {
    const body = readItemBody(await request.json(), false);
    if (!body.ok) return Response.json({ error: body.error }, { status: 400 });
    const item = await userDb((db) => createRecurringItem(db, body.value, { today: todayIso() }));
    return Response.json(item, { status: 201 });
  });
}
