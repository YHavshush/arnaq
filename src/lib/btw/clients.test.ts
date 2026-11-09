import { describe, expect, it } from "vitest";
import { createDb } from "@/db";
import { deleteAllMyData } from "@/lib/account";
import { seedDefaults } from "@/lib/categories/seed";
import {
  BtwClientNotFound,
  MAX_BTW_CLIENTS,
  addBtwClient,
  btwClientMatcher,
  btwClientOfItem,
  deleteBtwClient,
  getBtwClients,
  replaceBtwClients,
  updateBtwClient,
} from "./clients";
import { btwInside, btwOfIncome } from "./rate";
import { BtwError } from "./settings";

const rule = (name: string, paymentLag: 0 | 1 | 2 = 0, vatPercent: 0 | 21 = 21) => ({
  name,
  paymentLag,
  vatPercent,
});
const shape = (list: { name: string; paymentLag: number; vatPercent: number }[]) =>
  list.map(({ name, paymentLag, vatPercent }) => ({ name, paymentLag, vatPercent }));

describe("the BTW client list", () => {
  it("the tests start as the owner does, with one client (a fixture)", async () => {
    const db = await createDb(":memory:");
    expect(shape(await getBtwClients(db))).toEqual([rule("Featurn")]);
  });

  it("a new account starts with no clients: seeding the defaults adds none, whatever was there", async () => {
    const db = await createDb(":memory:");
    const [featurn] = await getBtwClients(db);
    await deleteBtwClient(db, featurn.id);
    await seedDefaults(db);
    await seedDefaults(db); // safe to repeat
    expect(await getBtwClients(db)).toEqual([]);
  });

  it("adds clients, trims the name, and lists them oldest first", async () => {
    const db = await createDb(":memory:");
    const acme = await addBtwClient(db, { name: "  Acme   Consulting ", paymentLag: 1 });
    expect(acme).toMatchObject({ name: "Acme Consulting", paymentLag: 1, vatPercent: 21 });
    await addBtwClient(db, { name: "Globex GmbH", paymentLag: 2, vatPercent: 0 });
    expect(shape(await getBtwClients(db))).toEqual([
      rule("Featurn"),
      rule("Acme Consulting", 1),
      rule("Globex GmbH", 2, 0),
    ]);
  });

  it("edits only what is given, and refuses an unknown id", async () => {
    const db = await createDb(":memory:");
    const [featurn] = await getBtwClients(db);
    expect(await updateBtwClient(db, featurn.id, { paymentLag: 1 })).toMatchObject({
      name: "Featurn",
      paymentLag: 1,
      vatPercent: 21,
    });
    expect(await updateBtwClient(db, featurn.id, { name: "Featurn BV", vatPercent: 0 })).toEqual({
      id: featurn.id,
      name: "Featurn BV",
      paymentLag: 1,
      vatPercent: 0,
    });
    await expect(updateBtwClient(db, featurn.id + 999, { paymentLag: 0 })).rejects.toBeInstanceOf(
      BtwClientNotFound,
    );
  });

  it("deletes a client; the last one can go too, and the list then stays empty", async () => {
    const db = await createDb(":memory:");
    const acme = await addBtwClient(db, { name: "Acme" });
    expect(await deleteBtwClient(db, acme.id)).toBe(true);
    expect(await deleteBtwClient(db, acme.id)).toBe(false);
    const [featurn] = await getBtwClients(db);
    expect(await deleteBtwClient(db, featurn.id)).toBe(true);
    expect(await getBtwClients(db)).toEqual([]);
  });

  it("refuses names that are empty, too long, without letters or numbers, or already in the list (any case)", async () => {
    const db = await createDb(":memory:");
    const bad: [unknown, string][] = [
      ["", "Give the client a name."],
      ["   ", "Give the client a name."],
      [undefined, "Give the client a name."],
      [5, "Give the client a name."],
      ["x".repeat(61), "The name is too long (max 60)."],
      ["---", "Use letters or numbers in the name."],
      ["featurn", "You already have a client with this name."],
      [" FEATURN ", "You already have a client with this name."],
    ];
    for (const [name, message] of bad)
      await expect(addBtwClient(db, { name })).rejects.toThrow(new BtwError(message));
    const acme = await addBtwClient(db, { name: "Acme" });
    await expect(updateBtwClient(db, acme.id, { name: "FEATURN" })).rejects.toThrow(
      "You already have a client with this name.",
    );
    // Its own name in another case is fine.
    expect((await updateBtwClient(db, acme.id, { name: "ACME" })).name).toBe("ACME");
    expect(shape(await getBtwClients(db))).toEqual([rule("Featurn"), rule("ACME")]);
  });

  it("refuses any lag but 0, 1 or 2 and any rate but 21 or 0", async () => {
    const db = await createDb(":memory:");
    for (const paymentLag of [-1, 3, 1.5, "1", null, Number.NaN])
      await expect(addBtwClient(db, { name: "Acme", paymentLag })).rejects.toThrow(
        "The payment lag must be 0, 1 or 2 months.",
      );
    for (const vatPercent of [9, 6, "21", null, 21.0001])
      await expect(addBtwClient(db, { name: "Acme", vatPercent })).rejects.toThrow(
        "The BTW rate must be 21% or 0%.",
      );
    expect(shape(await getBtwClients(db))).toEqual([rule("Featurn")]);
  });

  it(`holds at most ${MAX_BTW_CLIENTS} clients`, async () => {
    const db = await createDb(":memory:");
    for (let i = 1; i < MAX_BTW_CLIENTS; i++) await addBtwClient(db, { name: `Client ${i}` });
    await expect(addBtwClient(db, { name: "One too many" })).rejects.toThrow(
      `You can have up to ${MAX_BTW_CLIENTS} clients.`,
    );
    expect(await getBtwClients(db)).toHaveLength(MAX_BTW_CLIENTS);
  });

  it("erasing everything leaves no clients: a person starts again from an empty list", async () => {
    const db = await createDb(":memory:");
    await addBtwClient(db, { name: "Acme", paymentLag: 1 });
    await deleteAllMyData(db);
    expect(await getBtwClients(db)).toEqual([]);
  });

  it("replaces the whole list (restore), skipping damaged and duplicate entries, never more than the limit", async () => {
    const db = await createDb(":memory:");
    const kept = await replaceBtwClients(db, [
      { name: "Acme", paymentLag: 1, vatPercent: 21 },
      { name: "acme", paymentLag: 0, vatPercent: 21 }, // a duplicate: the first one stays
      { name: "Globex", paymentLag: 2, vatPercent: 0 },
      { name: "", paymentLag: 0, vatPercent: 21 },
      { name: "Initech", paymentLag: 7, vatPercent: 21 },
      { name: "Hooli", paymentLag: 0, vatPercent: 9 },
      { name: 12, paymentLag: 0, vatPercent: 21 },
      null,
      "Umbrella",
      { name: "Wayne", paymentLag: 0 }, // a rate left out is not guessed: skipped
    ]);
    expect(kept).toBe(2);
    expect(shape(await getBtwClients(db))).toEqual([rule("Acme", 1), rule("Globex", 2, 0)]);
    await replaceBtwClients(
      db,
      Array.from({ length: 30 }, (_, i) => rule(`Client ${i}`)),
    );
    expect(await getBtwClients(db)).toHaveLength(MAX_BTW_CLIENTS);
  });
});

