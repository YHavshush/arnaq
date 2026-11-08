import { errorResponse, handle } from "@/lib/api";
import { userDb } from "@/lib/auth/request";
import { BtwError, getBtwSettings, setBtwSettings } from "@/lib/btw/settings";

/** GET: the word that marks the BTW pocket, and whether the BTW pot is part of the savings. */
export async function GET() {
  return await handle(async () => Response.json(await userDb((db) => getBtwSettings(db))));
}

/**
 * PUT JSON: { pocket?: string, potInSavings?: boolean }. An empty pocket word brings the default back; a field left out
 * is kept. The clients (who, when they pay, at what rate) are a list of their own: /api/btw/clients. The old fields
 * `client` and `paymentLag` are ignored (a page opened before the list existed changes nothing with them).
 */
export async function PUT(request: Request) {
  return await handle(async () => {
    const body = await request.json();
    if (typeof body !== "object" || body === null || Array.isArray(body))
      return errorResponse("Invalid JSON body.", 400);
    const { pocket, potInSavings } = body as { pocket?: unknown; potInSavings?: unknown };
    // Wrong types are reported like wrong values: the same message, translated at the edge.
    if (pocket !== undefined && typeof pocket !== "string")
      throw new BtwError("Use letters or numbers in the name.");
    if (potInSavings !== undefined && typeof potInSavings !== "boolean")
      throw new BtwError("The BTW pot setting must be on or off.");
    return Response.json(await userDb((db) => setBtwSettings(db, { pocket, potInSavings })));
  });
}
