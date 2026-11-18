import { schema, type Db } from "@/db";
import { DEFAULT_BTW_POCKET_MATCH } from "@/lib/btw/defaults";
import { BtwError, cleanBtwName } from "@/lib/btw/names";
import { words } from "@/lib/btw/words";
import { DEFAULT_INCOME_TAX_POCKET_MATCH } from "./rate";

/** A value about the income tax reserve that cannot be stored (English; translated at the API edge). */
export class IncomeTaxError extends Error {}

export { DEFAULT_INCOME_TAX_POCKET_MATCH };

/** The income tax settings that are one per person. The rates are a list of their own (./years). */
export interface IncomeTaxSettings {
  /** On unless turned off. It only does something once a tax year is typed. */
  on: boolean;
  /** The word on a move to savings that makes it income tax money. */
  pocket: string;
  /** The income tax pot is part of the savings account: after the BTW pot, the savings count toward it. */
  potInSavings: boolean;
}

export async function getIncomeTaxSettings(db: Db): Promise<IncomeTaxSettings> {
  const [row] = await db
    .select({
      on: schema.userSettings.incomeTaxOn,
      pocket: schema.userSettings.incomeTaxPocket,
      pot: schema.userSettings.incomeTaxPotInSavings,
    })
    .from(schema.userSettings);
  return {
    on: row?.on !== false,
    pocket: row?.pocket ?? DEFAULT_INCOME_TAX_POCKET_MATCH,
    potInSavings: row?.pot === true,
  };
}

/** An empty pocket word means "the default again" (stored as null). Leave a field out to keep it. */
export async function setIncomeTaxSettings(
  db: Db,
  input: { on?: unknown; pocket?: unknown; potInSavings?: unknown },
): Promise<IncomeTaxSettings> {
  const values: {
    incomeTaxOn?: boolean;
    incomeTaxPocket?: string | null;
    incomeTaxPotInSavings?: boolean;
  } = {};
  if (input.on !== undefined) {
    if (typeof input.on !== "boolean")
      throw new IncomeTaxError("The income tax setting must be on or off.");
    values.incomeTaxOn = input.on;
  }
  if (input.pocket !== undefined) {
    if (typeof input.pocket !== "string")
      throw new IncomeTaxError("Use letters or numbers in the name.");
    let pocket: string | null;
    try {
      pocket = cleanBtwName(input.pocket);
    } catch (e) {
      if (e instanceof BtwError) throw new IncomeTaxError(e.message);
      throw e;
    }
    const [row] = await db.select({ btw: schema.userSettings.btwPocket }).from(schema.userSettings);
    // A move that names the BTW pocket is BTW money (see isIncomeTaxPocketMove), so a word that holds the BTW word
    // would never mark a move as income tax.
    if (
      words(pocket ?? DEFAULT_INCOME_TAX_POCKET_MATCH).includes(
        words(row?.btw ?? DEFAULT_BTW_POCKET_MATCH),
      )
    )
      throw new IncomeTaxError("Use a different word than the BTW pocket's.");
    values.incomeTaxPocket = pocket;
  }
  if (input.potInSavings !== undefined) {
    if (typeof input.potInSavings !== "boolean")
      throw new IncomeTaxError("The income tax pot setting must be on or off.");
    values.incomeTaxPotInSavings = input.potInSavings;
  }
  if (Object.keys(values).length > 0)
    await db
      .insert(schema.userSettings)
      .values(values)
      .onConflictDoUpdate({ target: schema.userSettings.userId, set: values });
  return await getIncomeTaxSettings(db);
}
