import { userDb } from "@/lib/auth/request";
import { handle, isInt } from "@/lib/api";
import { confirmAutomatic } from "@/lib/smart/review";

/** POST JSON: { ids: number[] } approve these automatic categories. */
export async function POST(request: Request) {
  return await handle(async () => {
    const body = await request.json();
    const ids: unknown = body?.ids;
    if (!Array.isArray(ids) || ids.length > 200 || !ids.every(isInt))
      return Response.json({ error: "ids must be a list of at most 200 ids." }, { status: 400 });
    return Response.json({
      confirmed: await userDb((db) => confirmAutomatic(db, ids as number[])),
    });
  });
}
