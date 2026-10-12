import { schema } from "@/db";
import { handle, requestTime } from "@/lib/api";
import { userDb } from "@/lib/auth/request";

export async function GET() {
  await requestTime();
  return await handle(async () =>
    Response.json(
      await userDb((db) =>
        db.select().from(schema.categories).orderBy(schema.categories.sortOrder),
      ),
    ),
  );
}
