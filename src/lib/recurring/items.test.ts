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
  it("normalises input and fills in defaults", () => {
    const { db } = setup();
    const item = createRecurringItem(
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
    ["empty name", { name: " " }, /Name/],
    ["bad type", { type: "transfer" as never }, /Type/],
    [
      "nothing to match on",
      { matchCounterparty: null, matchIban: "  " },
      /counterparty name or an IBAN/,
    ],
    ["zero amount", { expectedAmount: 0 }, /positive integer/],
    ["negative amount", { expectedAmount: -999 }, /positive integer/],
    ["float amount", { expectedAmount: 9.99 }, /positive integer/],
    ["negative tolerance", { tolerance: -1 }, /Tolerance/],
    ["float tolerance", { tolerance: 0.5 }, /Tolerance/],
    ["day 0", { dayOfMonth: 0 }, /Day of month/],
    ["day 32", { dayOfMonth: 32 }, /Day of month/],
    ["bad frequency", { frequency: "weekly" as never }, /Frequency/],
    ["bad start", { startDate: "2026-02-30" }, /start date/],
    ["bad end", { endDate: "2026-13-01" }, /end date/],
    ["end before start", { endDate: "2025-12-31" }, /before the start/],
    ["unknown category", { categoryId: 9999 }, /does not exist/],
  ])("rejects %s", (_, extra, message) => {
    const { db } = setup();
    expect(() => createRecurringItem(db, spotify(extra), { today: TODAY })).toThrow(message);
    expect(() => createRecurringItem(db, spotify(extra), { today: TODAY })).toThrow(RecurringError);
    expect(listRecurringItems(db)).toHaveLength(0);
  });

  it("rejects a category of the other type and an invalid today", () => {
    const { db, cat } = setup();
    expect(() =>
      createRecurringItem(db, spotify({ categoryId: cat("Zorgtoeslag") }), { today: TODAY }),
    ).toThrow(/not an expense category/);
    expect(() =>
      createRecurringItem(db, spotify({ categoryId: cat("Interne overboeking") }), {
        today: TODAY,
      }),
    ).toThrow(RecurringError);
    expect(() => createRecurringItem(db, spotify(), { today: "2026-03" })).toThrow(RecurringError);
  });

  it("accepts an end date equal to the start date", () => {
    const { db } = setup();
    const item = createRecurringItem(
      db,
      spotify({ startDate: "2026-01-10", endDate: "2026-01-10" }),
      { today: TODAY },
    );
    expect(item.endDate).toBe("2026-01-10");
  });

  it("plans through this month and matches existing history straight away", () => {
    const { db, tx, cover, occurrences, getTx, cat } = setup();
    const jan = tx("2026-01-10", -999, { counterparty: "Spotify AB" });
    const feb = tx("2026-02-09", -999, { counterparty: "Spotify AB" });
    cover("2026-01", "2026-02", "2026-03");
    const item = createRecurringItem(db, spotify({ categoryId: cat("Abonnementen") }), {
      today: TODAY,
    });
    expect(occurrences(item.id).map((o) => [o.month, o.status, o.transactionId])).toEqual([
      ["2026-01", "matched", jan.id],
      ["2026-02", "matched", feb.id],
      ["2026-03", "missed", null], // March was uploaded, window ended on the 15th
    ]);
    expect(getTx(jan.id).categoryId).toBe(cat("Abonnementen"));
  });

  it("plans as far as the newest data when that is past today", () => {
    const { db, tx, occurrences } = setup();
    tx("2026-05-02", -100, { counterparty: "Someone" });
    const item = createRecurringItem(db, spotify(), { today: TODAY });
    expect(
      occurrences(item.id)
        .map((o) => o.month)
        .at(-1),
    ).toBe("2026-05");
  });
});

describe("list and get", () => {
  it("lists active items first, then by type and name", () => {
    const { db } = setup();
    createRecurringItem(db, spotify({ name: "Netflix" }), { today: TODAY });
    createRecurringItem(db, spotify({ name: "Abo", active: false }), { today: TODAY });
    createRecurringItem(
      db,
      spotify({ name: "Salaris", type: "income", matchCounterparty: "Werkgever" }),
      { today: TODAY },
    );
    createRecurringItem(db, spotify({ name: "Huur" }), { today: TODAY });
    expect(listRecurringItems(db).map((i) => i.name)).toEqual([
      "Huur",
      "Netflix",
      "Salaris",
      "Abo",
    ]);
    const [first] = listRecurringItems(db);
    expect(getRecurringItem(db, first.id)?.name).toBe("Huur");
    expect(getRecurringItem(db, 999)).toBeUndefined();
  });
});

