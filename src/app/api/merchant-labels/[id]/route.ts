import { handle, parseId } from "@/lib/api";
import { userDb } from "@/lib/auth/request";
import { forgetLabel } from "@/lib/smart/learned";

/** DELETE: forget a remembered shop (the transactions already sorted keep their category). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return await handle(async () => {
    const id = parseId((await params).id);
    if (id === null) return Response.json({ error: "Invalid id." }, { status: 400 });
    await userDb((db) => forgetLabel(db, id));
    return new Response(null, { status: 204 });
  });
}
