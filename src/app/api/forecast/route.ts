import { userDb } from "@/lib/auth/request";
import { handle, intParam, requestTime, todayIso } from "@/lib/api";
import { getForecast } from "@/lib/forecast/forecast";

/**
 * GET /api/forecast?months=6&history=3&pastMonths=3 (all optional, whole numbers).
 * months: 1-36 months ahead of the current month; history: 1-12 uploaded months to average
 * variable spend over; pastMonths: 0-12 months of actuals before the current month.
 * 422 when invalid. Read-only: nothing is generated or matched.
 */
export async function GET(request: Request) {
  // The answer depends on today's date: never prerender it.
  await requestTime();
  return await handle(async () => {
    const params = new URL(request.url).searchParams;
    return Response.json(
      await userDb((db) =>
        getForecast(db, {
          today: todayIso(),
          months: intParam(params, "months"),
          history: intParam(params, "history"),
          pastMonths: intParam(params, "pastMonths"),
        }),
      ),
    );
  });
}
