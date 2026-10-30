import { handle, errorResponse } from "@/lib/api";
import { userDb } from "@/lib/auth/request";
import { RestoreError, restoreFromBackup } from "@/lib/restore";

const MAX_BYTES = 25 * 1024 * 1024;

/**
 * POST JSON: the file made by "Full backup" in Settings. Replaces the signed-in person's data with it,
 * all or nothing (one transaction): a broken file changes nothing.
 */
export async function POST(request: Request) {
  return await handle(async () => {
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > MAX_BYTES) return errorResponse("That file is too large.", 413);
    let backup: unknown;
    try {
      backup = await request.json();
    } catch {
      return errorResponse("That is not a backup file.", 400);
    }
    try {
      return Response.json({ restored: await userDb((db) => restoreFromBackup(db, backup)) });
    } catch (e) {
      if (e instanceof RestoreError) return errorResponse(e.message, 422);
      throw e;
    }
  });
}
