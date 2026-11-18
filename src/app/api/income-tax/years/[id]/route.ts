import { errorResponse, handle, parseId } from "@/lib/api";
import { userDb } from "@/lib/auth/request";
import {
  IncomeTaxYearNotFound,
  deleteIncomeTaxYear,
  updateIncomeTaxYear,
} from "@/lib/income-tax/years";

type Ctx = { params: Promise<{ id: string }> };

const notFound = () => errorResponse("Tax year not found.", 404);

/**
 * PATCH JSON: any of { year, rate, knownAmount (null clears it) }; a field left out is kept. 200 with the year, 404 for a
 * year the person does not have (another person's included), 422 for a value that cannot be stored.
 */
export async function PATCH(request: Request, { params }: Ctx) {
  return await handle(async () => {
    const id = parseId((await params).id);
    if (id === null) return errorResponse("Invalid id.", 400);
    const body = await request.json();
    if (typeof body !== "object" || body === null || Array.isArray(body))
      return errorResponse("Invalid JSON body.", 400);
    const { year, rate, knownAmount } = body as Record<string, unknown>;
    try {
      return Response.json(
        await userDb((db) => updateIncomeTaxYear(db, id, { year, rate, knownAmount })),
      );
    } catch (e) {
      if (e instanceof IncomeTaxYearNotFound) return notFound();
      throw e;
    }
  });
}

/** DELETE: 204, or 404 for a tax year the person does not have. */
export async function DELETE(_req: Request, { params }: Ctx) {
  return await handle(async () => {
    const id = parseId((await params).id);
    if (id === null) return errorResponse("Invalid id.", 400);
    if (!(await userDb((db) => deleteIncomeTaxYear(db, id)))) return notFound();
    return new Response(null, { status: 204 });
  });
}
