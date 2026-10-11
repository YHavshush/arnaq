import { getDb, schema } from "@/db";
import { handle, isInt, requestTime } from "@/lib/api";
import { applyRules, sortRules } from "@/lib/categories/categorise";

export async function GET() {
  await requestTime();
  return Response.json(sortRules(getDb().select().from(schema.categorisationRules).all()));
}

/** POST JSON: { pattern, categoryId, priority? }. Also categorises existing uncategorised rows. */
export async function POST(request: Request) {
  return handle(async () => {
    const body = await request.json();
    const pattern = typeof body?.pattern === "string" ? body.pattern.trim() : "";
    if (!pattern || !isInt(body?.categoryId)) {
      return Response.json({ error: "pattern and categoryId are required." }, { status: 400 });
    }
    const db = getDb();
    const [rule] = db
      .insert(schema.categorisationRules)
      .values({
        pattern,
        categoryId: body.categoryId,
        priority: isInt(body.priority) ? body.priority : 10,
      })
      .returning()
      .all();
    return Response.json({ rule, alsoCategorised: applyRules(db) }, { status: 201 });
  });
}
