import { getDb, schema } from "@/db";
import { eq } from "drizzle-orm";
import { handle, isInt } from "@/lib/api";
import { assertMonth, clearBudget, setBudget } from "@/lib/budget/budgets";

/** GET /api/budgets?month=YYYY-MM */
export async function GET(request: Request) {
  return handle(() => {
    const month = new URL(request.url).searchParams.get("month") ?? "";
    assertMonth(month);
    return Response.json(
      getDb().select().from(schema.budgets).where(eq(schema.budgets.month, month)).all(),
    );
  });
}

/** PUT JSON: { month, categoryId, amount } in cents. amount null removes the budget. */
export async function PUT(request: Request) {
  return handle(async () => {
    const body = await request.json();
    if (
      typeof body?.month !== "string" ||
      !isInt(body?.categoryId) ||
      !(isInt(body?.amount) || body?.amount === null)
    ) {
      return Response.json(
        { error: "month, categoryId and amount (cents or null) are required." },
        { status: 400 },
      );
    }
    if (body.amount === null) {
      assertMonth(body.month);
      clearBudget(getDb(), body.categoryId, body.month);
    } else {
      setBudget(getDb(), body.categoryId, body.month, body.amount);
    }
    return Response.json({ ok: true });
  });
}
