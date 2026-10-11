import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { schema } from "@/db";
import { matchOccurrences, pairOccurrences, unmatchedCandidates } from "./matching";
import { generateOccurrences, markMissed } from "./occurrences";
import { setup, snapshot } from "./test-utils";

/** One Spotify item (9,99 on the 10th from March 2026) with its March occurrence. */
function spotify(extra: Parameters<ReturnType<typeof setup>["addItem"]>[0] = {}) {
  const s = setup();
  const item = s.addItem({ startDate: "2026-03-01", ...extra });
  generateOccurrences(s.db, { throughMonth: "2026-03" });
  return { ...s, item, march: () => s.occ(item.id, "2026-03") };
}

describe("matchOccurrences", () => {
  it("links both sides, flips to matched and fills in the item's category", () => {
    const { db, tx, getTx, march, cat, item } = spotify();
    db.update(schema.recurringItems)
      .set({ categoryId: cat("Abonnementen") })
      .where(eq(schema.recurringItems.id, item.id))
      .run();
    const t = tx("2026-03-10", -999, { counterparty: "Spotify AB" });
    expect(matchOccurrences(db)).toEqual({ matched: 1, unlinked: 0 });
    expect(march()).toMatchObject({ status: "matched", transactionId: t.id, expectedAmount: 999 });
    expect(getTx(t.id)).toMatchObject({
      matchedOccurrenceId: march().id,
      categoryId: cat("Abonnementen"),
    });
  });

  it("never overwrites a category the transaction already has", () => {
    const { db, tx, getTx, cat, item } = spotify();
    db.update(schema.recurringItems)
      .set({ categoryId: cat("Abonnementen") })
      .where(eq(schema.recurringItems.id, item.id))
      .run();
    const t = tx("2026-03-10", -999, { counterparty: "Spotify", categoryId: cat("Overig") });
    matchOccurrences(db);
    expect(getTx(t.id)).toMatchObject({ categoryId: cat("Overig") });
    expect(getTx(t.id).matchedOccurrenceId).not.toBeNull();
  });

  it("is idempotent", () => {
    const { db, tx } = spotify();
    tx("2026-03-10", -999, { counterparty: "Spotify" });
    matchOccurrences(db);
    const before = snapshot(db);
    expect(matchOccurrences(db)).toEqual({ matched: 0, unlinked: 0 });
    expect(snapshot(db)).toEqual(before);
  });

  describe("tolerance boundaries", () => {
    it.each([
      [-1049, true], // 50 cents over, exactly at tolerance
      [-949, true], // 50 cents under
      [-1050, false], // one cent over tolerance
      [-948, false],
    ])("amount %i matches: %s", (amount, matches) => {
      const { db, tx, march } = spotify({ tolerance: 50 });
      tx("2026-03-10", amount, { counterparty: "Spotify" });
      matchOccurrences(db);
      expect(march().status).toBe(matches ? "matched" : "expected");
    });

    it("tolerance 0 means the exact amount only", () => {
      const { db, tx, march } = spotify();
      tx("2026-03-10", -1000, { counterparty: "Spotify" });
      matchOccurrences(db);
      expect(march().status).toBe("expected");
    });
  });

  describe("date window", () => {
    it.each([
      ["2026-03-05", true],
      ["2026-03-15", true],
      ["2026-03-04", false],
      ["2026-03-16", false],
    ])("payment on %s matches: %s", (date, matches) => {
      const { db, tx, march } = spotify();
      tx(date, -999, { counterparty: "Spotify" });
      matchOccurrences(db);
      expect(march().status).toBe(matches ? "matched" : "expected");
    });

    it("works across a month boundary", () => {
      const s = setup();
      const item = s.addItem({ dayOfMonth: 31, startDate: "2026-01-01" });
      generateOccurrences(s.db, { throughMonth: "2026-02" });
      const t = s.tx("2026-02-02", -999, { counterparty: "Spotify" }); // 2 days after 31 Jan
      matchOccurrences(s.db);
      expect(s.occ(item.id, "2026-01")).toMatchObject({ status: "matched", transactionId: t.id });
      expect(s.occ(item.id, "2026-02").status).toBe("expected");
    });
  });

  it("never matches the wrong sign", () => {
    const { db, tx, march, addItem, occ } = spotify();
    const refund = tx("2026-03-10", 999, { counterparty: "Spotify" }); // a refund
    const income = addItem({
      name: "Spotify payout",
      type: "income",
      startDate: "2026-03-01",
      dayOfMonth: 12,
    });
    generateOccurrences(db, { throughMonth: "2026-03" });
    const payment = tx("2026-03-12", -999, { counterparty: "Spotify" });
    matchOccurrences(db);
    // The refund went to the income item (same sign), the outgoing payment to the expense.
    // Exact ids: both transactions are 0 days from an occurrence, so only the sign check
    // keeps them apart.
    expect(march()).toMatchObject({ status: "matched", transactionId: payment.id });
    expect(occ(income.id, "2026-03")).toMatchObject({
      status: "matched",
      transactionId: refund.id,
    });
  });

  it("an income item ignores outgoing payments", () => {
    const s = setup();
    const salary = s.addItem({
      name: "Salaris",
      type: "income",
      matchCounterparty: "Werkgever",
      expectedAmount: 120000,
      tolerance: 10000,
      dayOfMonth: 25,
      startDate: "2026-03-01",
    });
    generateOccurrences(s.db, { throughMonth: "2026-03" });
    s.tx("2026-03-25", -120000, { counterparty: "Werkgever" });
    matchOccurrences(s.db);
    expect(s.occ(salary.id, "2026-03").status).toBe("expected");
  });

  describe("identity", () => {
    const rent = (counterparty: string | null, iban: string | null) => {
      const s = setup();
      const item = s.addItem({
        name: "Huur",
        matchCounterparty: "Verhuurder Voorbeeld",
        matchIban: "NL00BANK0000000011",
        expectedAmount: 65000,
        dayOfMonth: 1,
        startDate: "2026-03-01",
      });
      generateOccurrences(s.db, { throughMonth: "2026-03" });
      s.tx("2026-03-01", -65000, { counterparty, counterpartyIban: iban });
      matchOccurrences(s.db);
      return s.occ(item.id, "2026-03").status;
    };

    it("matches on the IBAN even when the name differs", () => {
      expect(rent("Beheer BV namens verhuurder", "NL00BANK0000000011")).toBe("matched");
    });
    it("a different IBAN wins over a matching name", () => {
      expect(rent("Verhuurder Voorbeeld BV", "NL00BANK0000000099")).toBe("expected");
    });
    it("falls back to the name when the transaction has no IBAN", () => {
      expect(rent("VERHUURDER  voorbeeld bv", null)).toBe("matched");
    });
    it("no IBAN and no name means no match", () => {
      expect(rent(null, null)).toBe("expected");
    });
  });

  it("keeps two items with the same counterparty apart by amount", () => {
    const s = setup();
    const storage = s.addItem({ name: "iCloud", matchCounterparty: "Apple", expectedAmount: 99 });
    const music = s.addItem({ name: "Music", matchCounterparty: "Apple", expectedAmount: 1099 });
    generateOccurrences(s.db, { throughMonth: "2026-01" });
    const a = s.tx("2026-01-10", -1099, { counterparty: "Apple Services" });
    const b = s.tx("2026-01-10", -99, { counterparty: "Apple Services" });
    matchOccurrences(s.db);
    expect(s.occ(storage.id, "2026-01").transactionId).toBe(b.id);
    expect(s.occ(music.id, "2026-01").transactionId).toBe(a.id);
  });

  it("matches two identical items to two identical payments one to one", () => {
    const s = setup();
    const one = s.addItem({ name: "Line 1", matchCounterparty: "Odido", expectedAmount: 1500 });
    const two = s.addItem({ name: "Line 2", matchCounterparty: "Odido", expectedAmount: 1500 });
    generateOccurrences(s.db, { throughMonth: "2026-01" });
    const a = s.tx("2026-01-10", -1500, { counterparty: "Odido" });
    const b = s.tx("2026-01-10", -1500, { counterparty: "Odido" });
    expect(matchOccurrences(s.db).matched).toBe(2);
    // Deterministic: the lowest transaction id goes to the lowest occurrence id.
    expect(s.occ(one.id, "2026-01").transactionId).toBe(a.id);
    expect(s.occ(two.id, "2026-01").transactionId).toBe(b.id);
  });

  describe("two transactions competing for one occurrence", () => {
    it("the closest date wins", () => {
      const { db, tx, march, getTx } = spotify({ tolerance: 100 });
      const far = tx("2026-03-07", -999, { counterparty: "Spotify" });
      const near = tx("2026-03-11", -1050, { counterparty: "Spotify" });
      matchOccurrences(db);
      expect(march().transactionId).toBe(near.id);
      expect(getTx(far.id).matchedOccurrenceId).toBeNull();
    });

    it("then the closest amount", () => {
      const { db, tx, march } = spotify({ tolerance: 100 });
      tx("2026-03-09", -1050, { counterparty: "Spotify" });
      const closer = tx("2026-03-11", -1000, { counterparty: "Spotify" });
      matchOccurrences(db);
      expect(march().transactionId).toBe(closer.id);
    });

    it("then the lowest id", () => {
      const { db, tx, march } = spotify();
      const first = tx("2026-03-09", -999, { counterparty: "Spotify" });
      tx("2026-03-11", -999, { counterparty: "Spotify" });
      matchOccurrences(db);
      expect(march().transactionId).toBe(first.id);
    });
  });

  it("gives one transaction between two occurrences to the closer one", () => {
    const s = setup();
    const early = s.addItem({ name: "A", matchCounterparty: "Gym", dayOfMonth: 10 });
    const late = s.addItem({ name: "B", matchCounterparty: "Gym", dayOfMonth: 14 });
    generateOccurrences(s.db, { throughMonth: "2026-01" });
    const t = s.tx("2026-01-13", -999, { counterparty: "Gym" });
    expect(matchOccurrences(s.db).matched).toBe(1);
    expect(s.occ(late.id, "2026-01").transactionId).toBe(t.id);
    expect(s.occ(early.id, "2026-01").status).toBe("expected");
  });

  it("never reuses an already matched transaction", () => {
    const { db, tx, march, addItem, occ } = spotify();
    const t = tx("2026-03-10", -999, { counterparty: "Spotify" });
    matchOccurrences(db);
    const twin = addItem({ name: "Twin", startDate: "2026-03-01" });
    generateOccurrences(db, { throughMonth: "2026-03" });
    expect(matchOccurrences(db).matched).toBe(0);
    expect(march().transactionId).toBe(t.id);
    expect(occ(twin.id, "2026-03").status).toBe("expected");
  });

  it("never matches internal transfers or foreign currency rows", () => {
    const { db, tx, march } = spotify();
    tx("2026-03-10", -999, { counterparty: "Spotify", isInternalTransfer: true });
    tx("2026-03-10", -999, { counterparty: "Spotify", currency: "GBP" });
    expect(matchOccurrences(db).matched).toBe(0);
    expect(march().status).toBe("expected");
  });

  it("ignores occurrences of inactive items", () => {
    const { db, tx, march, item } = spotify();
    db.update(schema.recurringItems)
      .set({ active: false })
      .where(eq(schema.recurringItems.id, item.id))
      .run();
    tx("2026-03-10", -999, { counterparty: "Spotify" });
    expect(matchOccurrences(db).matched).toBe(0);
    expect(march().status).toBe("expected");
  });

  it("a late payment rescues a missed occurrence", () => {
    const { db, tx, march, cover, getTx } = spotify();
    cover("2026-03");
    markMissed(db, { today: "2026-04-01" });
    expect(march().status).toBe("missed");
    // The payment shows up later (e.g. in the other account's upload), 4 days late.
    const t = tx("2026-03-14", -999, { counterparty: "Spotify" });
    expect(matchOccurrences(db).matched).toBe(1);
    expect(march()).toMatchObject({ status: "matched", transactionId: t.id });
    expect(getTx(t.id).matchedOccurrenceId).toBe(march().id);
    expect(markMissed(db, { today: "2026-04-01" })).toBe(0);
  });

  it("a rent increase beyond tolerance leaves both sides unmatched", () => {
    const s = setup();
    const rent = s.addItem({
      name: "Huur",
      matchCounterparty: "Verhuurder",
      expectedAmount: 65000,
      tolerance: 1000,
      dayOfMonth: 1,
      startDate: "2026-07-01",
    });
    generateOccurrences(s.db, { throughMonth: "2026-07" });
    const t = s.tx("2026-07-01", -68000, { counterparty: "Verhuurder" });
    s.cover("2026-06", "2026-07"); // the window of 1 July starts in June
    matchOccurrences(s.db);
    markMissed(s.db, { today: "2026-08-01" });
    expect(s.occ(rent.id, "2026-07")).toMatchObject({ status: "missed", transactionId: null });
    expect(s.getTx(t.id).matchedOccurrenceId).toBeNull();
  });

  it("releases a match whose transaction turned out to be an internal transfer", () => {
    const { db, tx, march, getTx } = spotify();
    const wrong = tx("2026-03-10", -999, { counterparty: "Spotify" });
    matchOccurrences(db);
    db.update(schema.transactions)
      .set({ isInternalTransfer: true })
      .where(eq(schema.transactions.id, wrong.id))
      .run();
    const right = tx("2026-03-11", -999, { counterparty: "Spotify" });
    expect(matchOccurrences(db)).toEqual({ matched: 1, unlinked: 1 });
    expect(march().transactionId).toBe(right.id);
    expect(getTx(wrong.id).matchedOccurrenceId).toBeNull();
  });

  it("does nothing without open occurrences", () => {
    const { db, tx } = setup();
    tx("2026-03-10", -999, { counterparty: "Spotify" });
    expect(matchOccurrences(db)).toEqual({ matched: 0, unlinked: 0 });
  });
});

