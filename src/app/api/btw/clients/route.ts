import { errorResponse, handle } from "@/lib/api";
import { userDb } from "@/lib/auth/request";
import { addBtwClient, getBtwClients } from "@/lib/btw/clients";

/** GET: the person's BTW clients, oldest first: [{ id, name, paymentLag: 0 | 1 | 2, vatPercent: 21 | 0 }]. */
export async function GET() {
  return await handle(async () => Response.json(await userDb((db) => getBtwClients(db))));
}

/**
 * POST JSON: { name: string, paymentLag?: 0 | 1 | 2 (default 0), vatPercent?: 21 | 0 (default 21) }. 201 with the new
 * client. A name that is empty, too long, without letters or numbers or already in the list, a wrong lag or rate, or a
 * 21st client is a 422 (English message, translated at the edge).
 */
export async function POST(request: Request) {
  return await handle(async () => {
    const body = await request.json();
    if (typeof body !== "object" || body === null || Array.isArray(body))
      return errorResponse("Invalid JSON body.", 400);
    const { name, paymentLag, vatPercent } = body as Record<string, unknown>;
    return Response.json(await userDb((db) => addBtwClient(db, { name, paymentLag, vatPercent })), {
      status: 201,
    });
  });
}
