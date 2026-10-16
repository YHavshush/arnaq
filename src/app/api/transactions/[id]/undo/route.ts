import { userDb } from "@/lib/auth/request";
import { handle, parseId } from "@/lib/api";
import { undoAutomatic } from "@/lib/smart/review";

/** POST: undo an automatic category (it goes back to the list of things to sort). */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return await handle(async () => {
    const id = parseId((await params).id);
    if (id === null) return Response.json({ error: "Valid id is required." }, { status: 400 });
    const changed = await userDb((db) => undoAutomatic(db, id));
    return Response.json({ changed });
  });
}