describe("pairOccurrences (pure, shared with the forecast)", () => {
  const item = {
    type: "expense" as const,
    tolerance: 100,
    matchCounterparty: "Verhuurder",
    matchIban: null,
  };
  const open = (key: number, expectedDate: string) => ({
    key,
    expectedDate,
    expectedAmount: 80000,
    item,
  });

  it("pairs one-to-one by date distance, within window, tolerance, sign and identity", () => {
    const { db, tx } = setup();
    const early = tx("2026-10-28", -80000, { counterparty: "Verhuurder BV" });
    tx("2026-10-29", -80000, { counterparty: "Someone else" });
    tx("2026-10-30", 80000, { counterparty: "Verhuurder BV" }); // wrong sign
    tx("2026-10-31", -80101, { counterparty: "Verhuurder BV" }); // beyond tolerance
    tx("2026-11-07", -80000, { counterparty: "Verhuurder BV" }); // 6 days late
    const txs = unmatchedCandidates(db, "2026-10-01", "2026-12-31");
    const pairs = pairOccurrences([open(1, "2026-11-01"), open(2, "2026-12-01")], txs);
    expect(pairs.map((p) => [p.o.key, p.t.id])).toEqual([[1, early.id]]);
  });

  it("gives a contested transaction to the closest occurrence", () => {
    const { db, tx } = setup();
    const t = tx("2026-11-03", -80000, { counterparty: "Verhuurder" });
    const txs = unmatchedCandidates(db, "2026-10-01", "2026-12-31");
    const pairs = pairOccurrences([open(1, "2026-10-30"), open(2, "2026-11-01")], txs);
    expect(pairs.map((p) => [p.o.key, p.t.id])).toEqual([[2, t.id]]);
  });

  it("only offers unmatched, non-transfer rows in the account currency within the dates", () => {
    const { db, tx, addItem } = setup();
    addItem();
    generateOccurrences(db, { throughMonth: "2026-03" });
    const ok = tx("2026-03-10", -999, { counterparty: "Spotify" });
    tx("2026-03-11", -999, { counterparty: "Spotify", isInternalTransfer: true });
    tx("2026-03-12", -999, { counterparty: "Spotify", currency: "USD" });
    tx("2026-04-01", -999, { counterparty: "Spotify" });
    const matched = tx("2026-02-10", -999, { counterparty: "Spotify" });
    matchOccurrences(db);
    expect(
      db.select().from(schema.transactions).where(eq(schema.transactions.id, matched.id)).get()!
        .matchedOccurrenceId,
    ).not.toBeNull();
    expect(unmatchedCandidates(db, "2026-02-01", "2026-03-31").map((t) => t.id)).toEqual([ok.id]);
  });
});
