import { getDb } from "@/db";
import { MAX_ID, todayIso } from "@/lib/api";
import { isPdf } from "@/lib/import/pdf";
import { ImportError, importStatement } from "@/lib/import/service";

const MAX_BYTES = 2 * 1024 * 1024;

/** POST multipart/form-data: file (required), accountId (optional), month=YYYY-MM (optional). */
export async function POST(request: Request) {
  // Refuse before buffering the body. (A reverse proxy should enforce the same cap, see deploy notes.)
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BYTES + 64 * 1024)
    return Response.json({ error: "File too large (max 2 MB)." }, { status: 413 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Expected multipart/form-data." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Missing file." }, { status: 400 });
  if (file.size > MAX_BYTES)
    return Response.json({ error: "File too large (max 2 MB)." }, { status: 413 });

  const accountRaw = form.get("accountId");
  const monthRaw = form.get("month");
  const accountId = accountRaw ? Number(accountRaw) : undefined;
  if (
    accountId !== undefined &&
    !(Number.isSafeInteger(accountId) && accountId > 0 && accountId <= MAX_ID)
  ) {
    return Response.json({ error: "Invalid accountId." }, { status: 400 });
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const summary = await importStatement(await getDb(), {
      // A PDF goes in as bytes. Text must not hold NUL characters (Postgres cannot store them).
      content: isPdf(bytes) ? bytes : new TextDecoder().decode(bytes).replaceAll("\u0000", ""),
      filename: file.name,
      accountId,
      month: typeof monthRaw === "string" && monthRaw ? monthRaw : undefined,
      today: todayIso(),
    });
    return Response.json(summary);
  } catch (e) {
    if (e instanceof ImportError) return Response.json({ error: e.message }, { status: 422 });
    throw e;
  }
}