describe("updateRecurringItem", () => {
  /** Spotify from January; Jan matched, Feb missed, Mar (current) and Apr (data) expected. */
  function history() {
    const s = setup();
    const jan = s.tx("2026-01-10", -999, { counterparty: "Spotify" });
    s.tx("2026-04-01", -100, { counterparty: "Other" }); // data reaches into April
    s.cover("2026-01", "2026-02", "2026-03");
    const item = createRecurringItem(s.db, spotify(), { today: "2026-03-12" });
    expect(s.occurrences(item.id).map((o) => o.status)).toEqual([
      "matched",
      "missed",
      "expected",
      "expected",
    ]);
    return { ...s, item, jan };
  }

  it("re-plans only expected occurrences from this month on", () => {
    const { db, item, occurrences, jan } = history();
    const updated = updateRecurringItem(
      db,
      item.id,
      { expectedAmount: 1199, dayOfMonth: 31, tolerance: 50 },
      { today: "2026-03-12" },
    );
    expect(updated).toMatchObject({ expectedAmount: 1199, dayOfMonth: 31, tolerance: 50 });
    expect(
      occurrences(item.id).map((o) => [
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

  it("keeps the old plan for unresolved occurrences before this month", () => {
    const s = setup();
    const item = createRecurringItem(s.db, spotify(), { today: "2026-02-01" });
    updateRecurringItem(s.db, item.id, { expectedAmount: 1199 }, { today: "2026-03-01" });
    expect(s.occurrences(item.id).map((o) => [o.month, o.expectedAmount])).toEqual([
      ["2026-01", 999],
      ["2026-02", 999],
      ["2026-03", 1199],
    ]);
  });

  it("an earlier end date drops unmatched occurrences after it but keeps matched ones", () => {
    const { db, item, occurrences } = history();
    updateRecurringItem(db, item.id, { endDate: "2026-01-31" }, { today: "2026-03-12" });
    expect(occurrences(item.id).map((o) => [o.month, o.status])).toEqual([["2026-01", "matched"]]);
  });

  it("a later start date drops the unmatched occurrences before it", () => {
    const s = setup();
    s.cover("2026-01", "2026-02");
    const item = createRecurringItem(s.db, spotify(), { today: "2026-03-01" });
    expect(s.occ(item.id, "2026-01").status).toBe("missed");
    updateRecurringItem(s.db, item.id, { startDate: "2026-03-01" }, { today: "2026-03-01" });
    expect(s.occurrences(item.id).map((o) => o.month)).toEqual(["2026-03"]);
  });

  it("switching to quarterly drops the off-schedule unmatched months", () => {
    const { db, item, occurrences } = history();
    updateRecurringItem(db, item.id, { frequency: "quarterly" }, { today: "2026-03-12" });
    expect(occurrences(item.id).map((o) => [o.month, o.status])).toEqual([
      ["2026-01", "matched"],
      ["2026-04", "expected"],
    ]);
  });

  it("fixing the counterparty rescues missed history", () => {
    const s = setup();
    const t = s.tx("2026-01-10", -999, { counterparty: "SPTFY Stockholm" });
    s.cover("2026-01");
    const item = createRecurringItem(s.db, spotify({ endDate: "2026-01-31" }), {
      today: "2026-03-01",
    });
    expect(s.occ(item.id, "2026-01").status).toBe("missed");
    updateRecurringItem(s.db, item.id, { matchCounterparty: "sptfy" }, { today: "2026-03-01" });
    expect(s.occ(item.id, "2026-01")).toMatchObject({ status: "matched", transactionId: t.id });
  });

  it("deactivating keeps matched history and removes the rest; reactivating re-plans", () => {
    const { db, item, occurrences, tx } = history();
    updateRecurringItem(db, item.id, { active: false }, { today: "2026-03-12" });
    expect(occurrences(item.id).map((o) => o.status)).toEqual(["matched"]);
    // Nothing is generated or matched for an inactive item.
    tx("2026-03-10", -999, { counterparty: "Spotify" });
    generateOccurrences(db, { throughMonth: "2026-06" });
    expect(matchOccurrences(db).matched).toBe(0);
    expect(occurrences(item.id)).toHaveLength(1);

    updateRecurringItem(db, item.id, { active: true }, { today: "2026-03-12" });
    expect(occurrences(item.id).map((o) => [o.month, o.status])).toEqual([
      ["2026-01", "matched"],
      ["2026-02", "missed"],
      ["2026-03", "matched"],
      ["2026-04", "expected"],
    ]);
  });

  it("ignores undefined fields, validates the result and needs an existing item", () => {
    const { db, item } = history();
    const updated = updateRecurringItem(
      db,
      item.id,
      { name: undefined, tolerance: 10 },
      { today: "2026-03-12" },
    );
    expect(updated).toMatchObject({ name: "Spotify", tolerance: 10 });
    expect(() =>
      updateRecurringItem(db, item.id, { endDate: "2025-01-01" }, { today: "2026-03-12" }),
    ).toThrow(/before the start/);
    expect(getRecurringItem(db, item.id)?.endDate).toBeNull();
    expect(() => updateRecurringItem(db, 999, { tolerance: 1 }, { today: "2026-03-12" })).toThrow(
      /does not exist/,
    );
  });
});

describe("deleteRecurringItem", () => {
  it("unlinks transactions, removes occurrences and the item", () => {
    const { db, item, jan, getTx, cat } = (() => {
      const s = setup();
      const jan = s.tx("2026-01-10", -999, { counterparty: "Spotify" });
      const item = createRecurringItem(s.db, spotify({ categoryId: s.cat("Abonnementen") }), {
        today: "2026-02-01",
      });
      return { ...s, item, jan };
    })();
    expect(getTx(jan.id).matchedOccurrenceId).not.toBeNull();
    expect(deleteRecurringItem(db, item.id)).toBe(true);
    expect(getRecurringItem(db, item.id)).toBeUndefined();
    expect(db.select().from(schema.recurringOccurrences).all()).toHaveLength(0);
    // The payment is ordinary spending again but keeps its category.
    expect(getTx(jan.id)).toMatchObject({
      matchedOccurrenceId: null,
      categoryId: cat("Abonnementen"),
    });
    expect(deleteRecurringItem(db, item.id)).toBe(false);

    // And it can be matched by a new item.
    const again = createRecurringItem(db, spotify(), { today: "2026-02-01" });
    expect(getTx(jan.id).matchedOccurrenceId).not.toBeNull();
    expect(again.id).not.toBe(item.id);
  });
});
