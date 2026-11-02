import { userDb } from "@/lib/auth/request";
import { errorResponse, handle, intParam, requestTime, todayIso } from "@/lib/api";
import { PlanError, setPlanOverride } from "@/lib/plan/overrides";
import { loadPlan, type PlanBasis } from "@/lib/view/plan";

const BASES: readonly PlanBasis[] = ["averages", "budget", "own"];

/**
 * GET /api/plan?months=6&basis=averages (both optional). The plan grid for the current month and `months` (1-24)
 * months after it, on the basis the Ahead screen uses ("averages", "budget" or "own"). 422 when invalid. Read-only.
 */
export async function GET(request: Request) {
  // The answer depends on today's date: never prerender it.
  await requestTime();
  return await handle(async () => {
    const params = new URL(request.url).searchParams;
    const basis = params.get("basis") ?? "averages";
    if (!BASES.includes(basis as PlanBasis))
      throw new PlanError('The basis must be "averages", "budget" or "own".');
    const months = intParam(params, "months") ?? 6;
    return Response.json(
      await userDb((db) => loadPlan(db, todayIso(), { months, basis: basis as PlanBasis })),
    );
  });
}

/**
 * PUT JSON: { kind: "category" | "item", id, month: "YYYY-MM", amount: cents | null, scope: "month" | "after" }.
 * Types a cell of the plan (amount null clears it). "after" writes (or clears) this month and every later one up to 24
 * months after the current month. Past months, the BTW row, unknown or someone else's ids and amounts that are not
 * whole cents of zero or more are refused (422). Answers with the months written or cleared.
 */
export async function PUT(request: Request) {
  return await handle(async () => {
    const body = await request.json();
    if (typeof body !== "object" || body === null || Array.isArray(body))
      return errorResponse("Invalid JSON body.", 400);
    const { kind, id, month, amount, scope } = body as Record<string, unknown>;
    return Response.json(
      await userDb((db) => setPlanOverride(db, { kind, id, month, amount, scope }, todayIso())),
    );
  });
}
