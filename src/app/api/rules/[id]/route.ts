import { getDb } from "@/db";
import { deleteRule } from "@/lib/categories/categorise";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return Response.json({ error: "Invalid id." }, { status: 400 });
  deleteRule(getDb(), id);
  return new Response(null, { status: 204 });
}
