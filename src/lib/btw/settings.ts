import { schema, type Db } from "@/db";
import {
  DEFAULT_BTW_INCOME_MATCH,
  DEFAULT_BTW_PAYMENT_LAG,
  DEFAULT_BTW_POCKET_MATCH,
  isBtwPaymentLag,
  type BtwPaymentLag,
} from "./defaults";

/** A client name or pocket word that cannot be stored (the message is English; it is translated at the API edge). */
export class BtwError extends Error {}

const MAX_LENGTH = 60;

export interface BtwSettings {
  /** What the client is called on the statement (matched as whole words). */
  client: string;
  /** The word on a move to savings that makes it BTW money. */
  pocket: string;
  /** How many months after the invoice the client usually pays (0, 1 or 2); see btwQuarterOfReceipt. */
  paymentLag: BtwPaymentLag;
  /**
   * The BTW pot is a part of the savings account that the bank does not name: the savings count toward the BTW still
   * to set aside first (see btwPot). Off by default.
   */
  potInSavings: boolean;
}

export async function getBtwSettings(db: Db): Promise<BtwSettings> {
  const [row] = await db.select().from(schema.userSettings);
  const lag = row?.btwPaymentLag;
  return {
    client: row?.btwClient ?? DEFAULT_BTW_INCOME_MATCH,
    pocket: row?.btwPocket ?? DEFAULT_BTW_POCKET_MATCH,
    paymentLag: isBtwPaymentLag(lag) ? lag : DEFAULT_BTW_PAYMENT_LAG,
    potInSavings: row?.btwPotInSavings === true,
  };
}

/** Empty means "the default again" (stored as null). Leave a field out to keep it. */
export async function setBtwSettings(
  db: Db,
  input: { client?: string; pocket?: string; paymentLag?: number; potInSavings?: unknown },
): Promise<BtwSettings> {
  const values: {
    btwClient?: string | null;
    btwPocket?: string | null;
    btwPaymentLag?: number;
    btwPotInSavings?: boolean;
  } = {};
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
  if (input.paymentLag !== undefined) {
    if (!isBtwPaymentLag(input.paymentLag))
      throw new BtwError("The payment lag must be 0, 1 or 2 months.");
    values.btwPaymentLag = input.paymentLag;
  }
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
