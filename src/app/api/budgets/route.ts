import { schema } from "@/db";
import { userDb } from "@/lib/auth/request";
import { eq } from "drizzle-orm";
import { handle, isInt } from "@/lib/api";
import { assertMonth, clearBudget, setBudget } from "@/lib/budget/budgets";

/** GET /api/budgets?month=YYYY-MM */
export async function GET(request: Request) {
  return await handle(async () => {
    const month = new URL(request.url).searchParams.get("month") ?? "";
    assertMonth(month);
    return Response.json(
      await userDb((db) => db.select().from(schema.budgets).where(eq(schema.budgets.month, month))),
    );
  });
}

/** PUT JSON: { month, categoryId, amount } in cents. amount null removes the budget. */
export async function PUT(request: Request) {
  return await handle(async () => {
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
      await userDb((db) => clearBudget(db, body.categoryId, body.month));
    } else {
      await userDb((db) => setBudget(db, body.categoryId, body.month, body.amount));
    }
    return Response.json({ ok: true });
  });
}
