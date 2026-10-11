import { getDb } from "@/db";
import { handle } from "@/lib/api";
import { copyBudgets } from "@/lib/budget/budgets";

/** POST JSON: { from, to } as YYYY-MM. Copies all category budgets and the total. */
export async function POST(request: Request) {
  return handle(async () => {
    const body = await request.json();
    if (typeof body?.from !== "string" || typeof body?.to !== "string") {
      return Response.json({ error: "from and to are required." }, { status: 400 });
    }
    return Response.json({ copied: copyBudgets(getDb(), body.from, body.to) });
  });
}
