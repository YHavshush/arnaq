import { getDb } from "@/db";
import { handle, isInt } from "@/lib/api";
import { setTotalBudget } from "@/lib/budget/budgets";

/** PUT JSON: { month, amount } in cents. amount null removes the explicit total. */
export async function PUT(request: Request) {
  return handle(async () => {
    const body = await request.json();
    if (typeof body?.month !== "string" || !(isInt(body?.amount) || body?.amount === null)) {
      return Response.json(
        { error: "month and amount (cents or null) are required." },
        { status: 400 },
      );
    }
    setTotalBudget(getDb(), body.month, body.amount);
    return Response.json({ ok: true });
  });
}
