import { errorResponse, handle } from "@/lib/api";
import { userDb } from "@/lib/auth/request";
import { addIncomeTaxYear, getIncomeTaxYears } from "@/lib/income-tax/years";

/** GET: the person's tax years, oldest first: [{ id, year, rate (basis points), knownAmount (cents) | null }]. */
export async function GET() {
  return await handle(async () => Response.json(await userDb((db) => getIncomeTaxYears(db))));
}

/**
 * POST JSON: { year: 2000..2100, rate: 0..6000 (basis points: 490 = 4.9%), knownAmount?: cents | null }. 201 with the new
 * year. A year out of range or already there, a rate out of range or a bad amount is a 422 (translated at the edge).
 */
export async function POST(request: Request) {
  return await handle(async () => {
    const body = await request.json();
    if (typeof body !== "object" || body === null || Array.isArray(body))
      return errorResponse("Invalid JSON body.", 400);
    const { year, rate, knownAmount } = body as Record<string, unknown>;
    return Response.json(await userDb((db) => addIncomeTaxYear(db, { year, rate, knownAmount })), {
      status: 201,
    });
  });
}
