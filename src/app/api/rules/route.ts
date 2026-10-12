import { getDb, schema } from "@/db";
import { handle, isInt, requestTime } from "@/lib/api";
import { applyRules, sortRules } from "@/lib/categories/categorise";

export async function GET() {
  await requestTime();
  return Response.json(sortRules(await (await getDb()).select().from(schema.categorisationRules)));
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
    const db = await getDb();
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
}
