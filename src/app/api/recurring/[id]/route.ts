import { getDb } from "@/db";
import { handle, parseId, requestTime, todayIso } from "@/lib/api";
import { readItemBody } from "@/lib/recurring/input";
import { deleteRecurringItem, getRecurringItem, updateRecurringItem } from "@/lib/recurring/items";
import { getOccurrences } from "@/lib/recurring/occurrences";

type Ctx = { params: Promise<{ id: string }> };

const notFound = () => Response.json({ error: "Recurring item not found." }, { status: 404 });

/** The item with all its occurrences (actual amounts included for matched ones). */
export async function GET(_req: Request, { params }: Ctx) {
  await requestTime();
  const id = parseId((await params).id);
  if (id === null) return Response.json({ error: "Invalid id." }, { status: 400 });
  const db = getDb();
  const item = getRecurringItem(db, id);
  if (!item) return notFound();
  return Response.json({ ...item, occurrences: getOccurrences(db, { recurringItemId: id }) });
}

/** PATCH JSON: any item fields. `active: false` stops the item but keeps matched history. */
export async function PATCH(request: Request, { params }: Ctx) {
  return handle(async () => {
    const id = parseId((await params).id);
    if (id === null) return Response.json({ error: "Invalid id." }, { status: 400 });
    const body = readItemBody(await request.json(), true);
    if (!body.ok) return Response.json({ error: body.error }, { status: 400 });
    const db = getDb();
    if (!getRecurringItem(db, id)) return notFound();
    return Response.json(updateRecurringItem(db, id, body.value, { today: todayIso() }));
  });
}

/** Hard delete: unlinks matched transactions and removes all occurrences. */
export async function DELETE(_req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (id === null) return Response.json({ error: "Invalid id." }, { status: 400 });
  if (!deleteRecurringItem(getDb(), id)) return notFound();
  return new Response(null, { status: 204 });
}
