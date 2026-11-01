import { errorResponse, handle } from "@/lib/api";
import { userDb } from "@/lib/auth/request";
import { ForecastError } from "@/lib/forecast/errors";
import { getOwnSpending, setOwnSpending } from "@/lib/forecast/own";

/** GET: the monthly everyday spending the person expects (cents), or null. */
export async function GET() {
  return await handle(async () =>
    Response.json({ amount: await userDb((db) => getOwnSpending(db)) }),
  );
}

/** PUT JSON: { amount: cents | null }. null clears it. */
export async function PUT(request: Request) {
  return await handle(async () => {
    const body = await request.json();
    if (typeof body !== "object" || body === null || Array.isArray(body))
      return errorResponse("Invalid JSON body.", 400);
    const { amount } = body as { amount?: unknown };
    if (amount !== null && typeof amount !== "number")
      throw new ForecastError("The expected spending must be an amount of zero or more.");
    return Response.json({ amount: await userDb((db) => setOwnSpending(db, amount)) });
  });
}
