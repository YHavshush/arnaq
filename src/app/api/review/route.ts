import { requestTime } from "@/lib/api";
import { getDb } from "@/db";
import { getNeedsReview } from "@/lib/categories/categorise";

export async function GET() {
  await requestTime();
  return Response.json(await getNeedsReview(await getDb()));
}
