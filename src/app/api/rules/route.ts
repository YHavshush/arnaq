import { schema } from "@/db";
import { userDb } from "@/lib/auth/request";
import { handle, isInt, requestTime } from "@/lib/api";
import { applyRules, sortRules } from "@/lib/categories/categorise";

export async function GET() {
  await requestTime();
  return await handle(async () =>
    Response.json(sortRules(await userDb((db) => db.select().from(schema.categorisationRules)))),
  );
}

/** POST JSON: { pattern, categoryId, priority? }. Also categorises existing uncategorised rows. */
export async function POST(request: Request) {
  return await handle(async () => {
    const body = await request.json();
    const pattern = typeof body?.pattern === "string" ? body.pattern.trim() : "";
    if (pattern.length < 2 || pattern.length > 100 || !isInt(body?.categoryId)) {
      return Response.json(
        { error: "pattern (2 to 100 chars) and categoryId are required." },
        { status: 400 },
      );
    }
    return await userDb(async (db) => {
      const [rule] = await db
        .insert(schema.categorisationRules)
        .values({
          pattern,
          categoryId: body.categoryId,
          priority: isInt(body.priority) ? body.priority : 10,
        })
        .returning();
      return Response.json({ rule, alsoCategorised: await applyRules(db) }, { status: 201 });
    });
  });
}
