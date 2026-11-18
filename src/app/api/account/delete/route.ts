import { handle, errorResponse } from "@/lib/api";
import { userDb } from "@/lib/auth/request";
import { deleteAllMyData } from "@/lib/account";
import { revokeSessions, sessionIdsOf } from "@/lib/banking/connections";
import { bankingConfig } from "@/lib/banking/enable-banking";

/**
 * POST JSON: { confirm: "delete" }. Deletes all of the signed-in person's data (not their login). Linked banks are
 * disconnected too: once the data is gone, their consents are ended at Enable Banking (as well as it can be reached).
 */
export async function POST(request: Request) {
  return await handle(async () => {
    const body = await request.json();
    if (body?.confirm !== "delete") return errorResponse('Type "delete" to confirm.', 400);
    const sessions = await userDb(async (db) => {
      const ids = await sessionIdsOf(db);
      await deleteAllMyData(db);
      return ids;
    });
    await revokeSessions(bankingConfig(), sessions);
    return Response.json({ ok: true });
  });
}
