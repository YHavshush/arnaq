import { getDb } from "@/db";
import { handle } from "@/lib/api";
import { getMonthOverview } from "@/lib/budget/overview";

/** GET /api/overview?month=YYYY-MM */
export async function GET(request: Request) {
  return handle(() => {
    const month = new URL(request.url).searchParams.get("month") ?? "";
    return Response.json(getMonthOverview(getDb(), month));
  });
}