describe("btwClientMatcher: which client a payment is from (the one place that decides it)", () => {
  const clients = [
    { id: 1, ...rule("Featurn") },
    { id: 2, ...rule("Acme") },
    { id: 3, ...rule("Acme Consulting", 1, 0) },
    { id: 4, ...rule("Consulting") },
  ];
  const match = btwClientMatcher(clients);
  const pay = (counterparty: string | null, description: string | null = null) =>
    match({ counterparty, description })?.id ?? null;

  it("matches the name as whole words in the counterparty or the description, any case or accent", () => {
    expect(pay("FEATURN B.V.")).toBe(1);
    expect(pay("Bank", "invoice 12 featurn")).toBe(1);
    expect(pay("Featurnix")).toBeNull();
    expect(pay("Lidl")).toBeNull();
    expect(pay(null, null)).toBeNull();
  });

  it("when two names match, the longer name wins", () => {
    expect(pay("Acme Consulting BV")).toBe(3);
    // "Acme" and "Consulting" both match, but not "Acme Consulting" (not next to each other): the longer is Consulting.
    expect(pay("Acme BV", "Consulting")).toBe(4);
    expect(pay("Acme BV")).toBe(2);
    expect(pay("Consulting Partners")).toBe(4);
  });

  it("with two names of the same length, the oldest client (lowest id) wins", () => {
    const tie = btwClientMatcher([
      { id: 9, ...rule("Bravo") },
      { id: 5, ...rule("Alpha") },
    ]);
    expect(tie({ counterparty: "Alpha Bravo", description: null })?.id).toBe(5);
  });

  it("a fixed income item is judged by its counterparty, or by its name without one", () => {
    expect(btwClientOfItem(match, { matchCounterparty: "FEATURN B.V.", name: "x" })?.id).toBe(1);
    expect(btwClientOfItem(match, { matchCounterparty: "Featurnix", name: "Featurn" })).toBeNull();
    expect(btwClientOfItem(match, { matchCounterparty: null, name: "Featurn invoice" })?.id).toBe(
      1,
    );
    expect(btwClientOfItem(match, { matchCounterparty: "Werkgever", name: "Salary" })).toBeNull();
  });

  it("matches nothing without clients", () => {
    expect(btwClientMatcher([])({ counterparty: "Featurn", description: null })).toBeNull();
  });
});

describe("the BTW inside income, per rate", () => {
  it("21%: 21 parts of every 121, in whole cents (as before)", () => {
    expect(btwInside(121000)).toBe(21000);
    expect(btwInside(100000)).toBe(17355);
    expect(btwInside(100000, 21)).toBe(17355);
  });

  it("0%: nothing", () => {
    expect(btwInside(100000, 0)).toBe(0);
  });

  it("adds up per rate and rounds once per rate, so one 21% client gives exactly the old number", () => {
    // 3 x 333.33 at 21%: rounding each would give 3 x 5785 = 17355, once gives round(99999 x 21 / 121) = 17355.
    expect(
      btwOfIncome([
        { amount: 33333, vatPercent: 21 },
        { amount: 33333, vatPercent: 21 },
        { amount: 33333, vatPercent: 21 },
      ]),
    ).toBe(btwInside(99999));
    expect(
      btwOfIncome([
        { amount: 100000, vatPercent: 21 },
        { amount: 500000, vatPercent: 0 },
        { amount: 21000, vatPercent: 21 },
      ]),
    ).toBe(btwInside(121000));
    expect(btwOfIncome([])).toBe(0);
  });
});
