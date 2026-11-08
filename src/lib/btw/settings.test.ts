import { describe, expect, it } from "vitest";
import { createDb, schema } from "@/db";
import { getBtwClients } from "./clients";
import { BtwError, getBtwSettings, setBtwSettings } from "./settings";

// Who the clients are and when each pays is the client list now (./clients.test.ts).
const DEFAULTS = { pocket: "BTW", potInSavings: false };

describe("btw settings", () => {
  it("starts with the defaults", async () => {
    const db = await createDb(":memory:");
    expect(await getBtwSettings(db)).toEqual(DEFAULTS);
  });

  it("saves a pocket word, trims it, and keeps what is left out", async () => {
    const db = await createDb(":memory:");
    await setBtwSettings(db, { pocket: "  Tax   pot " });
    expect(await getBtwSettings(db)).toEqual({ ...DEFAULTS, pocket: "Tax pot" });
    await setBtwSettings(db, { potInSavings: true });
    expect(await getBtwSettings(db)).toEqual({ pocket: "Tax pot", potInSavings: true });
  });

  it("an empty value brings the default back", async () => {
    const db = await createDb(":memory:");
    await setBtwSettings(db, { pocket: "Pot" });
    await setBtwSettings(db, { pocket: "" });
    expect(await getBtwSettings(db)).toEqual(DEFAULTS);
  });

  it("refuses a word that is too long or has no letters or numbers", async () => {
    const db = await createDb(":memory:");
    await expect(setBtwSettings(db, { pocket: "x".repeat(61) })).rejects.toBeInstanceOf(BtwError);
    await expect(setBtwSettings(db, { pocket: "---" })).rejects.toBeInstanceOf(BtwError);
    expect(await getBtwSettings(db)).toEqual(DEFAULTS);
  });

  it("no longer reads the old single client and lag (they live in the client list since migration 0013)", async () => {
    const db = await createDb(":memory:");
    await db.insert(schema.userSettings).values({ btwClient: "Acme", btwPaymentLag: 2 });
    expect(await getBtwSettings(db)).toEqual(DEFAULTS);
    expect((await getBtwClients(db)).map((c) => [c.name, c.paymentLag])).toEqual([["Featurn", 0]]);
  });

  it("saves whether the BTW pot is part of the savings, and keeps the rest", async () => {
    const db = await createDb(":memory:");
    await setBtwSettings(db, { pocket: "Tax pot" });
    await setBtwSettings(db, { potInSavings: true });
    expect(await getBtwSettings(db)).toEqual({ pocket: "Tax pot", potInSavings: true });
    // Saving the other field leaves it alone.
    await setBtwSettings(db, { pocket: "Pot" });
    expect((await getBtwSettings(db)).potInSavings).toBe(true);
    await setBtwSettings(db, { potInSavings: false });
    expect((await getBtwSettings(db)).potInSavings).toBe(false);
  });

  it("refuses anything but true or false for the pot", async () => {
    const db = await createDb(":memory:");
    for (const bad of ["true", 1, 0, null, {}])
      await expect(setBtwSettings(db, { potInSavings: bad })).rejects.toBeInstanceOf(BtwError);
    expect(await getBtwSettings(db)).toEqual(DEFAULTS);
  });
});
