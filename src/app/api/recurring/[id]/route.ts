import { handle, parseId, requestTime, todayIso, errorResponse } from "@/lib/api";
import { userDb } from "@/lib/auth/request";
import { readItemBody } from "@/lib/recurring/input";
import { deleteRecurringItem, getRecurringItem, updateRecurringItem } from "@/lib/recurring/items";
import { getOccurrences } from "@/lib/recurring/occurrences";

type Ctx = { params: Promise<{ id: string }> };

const notFound = () => errorResponse("Recurring item not found.", 404);

/** The item with all its occurrences (actual amounts included for matched ones). */
export async function GET(_req: Request, { params }: Ctx) {
  await requestTime();
  return await handle(async () => {
    const id = parseId((await params).id);
    if (id === null) return errorResponse("Invalid id.", 400);
    return await userDb(async (db) => {
      const item = await getRecurringItem(db, id);
      if (!item) return notFound();
      return Response.json({
        ...item,
        occurrences: await getOccurrences(db, { recurringItemId: id }),
      });
    });
  });
}

/** PATCH JSON: any item fields. `active: false` stops the item but keeps matched history. */
export async function PATCH(request: Request, { params }: Ctx) {
  return await handle(async () => {
    const id = parseId((await params).id);
    if (id === null) return errorResponse("Invalid id.", 400);
    const body = readItemBody(await request.json(), true);
    if (!body.ok) return errorResponse(body.error, 400);
    return await userDb(async (db) => {
      if (!(await getRecurringItem(db, id))) return notFound();
      return Response.json(await updateRecurringItem(db, id, body.value, { today: todayIso() }));
    });
  });
}

/** Hard delete: unlinks matched transactions and removes all occurrences. */
export async function DELETE(_req: Request, { params }: Ctx) {
  return await handle(async () => {
    const id = parseId((await params).id);
    if (id === null) return errorResponse("Invalid id.", 400);
    if (!(await userDb((db) => deleteRecurringItem(db, id)))) return notFound();
    return new Response(null, { status: 204 });
  });
}
