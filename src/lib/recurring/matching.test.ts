import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { one, schema } from "@/db";
import { matchOccurrences, pairOccurrences, unmatchedCandidates } from "./matching";
import { generateOccurrences, markMissed } from "./occurrences";
import { setup, snapshot } from "./test-utils";

/** One Spotify item (9,99 on the 10th from March 2026) with its March occurrence. */
async function spotify(extra: Parameters<Awaited<ReturnType<typeof setup>>["addItem"]>[0] = {}) {
  const s = await setup();
  const item = await s.addItem({ startDate: "2026-03-01", ...extra });
  await generateOccurrences(s.db, { throughMonth: "2026-03" });
  return { ...s, item, march: async () => await s.occ(item.id, "2026-03") };
}

describe("matchOccurrences", () => {
  it("links both sides, flips to matched and fills in the item's category", async () => {
    const { db, tx, getTx, march, cat, item } = await spotify();
    await db
      .update(schema.recurringItems)
      .set({ categoryId: await cat("Abonnementen") })
      .where(eq(schema.recurringItems.id, item.id));
    const t = await tx("2026-03-10", -999, { counterparty: "Spotify AB" });
    expect(await matchOccurrences(db)).toEqual({ matched: 1, unlinked: 0 });
    expect(await march()).toMatchObject({
      status: "matched",
      transactionId: t.id,
      expectedAmount: 999,
    });
    expect(await getTx(t.id)).toMatchObject({
      matchedOccurrenceId: (await march()).id,
      categoryId: await cat("Abonnementen"),
    });
  });

  it("never overwrites a category the transaction already has", async () => {
    const { db, tx, getTx, cat, item } = await spotify();
    await db
      .update(schema.recurringItems)
      .set({ categoryId: await cat("Abonnementen") })
      .where(eq(schema.recurringItems.id, item.id));
    const t = await tx("2026-03-10", -999, {
      counterparty: "Spotify",
      categoryId: await cat("Overig"),
    });
    await matchOccurrences(db);
    expect(await getTx(t.id)).toMatchObject({ categoryId: await cat("Overig") });
    expect((await getTx(t.id)).matchedOccurrenceId).not.toBeNull();
  });

  it("is idempotent", async () => {
    const { db, tx } = await spotify();
    await tx("2026-03-10", -999, { counterparty: "Spotify" });
    await matchOccurrences(db);
    const before = await snapshot(db);
    expect(await matchOccurrences(db)).toEqual({ matched: 0, unlinked: 0 });
    expect(await snapshot(db)).toEqual(before);
  });

  describe("tolerance boundaries", () => {
    it.each([
      [-1049, true], // 50 cents over, exactly at tolerance
      [-949, true], // 50 cents under
      [-1050, false], // one cent over tolerance
      [-948, false],
    ])("amount %i matches: %s", async (amount, matches) => {
      const { db, tx, march } = await spotify({ tolerance: 50 });
      await tx("2026-03-10", amount, { counterparty: "Spotify" });
      await matchOccurrences(db);
      expect((await march()).status).toBe(matches ? "matched" : "expected");
    });

    it("tolerance 0 means the exact amount only", async () => {
      const { db, tx, march } = await spotify();
      await tx("2026-03-10", -1000, { counterparty: "Spotify" });
      await matchOccurrences(db);
      expect((await march()).status).toBe("expected");
    });
  });

  describe("date window", () => {
    it.each([
      ["2026-03-05", true],
      ["2026-03-15", true],
      ["2026-03-04", false],
      ["2026-03-16", false],
    ])("payment on %s matches: %s", async (date, matches) => {
      const { db, tx, march } = await spotify();
      await tx(date, -999, { counterparty: "Spotify" });
      await matchOccurrences(db);
      expect((await march()).status).toBe(matches ? "matched" : "expected");
    });

    it("works across a month boundary", async () => {
      const s = await setup();
      const item = await s.addItem({ dayOfMonth: 31, startDate: "2026-01-01" });
      await generateOccurrences(s.db, { throughMonth: "2026-02" });
      const t = await s.tx("2026-02-02", -999, { counterparty: "Spotify" }); // 2 days after 31 Jan
      await matchOccurrences(s.db);
      expect(await s.occ(item.id, "2026-01")).toMatchObject({
        status: "matched",
        transactionId: t.id,
      });
      expect((await s.occ(item.id, "2026-02")).status).toBe("expected");
    });
  });

  it("never matches the wrong sign", async () => {
    const { db, tx, march, addItem, occ } = await spotify();
    const refund = await tx("2026-03-10", 999, { counterparty: "Spotify" }); // a refund
    const income = await addItem({
      name: "Spotify payout",
      type: "income",
      startDate: "2026-03-01",
      dayOfMonth: 12,
    });
    await generateOccurrences(db, { throughMonth: "2026-03" });
    const payment = await tx("2026-03-12", -999, { counterparty: "Spotify" });
    await matchOccurrences(db);
    // The refund went to the income item (same sign), the outgoing payment to the expense.
    // Exact ids: both transactions are 0 days from an occurrence, so only the sign check
    // keeps them apart.
    expect(await march()).toMatchObject({ status: "matched", transactionId: payment.id });
    expect(await occ(income.id, "2026-03")).toMatchObject({
      status: "matched",
      transactionId: refund.id,
    });
  });

  it("an income item ignores outgoing payments", async () => {
    const s = await setup();
    const salary = await s.addItem({
      name: "Salaris",
      type: "income",
      matchCounterparty: "Werkgever",
      expectedAmount: 120000,
      tolerance: 10000,
      dayOfMonth: 25,
      startDate: "2026-03-01",
    });
    await generateOccurrences(s.db, { throughMonth: "2026-03" });
    await s.tx("2026-03-25", -120000, { counterparty: "Werkgever" });
    await matchOccurrences(s.db);
    expect((await s.occ(salary.id, "2026-03")).status).toBe("expected");
  });

  describe("identity", () => {
    const rent = async (counterparty: string | null, iban: string | null) => {
      const s = await setup();
      const item = await s.addItem({
        name: "Huur",
        matchCounterparty: "Verhuurder Voorbeeld",
        matchIban: "NL00BANK0000000011",
        expectedAmount: 65000,
        dayOfMonth: 1,
        startDate: "2026-03-01",
      });
      await generateOccurrences(s.db, { throughMonth: "2026-03" });
      await s.tx("2026-03-01", -65000, { counterparty, counterpartyIban: iban });
      await matchOccurrences(s.db);
      return (await s.occ(item.id, "2026-03")).status;
    };

    it("matches on the IBAN even when the name differs", async () => {
      expect(await rent("Beheer BV namens verhuurder", "NL00BANK0000000011")).toBe("matched");
    });
    it("a different IBAN wins over a matching name", async () => {
      expect(await rent("Verhuurder Voorbeeld BV", "NL00BANK0000000099")).toBe("expected");
    });
    it("falls back to the name when the transaction has no IBAN", async () => {
      expect(await rent("VERHUURDER  voorbeeld bv", null)).toBe("matched");
    });
    it("no IBAN and no name means no match", async () => {
      expect(await rent(null, null)).toBe("expected");
    });
  });

  it("keeps two items with the same counterparty apart by amount", async () => {
    const s = await setup();
    const storage = await s.addItem({
      name: "iCloud",
      matchCounterparty: "Apple",
      expectedAmount: 99,
    });
    const music = await s.addItem({
      name: "Music",
      matchCounterparty: "Apple",
      expectedAmount: 1099,
    });
    await generateOccurrences(s.db, { throughMonth: "2026-01" });
    const a = await s.tx("2026-01-10", -1099, { counterparty: "Apple Services" });
    const b = await s.tx("2026-01-10", -99, { counterparty: "Apple Services" });
    await matchOccurrences(s.db);
    expect((await s.occ(storage.id, "2026-01")).transactionId).toBe(b.id);
    expect((await s.occ(music.id, "2026-01")).transactionId).toBe(a.id);
  });

  it("matches two identical items to two identical payments one to one", async () => {
    const s = await setup();
    const one = await s.addItem({
      name: "Line 1",
      matchCounterparty: "Odido",
      expectedAmount: 1500,
    });
    const two = await s.addItem({
      name: "Line 2",
      matchCounterparty: "Odido",
      expectedAmount: 1500,
    });
    await generateOccurrences(s.db, { throughMonth: "2026-01" });
    const a = await s.tx("2026-01-10", -1500, { counterparty: "Odido" });
    const b = await s.tx("2026-01-10", -1500, { counterparty: "Odido" });
    expect((await matchOccurrences(s.db)).matched).toBe(2);
    // Deterministic: the lowest transaction id goes to the lowest occurrence id.
    expect((await s.occ(one.id, "2026-01")).transactionId).toBe(a.id);
    expect((await s.occ(two.id, "2026-01")).transactionId).toBe(b.id);
  });

  describe("two transactions competing for one occurrence", () => {
    it("the closest date wins", async () => {
      const { db, tx, march, getTx } = await spotify({ tolerance: 100 });
      const far = await tx("2026-03-07", -999, { counterparty: "Spotify" });
      const near = await tx("2026-03-11", -1050, { counterparty: "Spotify" });
      await matchOccurrences(db);
      expect((await march()).transactionId).toBe(near.id);
      expect((await getTx(far.id)).matchedOccurrenceId).toBeNull();
    });

    it("then the closest amount", async () => {
      const { db, tx, march } = await spotify({ tolerance: 100 });
      await tx("2026-03-09", -1050, { counterparty: "Spotify" });
      const closer = await tx("2026-03-11", -1000, { counterparty: "Spotify" });
      await matchOccurrences(db);
      expect((await march()).transactionId).toBe(closer.id);
    });

    it("then the lowest id", async () => {
      const { db, tx, march } = await spotify();
      const first = await tx("2026-03-09", -999, { counterparty: "Spotify" });
      await tx("2026-03-11", -999, { counterparty: "Spotify" });
      await matchOccurrences(db);
      expect((await march()).transactionId).toBe(first.id);
    });
  });

  it("gives one transaction between two occurrences to the closer one", async () => {
    const s = await setup();
    const early = await s.addItem({ name: "A", matchCounterparty: "Gym", dayOfMonth: 10 });
    const late = await s.addItem({ name: "B", matchCounterparty: "Gym", dayOfMonth: 14 });
    await generateOccurrences(s.db, { throughMonth: "2026-01" });
    const t = await s.tx("2026-01-13", -999, { counterparty: "Gym" });
    expect((await matchOccurrences(s.db)).matched).toBe(1);
    expect((await s.occ(late.id, "2026-01")).transactionId).toBe(t.id);
    expect((await s.occ(early.id, "2026-01")).status).toBe("expected");
  });

  it("never reuses an already matched transaction", async () => {
    const { db, tx, march, addItem, occ } = await spotify();
    const t = await tx("2026-03-10", -999, { counterparty: "Spotify" });
    await matchOccurrences(db);
    const twin = await addItem({ name: "Twin", startDate: "2026-03-01" });
    await generateOccurrences(db, { throughMonth: "2026-03" });
    expect((await matchOccurrences(db)).matched).toBe(0);
    expect((await march()).transactionId).toBe(t.id);
    expect((await occ(twin.id, "2026-03")).status).toBe("expected");
  });

  it("never matches internal transfers or foreign currency rows", async () => {
    const { db, tx, march } = await spotify();
    await tx("2026-03-10", -999, { counterparty: "Spotify", isInternalTransfer: true });
    await tx("2026-03-10", -999, { counterparty: "Spotify", currency: "GBP" });
    expect((await matchOccurrences(db)).matched).toBe(0);
    expect((await march()).status).toBe("expected");
  });

  it("ignores occurrences of inactive items", async () => {
    const { db, tx, march, item } = await spotify();
    await db
      .update(schema.recurringItems)
      .set({ active: false })
      .where(eq(schema.recurringItems.id, item.id));
    await tx("2026-03-10", -999, { counterparty: "Spotify" });
    expect((await matchOccurrences(db)).matched).toBe(0);
    expect((await march()).status).toBe("expected");
  });

  it("a late payment rescues a missed occurrence", async () => {
    const { db, tx, march, cover, getTx } = await spotify();
    await cover("2026-03");
    await markMissed(db, { today: "2026-04-01" });
    expect((await march()).status).toBe("missed");
    // The payment shows up later (e.g. in the other account's upload), 4 days late.
    const t = await tx("2026-03-14", -999, { counterparty: "Spotify" });
    expect((await matchOccurrences(db)).matched).toBe(1);
    expect(await march()).toMatchObject({ status: "matched", transactionId: t.id });
    expect((await getTx(t.id)).matchedOccurrenceId).toBe((await march()).id);
    expect(await markMissed(db, { today: "2026-04-01" })).toBe(0);
  });

  it("a rent increase beyond tolerance leaves both sides unmatched", async () => {
    const s = await setup();
    const rent = await s.addItem({
      name: "Huur",
      matchCounterparty: "Verhuurder",
      expectedAmount: 65000,
      tolerance: 1000,
      dayOfMonth: 1,
      startDate: "2026-07-01",
    });
    await generateOccurrences(s.db, { throughMonth: "2026-07" });
    const t = await s.tx("2026-07-01", -68000, { counterparty: "Verhuurder" });
    await s.cover("2026-06", "2026-07"); // the window of 1 July starts in June
    await matchOccurrences(s.db);
    await markMissed(s.db, { today: "2026-08-01" });
    expect(await s.occ(rent.id, "2026-07")).toMatchObject({
      status: "missed",
      transactionId: null,
    });
    expect((await s.getTx(t.id)).matchedOccurrenceId).toBeNull();
  });

  it("releases a match whose transaction turned out to be an internal transfer", async () => {
    const { db, tx, march, getTx } = await spotify();
    const wrong = await tx("2026-03-10", -999, { counterparty: "Spotify" });
    await matchOccurrences(db);
    await db
      .update(schema.transactions)
      .set({ isInternalTransfer: true })
      .where(eq(schema.transactions.id, wrong.id));
    const right = await tx("2026-03-11", -999, { counterparty: "Spotify" });
    expect(await matchOccurrences(db)).toEqual({ matched: 1, unlinked: 1 });
    expect((await march()).transactionId).toBe(right.id);
    expect((await getTx(wrong.id)).matchedOccurrenceId).toBeNull();
  });

  it("does nothing without open occurrences", async () => {
    const { db, tx } = await setup();
    await tx("2026-03-10", -999, { counterparty: "Spotify" });
    expect(await matchOccurrences(db)).toEqual({ matched: 0, unlinked: 0 });
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

  it("pairs one-to-one by date distance, within window, tolerance, sign and identity", async () => {
    const { db, tx } = await setup();
    const early = await tx("2026-10-28", -80000, { counterparty: "Verhuurder BV" });
    await tx("2026-10-29", -80000, { counterparty: "Someone else" });
    await tx("2026-10-30", 80000, { counterparty: "Verhuurder BV" }); // wrong sign
    await tx("2026-10-31", -80101, { counterparty: "Verhuurder BV" }); // beyond tolerance
    await tx("2026-11-07", -80000, { counterparty: "Verhuurder BV" }); // 6 days late
    const txs = await unmatchedCandidates(db, "2026-10-01", "2026-12-31");
    const pairs = pairOccurrences([open(1, "2026-11-01"), open(2, "2026-12-01")], txs);
    expect(pairs.map((p) => [p.o.key, p.t.id])).toEqual([[1, early.id]]);
  });

  it("gives a contested transaction to the closest occurrence", async () => {
    const { db, tx } = await setup();
    const t = await tx("2026-11-03", -80000, { counterparty: "Verhuurder" });
    const txs = await unmatchedCandidates(db, "2026-10-01", "2026-12-31");
    const pairs = pairOccurrences([open(1, "2026-10-30"), open(2, "2026-11-01")], txs);
    expect(pairs.map((p) => [p.o.key, p.t.id])).toEqual([[2, t.id]]);
  });

  it("only offers unmatched, non-transfer rows in the account currency within the dates", async () => {
    const { db, tx, addItem } = await setup();
    await addItem();
    await generateOccurrences(db, { throughMonth: "2026-03" });
    const ok = await tx("2026-03-10", -450, { counterparty: "Bakker" });
    await tx("2026-03-11", -999, { counterparty: "Spotify", isInternalTransfer: true });
    await tx("2026-03-12", -999, { counterparty: "Spotify", currency: "USD" });
    await tx("2026-04-01", -999, { counterparty: "Spotify" });
    const matched = await tx("2026-02-10", -999, { counterparty: "Spotify" });
    await matchOccurrences(db);
    expect(
      (await one(
        db.select().from(schema.transactions).where(eq(schema.transactions.id, matched.id)),
      ))!.matchedOccurrenceId,
    ).not.toBeNull();
    expect((await unmatchedCandidates(db, "2026-02-01", "2026-03-31")).map((t) => t.id)).toEqual([
      ok.id,
    ]);
  });
});
