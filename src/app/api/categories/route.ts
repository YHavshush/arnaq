import { requestTime } from "@/lib/api";
import { getDb, schema } from "@/db";

export async function GET() {
  await requestTime();
  return Response.json(
    await (await getDb()).select().from(schema.categories).orderBy(schema.categories.sortOrder),
  );
}
