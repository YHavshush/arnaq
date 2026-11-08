import { describe, expect, it } from "vitest";
import { createDb } from "@/db";
import { BtwError, getBtwSettings, setBtwSettings } from "./settings";

const DEFAULTS = { client: "Featurn", pocket: "BTW", paymentLag: 0 };

describe("btw settings", () => {
  it("starts with the defaults", async () => {
    const db = await createDb(":memory:");
    expect(await getBtwSettings(db)).toEqual(DEFAULTS);
  });

  it("saves a client and a pocket word, trims them, and keeps what is left out", async () => {
    const db = await createDb(":memory:");
    await setBtwSettings(db, { client: "  Acme   BV ", pocket: "Tax pot" });
    expect(await getBtwSettings(db)).toEqual({ ...DEFAULTS, client: "Acme BV", pocket: "Tax pot" });
    await setBtwSettings(db, { client: "Globex" });
    expect(await getBtwSettings(db)).toEqual({ ...DEFAULTS, client: "Globex", pocket: "Tax pot" });
  });

  it("an empty value brings the default back", async () => {
    const db = await createDb(":memory:");
    await setBtwSettings(db, { client: "Acme", pocket: "Pot" });
    await setBtwSettings(db, { client: "  ", pocket: "" });
    expect(await getBtwSettings(db)).toEqual(DEFAULTS);
  });

  it("refuses a name that is too long or has no letters or numbers", async () => {
    const db = await createDb(":memory:");
    await expect(setBtwSettings(db, { client: "x".repeat(61) })).rejects.toBeInstanceOf(BtwError);
    await expect(setBtwSettings(db, { pocket: "---" })).rejects.toBeInstanceOf(BtwError);
    expect(await getBtwSettings(db)).toEqual(DEFAULTS);
  });

  it("saves the payment lag (0, 1 or 2 months) and keeps the names", async () => {
    const db = await createDb(":memory:");
    await setBtwSettings(db, { client: "Acme" });
    await setBtwSettings(db, { paymentLag: 1 });
    expect(await getBtwSettings(db)).toEqual({ ...DEFAULTS, client: "Acme", paymentLag: 1 });
    await setBtwSettings(db, { paymentLag: 2 });
    expect((await getBtwSettings(db)).paymentLag).toBe(2);
    // Saving the names leaves the lag alone.
    await setBtwSettings(db, { client: "Globex" });
    expect((await getBtwSettings(db)).paymentLag).toBe(2);
    await setBtwSettings(db, { paymentLag: 0 });
    expect((await getBtwSettings(db)).paymentLag).toBe(0);
  });

  it("refuses any other lag", async () => {
    const db = await createDb(":memory:");
    for (const bad of [-1, 3, 1.5, Number.NaN])
      await expect(setBtwSettings(db, { paymentLag: bad })).rejects.toBeInstanceOf(BtwError);
    expect(await getBtwSettings(db)).toEqual(DEFAULTS);
  });
});
