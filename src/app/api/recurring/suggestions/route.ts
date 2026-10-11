import { getDb } from "@/db";
import { requestTime, todayIso } from "@/lib/api";
import { detectSuggestions } from "@/lib/recurring/suggestions";

export async function GET() {
  await requestTime();
  return Response.json(detectSuggestions(getDb(), { today: todayIso() }));
}
