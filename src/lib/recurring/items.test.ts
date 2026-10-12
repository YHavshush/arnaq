import { describe, expect, it } from "vitest";
import { schema } from "@/db";
import {
  createRecurringItem,
  deleteRecurringItem,
  getRecurringItem,
  listRecurringItems,
  RecurringError,
  updateRecurringItem,
  type RecurringItemInput,
} from "./items";
import { matchOccurrences } from "./matching";
import { generateOccurrences } from "./occurrences";
import { setup } from "./test-utils";

const spotify = (extra: Partial<RecurringItemInput> = {}): RecurringItemInput => ({
  name: "Spotify",
  type: "expense",
  matchCounterparty: "Spotify",
  expectedAmount: 999,
  tolerance: 0,
  dayOfMonth: 10,
  startDate: "2026-01-01",
  ...extra,
});
const TODAY = "2026-03-20";

describe("createRecurringItem", () => {
  it("normalises input and fills in defaults", async () => {
    const { db } = await setup();
    const item = await createRecurringItem(
      db,
      {
        name: "  Huur ",
        type: "expense",
        matchCounterparty: "  ",
        matchIban: "nl00 bank 0000 0000 11",
        expectedAmount: 65000,
        dayOfMonth: 1,
        startDate: "2026-01-01",
      },
      { today: TODAY },
    );
    expect(item).toMatchObject({
      name: "Huur",
      matchCounterparty: null,
      matchIban: "NL00BANK0000000011",
      tolerance: 0,
      frequency: "monthly",
      categoryId: null,
      endDate: null,
      active: true,
    });
  });

  it.each<[string, Partial<RecurringItemInput>, RegExp]>([
    ["empty name", { name: " " }, /naam/],
    ["bad type", { type: "transfer" as never }, /uitgave of inkomen/],
    [
      "nothing to match on",
      { matchCounterparty: null, matchIban: "  " },
      /naam zoals op je afschrift/,
    ],
    ["zero amount", { expectedAmount: 0 }, /groter dan nul/],
    ["negative amount", { expectedAmount: -999 }, /groter dan nul/],
    ["float amount", { expectedAmount: 9.99 }, /groter dan nul/],
    ["negative tolerance", { tolerance: -1 }, /marge/],
    ["float tolerance", { tolerance: 0.5 }, /marge/],
    ["day 0", { dayOfMonth: 0 }, /dag van de maand/],
    ["day 32", { dayOfMonth: 32 }, /dag van de maand/],
    ["bad frequency", { frequency: "weekly" as never }, /per maand, per kwartaal of per jaar/],
    ["bad start", { startDate: "2026-02-30" }, /begindatum/],
    ["bad end", { endDate: "2026-13-01" }, /einddatum/],
    ["end before start", { endDate: "2025-12-31" }, /niet voor de begindatum/],
    ["unknown category", { categoryId: 9999 }, /bestaat niet/],
  ])("rejects %s", async (_, extra, message) => {
    const { db } = await setup();
    await expect(createRecurringItem(db, spotify(extra), { today: TODAY })).rejects.toThrow(
      message,
    );
    await expect(createRecurringItem(db, spotify(extra), { today: TODAY })).rejects.toThrow(
      RecurringError,
    );
    expect(await listRecurringItems(db)).toHaveLength(0);
  });

  it("rejects a category of the other type and an invalid today", async () => {
    const { db, cat } = await setup();
    await expect(
      createRecurringItem(db, spotify({ categoryId: await cat("Zorgtoeslag") }), {
        today: TODAY,
      }),
    ).rejects.toThrow(/hoort niet bij een uitgave/);
    await expect(
      createRecurringItem(db, spotify({ categoryId: await cat("Interne overboeking") }), {
        today: TODAY,
      }),
    ).rejects.toThrow(RecurringError);
    await expect(createRecurringItem(db, spotify(), { today: "2026-03" })).rejects.toThrow(
      RecurringError,
    );
  });

  it("accepts an end date equal to the start date", async () => {
    const { db } = await setup();
    const item = await createRecurringItem(
      db,
      spotify({ startDate: "2026-01-10", endDate: "2026-01-10" }),
      { today: TODAY },
    );
    expect(item.endDate).toBe("2026-01-10");
  });

  it("plans through this month and matches existing history straight away", async () => {
    const { db, tx, cover, occurrences, getTx, cat } = await setup();
    const jan = await tx("2026-01-10", -999, { counterparty: "Spotify AB" });
    const feb = await tx("2026-02-09", -999, { counterparty: "Spotify AB" });
    await cover("2026-01", "2026-02", "2026-03");
    const item = await createRecurringItem(db, spotify({ categoryId: await cat("Abonnementen") }), {
      today: TODAY,
    });
    expect((await occurrences(item.id)).map((o) => [o.month, o.status, o.transactionId])).toEqual([
      ["2026-01", "matched", jan.id],
      ["2026-02", "matched", feb.id],
      ["2026-03", "missed", null], // March was uploaded, window ended on the 15th
    ]);
    expect((await getTx(jan.id)).categoryId).toBe(await cat("Abonnementen"));
  });

  it("plans as far as the newest data when that is past today", async () => {
    const { db, tx, occurrences } = await setup();
    await tx("2026-05-02", -100, { counterparty: "Someone" });
    const item = await createRecurringItem(db, spotify(), { today: TODAY });
    expect((await occurrences(item.id)).map((o) => o.month).at(-1)).toBe("2026-05");
  });
});

