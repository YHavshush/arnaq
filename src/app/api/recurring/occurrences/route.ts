import { userDb } from "@/lib/auth/request";
import { handle } from "@/lib/api";
import { getOccurrences } from "@/lib/recurring/occurrences";

/**
 * GET /api/recurring/occurrences?from=YYYY-MM&to=YYYY-MM (both optional, inclusive).
 * Each occurrence has expectedAmount (the plan) and, when matched, actualAmount from the
 * transaction; `amount` is the one to count.
 */
export async function GET(request: Request) {
  return await handle(async () => {
    const params = new URL(request.url).searchParams;
    return Response.json(
      await userDb((db) =>
        getOccurrences(db, {
          from: params.get("from") ?? undefined,
          to: params.get("to") ?? undefined,
        }),
      ),
    );
  });
}
