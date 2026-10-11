import { getDb } from "@/db";
import { handle } from "@/lib/api";
import { getOccurrences } from "@/lib/recurring/occurrences";

/**
 * GET /api/recurring/occurrences?from=YYYY-MM&to=YYYY-MM (both optional, inclusive).
 * Each occurrence has expectedAmount (the plan) and, when matched, actualAmount from the
 * transaction; `amount` is the one to count.
 */
export async function GET(request: Request) {
  return handle(() => {
    const params = new URL(request.url).searchParams;
    return Response.json(
      getOccurrences(getDb(), {
        from: params.get("from") ?? undefined,
        to: params.get("to") ?? undefined,
      }),
    );
  });
}
