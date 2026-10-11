import { getDb } from "@/db";
import { handle, isInt, parseId } from "@/lib/api";
import { assignCategory } from "@/lib/categories/categorise";

/** PUT JSON: { categoryId, createRule?, pattern?, priority? } */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const id = parseId((await params).id);
    const body = await request.json();
    if (id === null || !isInt(body?.categoryId)) {
      return Response.json({ error: "Valid id and categoryId are required." }, { status: 400 });
    }
    return Response.json(
      assignCategory(getDb(), id, body.categoryId, {
        createRule: body.createRule === true,
        pattern: typeof body.pattern === "string" ? body.pattern : undefined,
        priority: isInt(body.priority) ? body.priority : undefined,
      }),
    );
  });
}
