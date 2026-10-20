import { errorResponse, handle } from "@/lib/api";
import { userDb } from "@/lib/auth/request";
import { getSavingsSettings, SavingsError, setSavingsSettings } from "@/lib/savings/settings";

/** GET: the savings goal and the amount already saved before the first upload (cents). */
export async function GET() {
  return await handle(async () => Response.json(await userDb((db) => getSavingsSettings(db))));
}

/** PUT JSON: { goal?: cents | null, start?: cents }. `goal: null` removes the goal. */
export async function PUT(request: Request) {
  return await handle(async () => {
    const body = await request.json();
    if (typeof body !== "object" || body === null || Array.isArray(body))
      return errorResponse("Invalid JSON body.", 400);
    const { goal, start } = body as { goal?: unknown; start?: unknown };
    // Wrong types are reported like wrong values: the same two messages, translated at the edge.
    if (goal !== undefined && goal !== null && typeof goal !== "number")
      throw new SavingsError("The savings goal must be a positive amount.");
    if (start !== undefined && typeof start !== "number")
      throw new SavingsError("The amount already saved cannot be negative.");
    return Response.json(await userDb((db) => setSavingsSettings(db, { goal, start })));
  });
}
