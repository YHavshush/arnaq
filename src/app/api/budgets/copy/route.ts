import { userDb } from "@/lib/auth/request";
import { handle, errorResponse } from "@/lib/api";
import { copyBudgets } from "@/lib/budget/budgets";

/** POST JSON: { from, to } as YYYY-MM. Copies all category budgets and the total. */
export async function POST(request: Request) {
  return await handle(async () => {
    const body = await request.json();
    if (typeof body?.from !== "string" || typeof body?.to !== "string") {
      return errorResponse("from and to are required.", 400);
    }
    return Response.json({ copied: await userDb((db) => copyBudgets(db, body.from, body.to)) });
  });
}
