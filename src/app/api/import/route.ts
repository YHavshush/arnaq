import { getDb } from "@/db";
import { ImportError, importCsv } from "@/lib/import/service";

const MAX_BYTES = 5 * 1024 * 1024;

/** POST multipart/form-data: file (required), accountId (optional), month=YYYY-MM (optional). */
export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Expected multipart/form-data." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Missing file." }, { status: 400 });
  if (file.size > MAX_BYTES)
    return Response.json({ error: "File too large (max 5 MB)." }, { status: 413 });

  const accountRaw = form.get("accountId");
  const monthRaw = form.get("month");
  const accountId = accountRaw ? Number(accountRaw) : undefined;
  if (accountId !== undefined && !Number.isInteger(accountId)) {
    return Response.json({ error: "Invalid accountId." }, { status: 400 });
  }

  try {
    const summary = importCsv(getDb(), {
      content: await file.text(),
      filename: file.name,
      accountId,
      month: typeof monthRaw === "string" && monthRaw ? monthRaw : undefined,
    });
    return Response.json(summary);
  } catch (e) {
    if (e instanceof ImportError) return Response.json({ error: e.message }, { status: 422 });
    throw e;
  }
}
