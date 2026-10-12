import { getDb } from "@/db";
import { parseId } from "@/lib/api";
import { deleteRule } from "@/lib/categories/categorise";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (id === null) return Response.json({ error: "Invalid id." }, { status: 400 });
  await deleteRule(await getDb(), id);
  return new Response(null, { status: 204 });
}
