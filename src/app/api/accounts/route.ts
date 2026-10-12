import { eq } from "drizzle-orm";
import { first, getDb, schema } from "@/db";
import { BANKS } from "@/db/schema";
import { handle, requestTime } from "@/lib/api";

export async function GET() {
  await requestTime();
  return Response.json(await (await getDb()).select().from(schema.accounts));
}

const CURRENCY_RE = /^[A-Z]{3}$/;

/** POST JSON: { name, bank, iban?, currency? } */
export async function POST(request: Request) {
  return await handle(async () => {
    const body = await request.json();
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 100 || !BANKS.includes(body?.bank)) {
      return Response.json(
        { error: "name (max 100 chars) and bank (rabobank | revolut) are required." },
        { status: 400 },
      );
    }
    const iban =
      typeof body.iban === "string" && body.iban.trim()
        ? body.iban.replaceAll(/\s/g, "").toUpperCase()
        : null;
    if (iban !== null && !/^[A-Z]{2}\d{2}[A-Z0-9]{1,30}$/.test(iban)) {
      return Response.json({ error: "Invalid IBAN." }, { status: 400 });
    }
    const currency = typeof body.currency === "string" && body.currency ? body.currency : "EUR";
    if (!CURRENCY_RE.test(currency)) {
      return Response.json(
        { error: "currency must be a 3-letter code like EUR." },
        { status: 400 },
      );
    }

    const db = await getDb();
    // An IBAN identifies one account: duplicates would confuse import and transfer detection.
    if (
      iban &&
      (await first(db.select().from(schema.accounts).where(eq(schema.accounts.iban, iban))))
    ) {
      return Response.json({ error: "An account with this IBAN already exists." }, { status: 422 });
    }
    const [account] = await db
      .insert(schema.accounts)
      .values({ name, bank: body.bank, iban, currency })
      .returning();
    return Response.json(account, { status: 201 });
  });
}
