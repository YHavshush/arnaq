import { errorResponse, handle } from "@/lib/api";
import { userDb } from "@/lib/auth/request";
import { getIncomeTaxSettings, setIncomeTaxSettings } from "@/lib/income-tax/settings";

/** GET: { on, pocket, potInSavings }: the income tax reserve's settings (the tax years are /api/income-tax/years). */
export async function GET() {
  return await handle(async () => Response.json(await userDb((db) => getIncomeTaxSettings(db))));
}

/**
 * PUT JSON: { on?: boolean, pocket?: string, potInSavings?: boolean }. An empty pocket word brings the default back; a
 * field left out is kept. A wrong type or value is a 422 (English message, translated at the edge).
 */
export async function PUT(request: Request) {
  return await handle(async () => {
    const body = await request.json();
    if (typeof body !== "object" || body === null || Array.isArray(body))
      return errorResponse("Invalid JSON body.", 400);
    const { on, pocket, potInSavings } = body as Record<string, unknown>;
    return Response.json(
      await userDb((db) => setIncomeTaxSettings(db, { on, pocket, potInSavings })),
    );
  });
}
