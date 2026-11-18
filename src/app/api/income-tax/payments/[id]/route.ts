import { errorResponse, handle, parseId } from "@/lib/api";
import { userDb } from "@/lib/auth/request";
import { TaxOfficePaymentNotFound, setIncomeTaxPaymentYear } from "@/lib/income-tax/payments";

type Ctx = { params: Promise<{ id: string }> };

/**
 * PUT JSON: { year: number | null }. Picks a payment to the tax office (a transaction id) as income tax for one of the
 * person's tax years, or with null says it is not income tax. 200 with { id, date, amount, year }; 404 for a payment the
 * person does not have; 422 for a payment that is not money out to the tax office, or a year they have not typed.
 */
export async function PUT(request: Request, { params }: Ctx) {
  return await handle(async () => {
    const id = parseId((await params).id);
    if (id === null) return errorResponse("Invalid id.", 400);
    const body = await request.json();
    if (typeof body !== "object" || body === null || Array.isArray(body) || !("year" in body))
      return errorResponse("Invalid JSON body.", 400);
    const { year } = body as { year: unknown };
    try {
      return Response.json(await userDb((db) => setIncomeTaxPaymentYear(db, id, year)));
    } catch (e) {
      if (e instanceof TaxOfficePaymentNotFound) return errorResponse("Payment not found.", 404);
      throw e;
    }
  });
}