describe("list and get", () => {
  it("lists active items first, then by type and name", async () => {
    const { db } = await setup();
    await createRecurringItem(db, spotify({ name: "Netflix" }), { today: TODAY });
    await createRecurringItem(db, spotify({ name: "Abo", active: false }), { today: TODAY });
    await createRecurringItem(
      db,
      spotify({ name: "Salaris", type: "income", matchCounterparty: "Werkgever" }),
      { today: TODAY },
    );
    await createRecurringItem(db, spotify({ name: "Huur" }), { today: TODAY });
    expect((await listRecurringItems(db)).map((i) => i.name)).toEqual([
      "Huur",
      "Netflix",
      "Salaris",
      "Abo",
    ]);
    const [first] = await listRecurringItems(db);
    expect((await getRecurringItem(db, first.id))?.name).toBe("Huur");
    expect(await getRecurringItem(db, 999)).toBeUndefined();
  });
});

describe("updateRecurringItem", () => {
  /** Spotify from January; Jan matched, Feb missed, Mar (current) and Apr (data) expected. */
  async function history() {
    const s = await setup();
    const jan = await s.tx("2026-01-10", -999, { counterparty: "Spotify" });
    await s.tx("2026-04-01", -100, { counterparty: "Other" }); // data reaches into April
    await s.cover("2026-01", "2026-02", "2026-03");
    const item = await createRecurringItem(s.db, spotify(), { today: "2026-03-12" });
    expect((await s.occurrences(item.id)).map((o) => o.status)).toEqual([
      "matched",
      "missed",
      "expected",
      "expected",
    ]);
    return { ...s, item, jan };
  }

  it("re-plans only expected occurrences from this month on", async () => {
    const { db, item, occurrences, jan } = await history();
    const updated = await updateRecurringItem(
      db,
      item.id,
      { expectedAmount: 1199, dayOfMonth: 31, tolerance: 50 },
      { today: "2026-03-12" },
    );
    expect(updated).toMatchObject({ expectedAmount: 1199, dayOfMonth: 31, tolerance: 50 });
    expect(
      (await occurrences(item.id)).map((o) => [
        o.month,
        o.status,
        o.expectedDate,
        o.expectedAmount,
        o.transactionId,
      ]),
    ).toEqual([
      ["2026-01", "matched", "2026-01-10", 999, jan.id],
      ["2026-02", "missed", "2026-02-10", 999, null],
      ["2026-03", "expected", "2026-03-31", 1199, null],
      ["2026-04", "expected", "2026-04-30", 1199, null],
    ]);
  });

  it("keeps the old plan for unresolved occurrences before this month", async () => {
    const s = await setup();
    const item = await createRecurringItem(s.db, spotify(), { today: "2026-02-01" });
    await updateRecurringItem(s.db, item.id, { expectedAmount: 1199 }, { today: "2026-03-01" });
    expect((await s.occurrences(item.id)).map((o) => [o.month, o.expectedAmount])).toEqual([
      ["2026-01", 999],
      ["2026-02", 999],
      ["2026-03", 1199],
    ]);
  });

  it("an earlier end date drops unmatched occurrences after it but keeps matched ones", async () => {
    const { db, item, occurrences } = await history();
    await updateRecurringItem(db, item.id, { endDate: "2026-01-31" }, { today: "2026-03-12" });
    expect((await occurrences(item.id)).map((o) => [o.month, o.status])).toEqual([
      ["2026-01", "matched"],
    ]);
  });

  it("a later start date drops the unmatched occurrences before it", async () => {
    const s = await setup();
    await s.cover("2026-01", "2026-02");
    const item = await createRecurringItem(s.db, spotify(), { today: "2026-03-01" });
    expect((await s.occ(item.id, "2026-01")).status).toBe("missed");
    await updateRecurringItem(s.db, item.id, { startDate: "2026-03-01" }, { today: "2026-03-01" });
    expect((await s.occurrences(item.id)).map((o) => o.month)).toEqual(["2026-03"]);
  });

  it("switching to quarterly drops the off-schedule unmatched months", async () => {
    const { db, item, occurrences } = await history();
    await updateRecurringItem(db, item.id, { frequency: "quarterly" }, { today: "2026-03-12" });
    expect((await occurrences(item.id)).map((o) => [o.month, o.status])).toEqual([
      ["2026-01", "matched"],
      ["2026-04", "expected"],
    ]);
  });

  it("fixing the counterparty rescues missed history", async () => {
    const s = await setup();
    const t = await s.tx("2026-01-10", -999, { counterparty: "SPTFY Stockholm" });
    await s.cover("2026-01");
    const item = await createRecurringItem(s.db, spotify({ endDate: "2026-01-31" }), {
      today: "2026-03-01",
    });
    expect((await s.occ(item.id, "2026-01")).status).toBe("missed");
    await updateRecurringItem(
      s.db,
      item.id,
      { matchCounterparty: "sptfy" },
      { today: "2026-03-01" },
    );
    expect(await s.occ(item.id, "2026-01")).toMatchObject({
      status: "matched",
      transactionId: t.id,
    });
  });

  it("deactivating keeps matched history and removes the rest; reactivating re-plans", async () => {
    const { db, item, occurrences, tx } = await history();
    await updateRecurringItem(db, item.id, { active: false }, { today: "2026-03-12" });
    expect((await occurrences(item.id)).map((o) => o.status)).toEqual(["matched"]);
    // Nothing is generated or matched for an inactive item.
    await tx("2026-03-10", -999, { counterparty: "Spotify" });
    await generateOccurrences(db, { throughMonth: "2026-06" });
    expect((await matchOccurrences(db)).matched).toBe(0);
    expect(await occurrences(item.id)).toHaveLength(1);

    await updateRecurringItem(db, item.id, { active: true }, { today: "2026-03-12" });
    expect((await occurrences(item.id)).map((o) => [o.month, o.status])).toEqual([
      ["2026-01", "matched"],
      ["2026-02", "missed"],
      ["2026-03", "matched"],
      ["2026-04", "expected"],
    ]);
  });

  it("ignores undefined fields, validates the result and needs an existing item", async () => {
    const { db, item } = await history();
    const updated = await updateRecurringItem(
      db,
      item.id,
      { name: undefined, tolerance: 10 },
      { today: "2026-03-12" },
    );
    expect(updated).toMatchObject({ name: "Spotify", tolerance: 10 });
    await expect(
      updateRecurringItem(db, item.id, { endDate: "2025-01-01" }, { today: "2026-03-12" }),
    ).rejects.toThrow(/niet voor de begindatum/);
    expect((await getRecurringItem(db, item.id))?.endDate).toBeNull();
    await expect(
      updateRecurringItem(db, 999, { tolerance: 1 }, { today: "2026-03-12" }),
    ).rejects.toThrow(/bestaat niet/);
  });
});

