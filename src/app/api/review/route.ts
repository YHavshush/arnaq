import { handle, requestTime } from "@/lib/api";
import { userDb } from "@/lib/auth/request";
import { getNeedsReview } from "@/lib/categories/categorise";

export async function GET() {
  await requestTime();
  return await handle(async () => Response.json(await userDb((db) => getNeedsReview(db))));
}
