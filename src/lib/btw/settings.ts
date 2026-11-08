import { schema, type Db } from "@/db";
import { DEFAULT_BTW_POCKET_MATCH } from "./defaults";
import { BtwError, cleanBtwName } from "./names";

export { BtwError, cleanBtwName };

/**
 * The BTW settings that are one per person. Who the clients are, when each pays and at what rate is a list of its own
 * (./clients). The columns user_settings.btw_client and btw_payment_lag are still in the database (migration 0013 moved
 * them into btw_clients) but are no longer read or written.
 */
export interface BtwSettings {
  /** The word on a move to savings that makes it BTW money. */
  pocket: string;
  /**
   * The BTW pot is a part of the savings account that the bank does not name: the savings count toward the BTW still
   * to set aside first (see btwPot). Off by default.
   */
  potInSavings: boolean;
}

export async function getBtwSettings(db: Db): Promise<BtwSettings> {
  const [row] = await db
    .select({ pocket: schema.userSettings.btwPocket, pot: schema.userSettings.btwPotInSavings })
    .from(schema.userSettings);
  return {
    pocket: row?.pocket ?? DEFAULT_BTW_POCKET_MATCH,
    potInSavings: row?.pot === true,
  };
}

/** An empty pocket word means "the default again" (stored as null). Leave a field out to keep it. */
export async function setBtwSettings(
  db: Db,
  input: { pocket?: string; potInSavings?: unknown },
): Promise<BtwSettings> {
  const values: { btwPocket?: string | null; btwPotInSavings?: boolean } = {};
  if (input.pocket !== undefined) values.btwPocket = cleanBtwName(input.pocket);
  if (input.potInSavings !== undefined) {
    if (typeof input.potInSavings !== "boolean")
      throw new BtwError("The BTW pot setting must be on or off.");
    values.btwPotInSavings = input.potInSavings;
  }
  if (Object.keys(values).length > 0)
    await db
      .insert(schema.userSettings)
      .values(values)
      .onConflictDoUpdate({ target: schema.userSettings.userId, set: values });
  return await getBtwSettings(db);
}