describe("deleteRecurringItem", () => {
  it("unlinks transactions, removes occurrences and the item", async () => {
    const { db, item, jan, getTx, cat } = await (async () => {
      const s = await setup();
      const jan = await s.tx("2026-01-10", -999, { counterparty: "Spotify" });
      const item = await createRecurringItem(
        s.db,
        spotify({ categoryId: await s.cat("Abonnementen") }),
        {
          today: "2026-02-01",
        },
      );
      return { ...s, item, jan };
    })();
    expect((await getTx(jan.id)).matchedOccurrenceId).not.toBeNull();
    expect(await deleteRecurringItem(db, item.id)).toBe(true);
    expect(await getRecurringItem(db, item.id)).toBeUndefined();
    expect(await db.select().from(schema.recurringOccurrences)).toHaveLength(0);
    // The payment is ordinary spending again but keeps its category.
    expect(await getTx(jan.id)).toMatchObject({
      matchedOccurrenceId: null,
      categoryId: await cat("Abonnementen"),
    });
    expect(await deleteRecurringItem(db, item.id)).toBe(false);

    // And it can be matched by a new item.
    const again = await createRecurringItem(db, spotify(), { today: "2026-02-01" });
    expect((await getTx(jan.id)).matchedOccurrenceId).not.toBeNull();
    expect(again.id).not.toBe(item.id);
  });
});
