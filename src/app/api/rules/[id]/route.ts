import { handle, parseId } from "@/lib/api";
import { userDb } from "@/lib/auth/request";
import { deleteRule } from "@/lib/categories/categorise";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return await handle(async () => {
    const id = parseId((await params).id);
    if (id === null) return Response.json({ error: "Invalid id." }, { status: 400 });
    await userDb((db) => deleteRule(db, id));
    return new Response(null, { status: 204 });
  });
}
