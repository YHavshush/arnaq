import { userDb } from "@/lib/auth/request";
import { handle, isInt, parseId, errorResponse } from "@/lib/api";
import { assignCategory } from "@/lib/categories/categorise";

/** PUT JSON: { categoryId, learn?, createRule?, pattern?, priority? } */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return await handle(async () => {
    const id = parseId((await params).id);
    const body = await request.json();
    if (id === null || !isInt(body?.categoryId)) {
      return errorResponse("Valid id and categoryId are required.", 400);
    }
    return Response.json(
      await userDb((db) =>
        assignCategory(db, id, body.categoryId, {
          createRule: body.createRule === true,
          learn: body.learn === true,
          pattern: typeof body.pattern === "string" ? body.pattern : undefined,
          priority: isInt(body.priority) ? body.priority : undefined,
        }),
      ),
    );
  });
}
