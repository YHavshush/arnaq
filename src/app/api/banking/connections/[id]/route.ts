import { errorResponse, handle, parseId } from "@/lib/api";
import { userDb } from "@/lib/auth/request";
import { currentUserId } from "@/lib/auth/session";
import { BankingError, ConnectionNotFound, disconnect } from "@/lib/banking/connections";
import { bankingConfig } from "@/lib/banking/enable-banking";
import { bankingAllowed, notConfigured, tooMany, unreachable } from "@/lib/banking/http";

type Ctx = { params: Promise<{ id: string }> };

/**
 * DELETE: disconnect a bank. The consent is ended at Enable Banking first, then the connection is closed and its links
 * removed; the transactions it brought in stay. 204, 404 for a connection the person does not have, 502 when Enable
 * Banking cannot be reached (nothing changes then: try again).
 */
export async function DELETE(_req: Request, { params }: Ctx) {
  return await handle(async () => {
    const config = bankingConfig();
    if (!config) return notConfigured();
    if (!bankingAllowed("disconnect", await currentUserId())) return tooMany();
    const id = parseId((await params).id);
    if (id === null) return errorResponse("Invalid id.", 400);
    try {
      await disconnect(config, userDb, id);
    } catch (e) {
      if (e instanceof ConnectionNotFound) return errorResponse("Bank connection not found.", 404);
      if (e instanceof BankingError) return unreachable();
      throw e;
    }
    return new Response(null, { status: 204 });
  });
}
