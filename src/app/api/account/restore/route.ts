import { handle, errorResponse } from "@/lib/api";
import { userDb } from "@/lib/auth/request";
import { RestoreError, restoreFromBackup } from "@/lib/restore";
import { revokeSessions, sessionIdsOf } from "@/lib/banking/connections";
import { bankingConfig } from "@/lib/banking/enable-banking";

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
      // A backup holds no bank links (a consent is not something to copy), so a restore ends them: link again after.
      const { restored, sessions } = await userDb(async (db) => {
        const ids = await sessionIdsOf(db);
        return { restored: await restoreFromBackup(db, backup), sessions: ids };
      });
      await revokeSessions(bankingConfig(), sessions);
      return Response.json({ restored });
    } catch (e) {
      if (e instanceof RestoreError) return errorResponse(e.message, 422);
      throw e;
    }
  });
}
