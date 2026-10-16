import { handle } from "@/lib/api";
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
    if (length > MAX_BYTES)
      return Response.json({ error: "That file is too large." }, { status: 413 });
    let backup: unknown;
    try {
      backup = await request.json();
    } catch {
      return Response.json({ error: "That is not a backup file." }, { status: 400 });
    }
    try {
      return Response.json({ restored: await userDb((db) => restoreFromBackup(db, backup)) });
    } catch (e) {
      if (e instanceof RestoreError) return Response.json({ error: e.message }, { status: 422 });
      throw e;
    }
  });
}
