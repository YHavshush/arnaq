import { userDb } from "@/lib/auth/request";
import { UnauthenticatedError, currentUserId } from "@/lib/auth/session";
import { localizeMessage } from "@/i18n/server-messages";
import { MAX_ID, errorResponse, requestLocale, todayIso } from "@/lib/api";
import { isPdf } from "@/lib/import/pdf";
import { ImportError, importStatement } from "@/lib/import/service";

const MAX_BYTES = 2 * 1024 * 1024;

/** POST multipart/form-data: file (required), accountId (optional), month=YYYY-MM (optional). */
export async function POST(request: Request) {
  // Who is asking, before any of the body is read.
  try {
    await currentUserId();
  } catch (e) {
    if (e instanceof UnauthenticatedError) return errorResponse("Not signed in.", 401);
    throw e;
  }
  // Refuse before buffering the body. (A reverse proxy should enforce the same cap, see deploy notes.)
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BYTES + 64 * 1024) return errorResponse("File too large (max 2 MB).", 413);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse("Expected multipart/form-data.", 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) return errorResponse("Missing file.", 400);
  if (file.size > MAX_BYTES) return errorResponse("File too large (max 2 MB).", 413);

  const accountRaw = form.get("accountId");
  const monthRaw = form.get("month");
  const accountId = accountRaw ? Number(accountRaw) : undefined;
  if (
    accountId !== undefined &&
    !(Number.isSafeInteger(accountId) && accountId > 0 && accountId <= MAX_ID)
  ) {
    return errorResponse("Invalid accountId.", 400);
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const summary = await userDb((db) =>
      importStatement(db, {
        // A PDF goes in as bytes. Text must not hold NUL characters (Postgres cannot store them).
        content: isPdf(bytes) ? bytes : new TextDecoder().decode(bytes).replaceAll("\u0000", ""),
        filename: file.name,
        accountId,
        month: typeof monthRaw === "string" && monthRaw ? monthRaw : undefined,
        today: todayIso(),
      }),
    );
    // The service speaks English; what the person reads is translated here.
    const locale = await requestLocale();
    return Response.json({
      ...summary,
      warnings: summary.warnings.map((w) => localizeMessage(w, locale)),
      skipped: summary.skipped.map((r) => ({ ...r, reason: localizeMessage(r.reason, locale) })),
    });
  } catch (e) {
    if (e instanceof UnauthenticatedError) return errorResponse("Not signed in.", 401);
    if (e instanceof ImportError) return errorResponse(e.message, 422);
    throw e;
  }
}
