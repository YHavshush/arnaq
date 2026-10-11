import { getDb } from "@/db";
import { handle, requestTime, todayIso } from "@/lib/api";
import { readItemBody } from "@/lib/recurring/input";
import { createRecurringItem, listRecurringItems } from "@/lib/recurring/items";

export async function GET() {
  await requestTime();
  return Response.json(listRecurringItems(getDb()));
}

/**
 * POST JSON: { name, type, expectedAmount, dayOfMonth, startDate, matchCounterparty?,
 * matchIban?, tolerance?, frequency?, categoryId?, endDate?, active? }. Amounts in cents.
 * Also plans occurrences through this month and matches existing transactions.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const body = readItemBody(await request.json(), false);
    if (!body.ok) return Response.json({ error: body.error }, { status: 400 });
    const item = createRecurringItem(getDb(), body.value, { today: todayIso() });
    return Response.json(item, { status: 201 });
  });
}
