import { errorResponse, handle, parseId } from "@/lib/api";
import { userDb } from "@/lib/auth/request";
import { BtwClientNotFound, deleteBtwClient, updateBtwClient } from "@/lib/btw/clients";

type Ctx = { params: Promise<{ id: string }> };

const notFound = () => errorResponse("BTW client not found.", 404);

/**
 * PATCH JSON: any of { name, paymentLag: 0 | 1 | 2, vatPercent: 21 | 0 }; a field left out is kept. 200 with the client,
 * 404 for a client the person does not have (another person's included), 422 for a value that cannot be stored.
 */
export async function PATCH(request: Request, { params }: Ctx) {
  return await handle(async () => {
    const id = parseId((await params).id);
    if (id === null) return errorResponse("Invalid id.", 400);
    const body = await request.json();
    if (typeof body !== "object" || body === null || Array.isArray(body))
      return errorResponse("Invalid JSON body.", 400);
    const { name, paymentLag, vatPercent } = body as Record<string, unknown>;
    try {
      return Response.json(
        await userDb((db) => updateBtwClient(db, id, { name, paymentLag, vatPercent })),
      );
    } catch (e) {
      if (e instanceof BtwClientNotFound) return notFound();
      throw e;
    }
  });
}

/** DELETE: 204, or 404 for a client the person does not have. The last client can be removed too. */
export async function DELETE(_req: Request, { params }: Ctx) {
  return await handle(async () => {
    const id = parseId((await params).id);
    if (id === null) return errorResponse("Invalid id.", 400);
    if (!(await userDb((db) => deleteBtwClient(db, id)))) return notFound();
    return new Response(null, { status: 204 });
  });
}
