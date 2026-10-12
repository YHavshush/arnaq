import { userDb } from "@/lib/auth/request";
import { handle, requestTime, todayIso } from "@/lib/api";
import { buildExport } from "@/lib/export";

/** GET /api/export: a full backup of everything, as one JSON file to save. */
export async function GET() {
  await requestTime();
  return await handle(async () => {
    const data = await userDb((db) => buildExport(db));
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="kasboek-backup-${todayIso()}.json"`,
        "cache-control": "no-store",
      },
    });
  });
}
