import { schema, type Db } from "@/db";
import { DEFAULT_BTW_INCOME_MATCH, DEFAULT_BTW_POCKET_MATCH } from "./defaults";

/** A client name or pocket word that cannot be stored (the message is English; it is translated at the API edge). */
export class BtwError extends Error {}


const MAX_LENGTH = 60;

export interface BtwSettings {
  /** What the client is called on the statement (matched as whole words). */
  client: string;
  /** The word on a move to savings that makes it BTW money. */
  pocket: string;
}

export async function getBtwSettings(db: Db): Promise<BtwSettings> {
  const [row] = await db.select().from(schema.userSettings);
  return {
    client: row?.btwClient ?? DEFAULT_BTW_INCOME_MATCH,
    pocket: row?.btwPocket ?? DEFAULT_BTW_POCKET_MATCH,
  };
}

/** Empty means "the default again" (stored as null). Leave a field out to keep it. */
export async function setBtwSettings(
  db: Db,
  input: { client?: string; pocket?: string },
): Promise<BtwSettings> {
  const values: { btwClient?: string | null; btwPocket?: string | null } = {};
  const clean = (v: string) => {
    const text = v.trim().replace(/\s+/g, " ");
    if (text.length > MAX_LENGTH) throw new BtwError(`The name is too long (max ${MAX_LENGTH}).`);
    // Letters or digits are needed: the match works on whole words, so punctuation alone never matches.
    if (text !== "" && !/[\p{L}\p{N}]/u.test(text))
      throw new BtwError("Use letters or numbers in the name.");
    return text === "" ? null : text;
  };
  if (input.client !== undefined) values.btwClient = clean(input.client);
  if (input.pocket !== undefined) values.btwPocket = clean(input.pocket);
  if (Object.keys(values).length > 0)
    await db
      .insert(schema.userSettings)
      .values(values)
      .onConflictDoUpdate({ target: schema.userSettings.userId, set: values });
  return await getBtwSettings(db);
}
