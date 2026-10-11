import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { schema } from "@/db";
import { RecurringError } from "./errors";
import { matchOccurrences } from "./matching";
import {
  generateOccurrences,
  getMissedOccurrences,
  getOccurrences,
  isScheduled,
  markMissed,
  planOccurrences,
  type Schedule,
} from "./occurrences";
import { setup, snapshot } from "./test-utils";

const schedule = (s: Partial<Schedule>): Schedule => ({
  dayOfMonth: 10,
  frequency: "monthly",
  startDate: "2026-01-01",
  endDate: null,
  ...s,
});
const dates = (s: Partial<Schedule>, throughMonth: string, fromMonth?: string) =>
  planOccurrences(schedule(s), { throughMonth, fromMonth }).map((p) => p.expectedDate);

describe("planOccurrences", () => {
  it("clamps day 31 to short months", () => {
    expect(dates({ dayOfMonth: 31 }, "2026-04")).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
    ]);
  });

  it("uses 29 February in leap years", () => {
    expect(dates({ dayOfMonth: 30, startDate: "2028-01-01" }, "2028-03")).toEqual([
      "2028-01-30",
      "2028-02-29",
      "2028-03-30",
    ]);
    expect(dates({ dayOfMonth: 29, startDate: "2027-02-01" }, "2027-02")).toEqual(["2027-02-28"]);
  });

  it("anchors quarterly items at the start month, across years", () => {
    expect(
      dates({ frequency: "quarterly", startDate: "2026-02-15", dayOfMonth: 15 }, "2027-03"),
    ).toEqual(["2026-02-15", "2026-05-15", "2026-08-15", "2026-11-15", "2027-02-15"]);
  });

  it("anchors yearly items at the start month", () => {
    expect(
      dates({ frequency: "yearly", startDate: "2025-03-01", dayOfMonth: 1 }, "2027-12"),
    ).toEqual(["2025-03-01", "2026-03-01", "2027-03-01"]);
    // A yearly item due on 29 February falls on the 28th in other years.
    expect(
      dates({ frequency: "yearly", startDate: "2028-02-01", dayOfMonth: 29 }, "2030-12"),
    ).toEqual(["2028-02-29", "2029-02-28", "2030-02-28"]);
  });

  it("respects the start date to the day", () => {
    // Day 10 is before the 15 January start, so the first one is in February.
    expect(dates({ startDate: "2026-01-15", dayOfMonth: 10 }, "2026-03")).toEqual([
      "2026-02-10",
      "2026-03-10",
    ]);
    expect(dates({ startDate: "2026-01-15", dayOfMonth: 20 }, "2026-02")).toEqual([
      "2026-01-20",
      "2026-02-20",
    ]);
    // A quarterly item whose first month is skipped keeps its anchor.
    expect(
      dates({ frequency: "quarterly", startDate: "2026-01-15", dayOfMonth: 10 }, "2026-12"),
    ).toEqual(["2026-04-10", "2026-07-10", "2026-10-10"]);
  });

  it("respects the end date to the day, inclusive", () => {
    expect(dates({ endDate: "2026-04-15", dayOfMonth: 20 }, "2026-12")).toEqual([
      "2026-01-20",
      "2026-02-20",
      "2026-03-20",
    ]);
    expect(dates({ endDate: "2026-03-10", dayOfMonth: 10 }, "2026-12")).toEqual([
      "2026-01-10",
      "2026-02-10",
      "2026-03-10",
    ]);
  });

  it("returns nothing before the start month and can start later", () => {
    expect(dates({ startDate: "2026-05-01" }, "2026-04")).toEqual([]);
    expect(dates({}, "2026-04", "2026-03")).toEqual(["2026-03-10", "2026-04-10"]);
  });

  it("isScheduled agrees with the plan", () => {
    const q = schedule({ frequency: "quarterly" });
    expect(isScheduled(q, "2026-04")).toBe(true);
    expect(isScheduled(q, "2026-05")).toBe(false);
    expect(isScheduled(q, "2025-10")).toBe(false);
  });
});

describe("generateOccurrences", () => {
  it("creates occurrences for active items only, idempotently", () => {
    const { db, addItem, occurrences } = setup();
    const spotify = addItem();
    const old = addItem({ name: "Old", active: false });
    expect(generateOccurrences(db, { throughMonth: "2026-03" })).toBe(3);
    expect(generateOccurrences(db, { throughMonth: "2026-03" })).toBe(0);
    expect(occurrences(spotify.id).map((o) => [o.month, o.expectedDate, o.status])).toEqual([
      ["2026-01", "2026-01-10", "expected"],
      ["2026-02", "2026-02-10", "expected"],
      ["2026-03", "2026-03-10", "expected"],
    ]);
    expect(occurrences(spotify.id).every((o) => o.expectedAmount === 999)).toBe(true);
    expect(occurrences(old.id)).toHaveLength(0);

    // Going further only adds the new months; a shorter horizon removes nothing.
    expect(generateOccurrences(db, { throughMonth: "2026-05" })).toBe(2);
    expect(generateOccurrences(db, { throughMonth: "2026-02" })).toBe(0);
    expect(occurrences(spotify.id)).toHaveLength(5);
  });

  it("never touches existing occurrences", () => {
    const { db, addItem, occurrences } = setup();
    const item = addItem();
    generateOccurrences(db, { throughMonth: "2026-02" });
    const [jan] = occurrences(item.id);
    db.update(schema.recurringOccurrences)
      .set({ status: "missed" })
      .where(eq(schema.recurringOccurrences.id, jan.id))
      .run();
    db.update(schema.recurringItems)
      .set({ expectedAmount: 1199, dayOfMonth: 20 })
      .where(eq(schema.recurringItems.id, item.id))
      .run();
    const before = snapshot(db).occurrences;
    generateOccurrences(db, { throughMonth: "2026-02" });
    expect(snapshot(db).occurrences).toEqual(before);
    generateOccurrences(db, { throughMonth: "2026-03" });
    const all = occurrences(item.id);
    expect(all[0]).toMatchObject({ status: "missed", expectedAmount: 999 });
    expect(all[2]).toMatchObject({ expectedDate: "2026-03-20", expectedAmount: 1199 });
  });

  it("rejects an invalid month", () => {
    const { db } = setup();
    expect(() => generateOccurrences(db, { throughMonth: "2026-3" })).toThrow(RecurringError);
  });
});

