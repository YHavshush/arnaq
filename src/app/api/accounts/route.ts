import { getDb, schema } from "@/db";
import { BANKS } from "@/db/schema";

export async function GET() {
  return Response.json(getDb().select().from(schema.accounts).all());
}

/** POST JSON: { name, bank, iban?, currency? } */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name || !BANKS.includes(body?.bank)) {
    return Response.json(
      { error: "name and bank (rabobank | revolut) are required." },
      { status: 400 },
    );
  }
  const [account] = getDb()
    .insert(schema.accounts)
    .values({
      name,
      bank: body.bank,
      iban: typeof body.iban === "string" && body.iban ? body.iban : null,
      currency: typeof body.currency === "string" && body.currency ? body.currency : "EUR",
    })
    .returning()
    .all();
  return Response.json(account, { status: 201 });
}
