import { errorResponse, handle } from "@/lib/api";
import { userDb } from "@/lib/auth/request";
import { BtwError, getBtwSettings, setBtwSettings } from "@/lib/btw/settings";

/** GET: who the BTW is set aside for, the word that marks the BTW pocket, and the client's payment lag. */
export async function GET() {
  return await handle(async () => Response.json(await userDb((db) => getBtwSettings(db))));
}

/**
 * PUT JSON: { client?: string, pocket?: string, paymentLag?: 0 | 1 | 2 }. An empty string brings the default back; a
 * field left out is kept.
 */
export async function PUT(request: Request) {
  return await handle(async () => {
    const body = await request.json();
    if (typeof body !== "object" || body === null || Array.isArray(body))
      return errorResponse("Invalid JSON body.", 400);
    const { client, pocket, paymentLag } = body as {
      client?: unknown;
      pocket?: unknown;
      paymentLag?: unknown;
    };
    // Wrong types are reported like wrong values: the same message, translated at the edge.
    if (
      (client !== undefined && typeof client !== "string") ||
      (pocket !== undefined && typeof pocket !== "string")
    )
      throw new BtwError("Use letters or numbers in the name.");
    if (paymentLag !== undefined && typeof paymentLag !== "number")
      throw new BtwError("The payment lag must be 0, 1 or 2 months.");
    return Response.json(await userDb((db) => setBtwSettings(db, { client, pocket, paymentLag })));
  });
}