describe("markMissed", () => {
  it("does not cry wolf before the month is uploaded", () => {
    const { db, addItem, occ } = setup();
    const item = addItem({ startDate: "2026-03-01" });
    generateOccurrences(db, { throughMonth: "2026-03" });
    expect(markMissed(db, { today: "2027-01-01" })).toBe(0);
    expect(occ(item.id, "2026-03").status).toBe("expected");
  });

  it("marks missed only after the full 5 day window has passed", () => {
    const { db, addItem, cover, occ } = setup();
    const item = addItem({ startDate: "2026-03-01" });
    generateOccurrences(db, { throughMonth: "2026-03" });
    cover("2026-03");
    expect(markMissed(db, { today: "2026-03-15" })).toBe(0); // window ends on the 15th
    expect(occ(item.id, "2026-03").status).toBe("expected");
    expect(markMissed(db, { today: "2026-03-16" })).toBe(1);
    expect(occ(item.id, "2026-03").status).toBe("missed");
    expect(markMissed(db, { today: "2026-03-16" })).toBe(0); // idempotent
  });

  it("needs every month the window touches to be uploaded", () => {
    const { db, addItem, cover, occ } = setup();
    const late = addItem({ name: "Late", dayOfMonth: 29, startDate: "2026-01-01" });
    const early = addItem({ name: "Early", dayOfMonth: 2, startDate: "2026-03-01" });
    generateOccurrences(db, { throughMonth: "2026-03" });
    cover("2026-01", "2026-03");
    // Late: 29 Jan, window runs into February (not uploaded). Early: 2 Mar, window starts in
    // February. Both could have been paid in February, so neither is missed yet.
    markMissed(db, { today: "2026-04-01" });
    expect(occ(late.id, "2026-01").status).toBe("expected");
    expect(occ(early.id, "2026-03").status).toBe("expected");
    cover("2026-02");
    markMissed(db, { today: "2026-04-01" });
    expect(occ(late.id, "2026-01").status).toBe("missed");
    expect(occ(late.id, "2026-02").status).toBe("missed");
    expect(occ(early.id, "2026-03").status).toBe("missed");
  });

  it("leaves matched occurrences alone and validates today", () => {
    const { db, addItem, cover, tx, occ } = setup();
    const item = addItem({ startDate: "2026-03-01" });
    tx("2026-03-10", -999, { counterparty: "Spotify" });
    generateOccurrences(db, { throughMonth: "2026-03" });
    matchOccurrences(db);
    cover("2026-03");
    expect(markMissed(db, { today: "2026-06-01" })).toBe(0);
    expect(occ(item.id, "2026-03").status).toBe("matched");
    expect(() => markMissed(db, { today: "2026-06" })).toThrow(RecurringError);
  });
});

describe("getOccurrences", () => {
  it("reports the actual amount for matched occurrences and the plan otherwise", () => {
    const { db, addItem, tx, cat } = setup();
    addItem({ tolerance: 100, categoryId: cat("Abonnementen") });
    addItem({
      name: "Salaris",
      type: "income",
      matchCounterparty: "Werkgever",
      expectedAmount: 120000,
      tolerance: 5000,
      dayOfMonth: 25,
    });
    const paid = tx("2026-01-11", -1049, { counterparty: "Spotify AB" });
    tx("2026-01-24", 123456, { counterparty: "Voorbeeld Werkgever BV" });
    generateOccurrences(db, { throughMonth: "2026-02" });
    matchOccurrences(db);

    const rows = getOccurrences(db, { from: "2026-01", to: "2026-01" });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      itemName: "Spotify",
      type: "expense",
      categoryId: cat("Abonnementen"),
      status: "matched",
      transactionId: paid.id,
      expectedAmount: 999,
      actualAmount: 1049,
      actualDate: "2026-01-11",
      amount: 1049,
    });
    expect(rows[1]).toMatchObject({ itemName: "Salaris", actualAmount: 123456, amount: 123456 });

    const feb = getOccurrences(db, { from: "2026-02" });
    expect(feb.map((r) => [r.status, r.actualAmount, r.amount])).toEqual([
      ["expected", null, 999],
      ["expected", null, 120000],
    ]);
    expect(getOccurrences(db)).toHaveLength(4);
  });

  it("validates the range", () => {
    const { db } = setup();
    expect(() => getOccurrences(db, { from: "2026-1" })).toThrow(RecurringError);
    expect(() => getOccurrences(db, { from: "2026-03", to: "2026-02" })).toThrow(/from/);
  });

  it("lists missed occurrences most recent first", () => {
    const { db, addItem, cover } = setup();
    addItem();
    generateOccurrences(db, { throughMonth: "2026-03" });
    cover("2026-01", "2026-02", "2026-03");
    markMissed(db, { today: "2026-03-01" });
    expect(getMissedOccurrences(db).map((o) => o.month)).toEqual(["2026-02", "2026-01"]);
  });
});
