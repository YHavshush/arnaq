import { describe, expect, it } from "vitest";
import { createDb } from "@/db";
import { BtwError, getBtwSettings, setBtwSettings } from "./settings";

describe("btw settings", () => {
  it("starts with the defaults", async () => {
    const db = await createDb(":memory:");
    expect(await getBtwSettings(db)).toEqual({ client: "Featurn", pocket: "BTW" });
  });

  it("saves a client and a pocket word, trims them, and keeps what is left out", async () => {
    const db = await createDb(":memory:");
    await setBtwSettings(db, { client: "  Acme   BV ", pocket: "Tax pot" });
    expect(await getBtwSettings(db)).toEqual({ client: "Acme BV", pocket: "Tax pot" });
    await setBtwSettings(db, { client: "Globex" });
    expect(await getBtwSettings(db)).toEqual({ client: "Globex", pocket: "Tax pot" });
  });

  it("an empty value brings the default back", async () => {
    const db = await createDb(":memory:");
    await setBtwSettings(db, { client: "Acme", pocket: "Pot" });
    await setBtwSettings(db, { client: "  ", pocket: "" });
    expect(await getBtwSettings(db)).toEqual({ client: "Featurn", pocket: "BTW" });
  });

  it("refuses a name that is too long or has no letters or numbers", async () => {
    const db = await createDb(":memory:");
    await expect(setBtwSettings(db, { client: "x".repeat(61) })).rejects.toBeInstanceOf(BtwError);
    await expect(setBtwSettings(db, { pocket: "---" })).rejects.toBeInstanceOf(BtwError);
    expect(await getBtwSettings(db)).toEqual({ client: "Featurn", pocket: "BTW" });
  });
});
