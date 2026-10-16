import { handle } from "@/lib/api";
import { userDb } from "@/lib/auth/request";
import { deleteAllMyData } from "@/lib/account";

/** POST JSON: { confirm: "delete" }. Deletes all of the signed-in person's data (not their login). */
export async function POST(request: Request) {
  return await handle(async () => {
    const body = await request.json();
    if (body?.confirm !== "delete")
      return Response.json({ error: 'Type "delete" to confirm.' }, { status: 400 });
    await userDb((db) => deleteAllMyData(db));
    return Response.json({ ok: true });
  });
}
