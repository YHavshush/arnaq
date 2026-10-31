import { describe, expect, it } from "vitest";
import { schema } from "@/db";
import { RecurringError } from "./errors";
import { createRecurringItem, listRecurringItems, updateRecurringItem } from "./items";
import { getOccurrences } from "./occurrences";
import { acceptSuggestion, detectSuggestions, rejectSuggestion } from "./suggestions";
import { setup, snapshot } from "./test-utils";

const TODAY = "2026-09-20";

async function history() {
  const s = await setup();
  /** Insert one payment per [date, signed cents] for a counterparty. */
  const series = async (
    counterparty: string,
    rows: [string, number][],
    extra: Parameters<typeof s.tx>[2] = {},
  ) => {
    const out = [];
    for (const [date, amount] of rows)
      out.push(await s.tx(date, amount, { counterparty, ...extra }));
    return out;
  };
  const suggestions = async (today = TODAY) => await detectSuggestions(s.db, { today });
  const keys = async (today = TODAY) => (await suggestions(today)).map((x) => `${x.type}:${x.key}`);
  return { ...s, series, suggestions, keys };
}

describe("detectSuggestions", () => {
  it("needs three consecutive months", async () => {
    const h = await history();
    await h.series("Netflix", [
      ["2026-08-05", -1399],
      ["2026-09-05", -1399],
    ]);
    expect(await h.suggestions()).toEqual([]);
    await h.series("Netflix", [["2026-07-05", -1399]]);
    expect(await h.keys()).toEqual(["expense:netflix"]);
  });

  it("describes the suggestion with the current amount, tolerance, IBAN, category and evidence", async () => {
    const h = await history();
    const txs = await h.series(
      "Netflix International BV",
      [
        ["2026-06-04", -1399],
        ["2026-07-06", -1399],
        ["2026-08-05", -1499],
        ["2026-09-05", -1499],
      ],
      { counterpartyIban: "NL00 NFLX 0000 0000 01", categoryId: await h.cat("Abonnementen") },
    );
    expect(await h.suggestions()).toEqual([
      {
        key: "netflix international bv",
        type: "expense",
        name: "Netflix International BV",
        matchCounterparty: "Netflix International BV",
        matchIban: "NL00NFLX0000000001",
        expectedAmount: 1499, // the median of the latest three months: what it costs now, an observed amount
        tolerance: 100, // max(spread 100, 5% = 70, 1 euro)
        dayOfMonth: 5,
        frequency: "monthly",
        categoryId: await h.cat("Abonnementen"),
        startDate: "2026-06-01",
        evidence: {
          months: ["2026-06", "2026-07", "2026-08", "2026-09"],
          transactionIds: txs.map((t) => t.id),
        },
      },
    ]);
  });

  it("drops the IBAN when it is not consistent and picks the most common category", async () => {
    const h = await history();
    await h.series("Gym", [["2026-07-01", -2999]], {
      counterpartyIban: "NL01",
      categoryId: await h.cat("Sport"),
    });
    await h.series("Gym", [["2026-08-01", -2999]], {
      counterpartyIban: "NL02",
      categoryId: await h.cat("Sport"),
    });
    await h.series("Gym", [["2026-09-01", -2999]], { categoryId: await h.cat("Overig") });
    const [s] = await h.suggestions();
    expect(s).toMatchObject({ matchIban: null, categoryId: await h.cat("Sport") });
  });

  it("suggests income too", async () => {
    const h = await history();
    await h.series(
      "Voorbeeld Werkgever BV",
      [
        ["2026-06-24", 123456],
        ["2026-07-25", 125000],
        ["2026-08-23", 119000],
        ["2026-09-25", 123456],
      ],
      { categoryId: await h.cat("Salaris / bijbaan") },
    );
    expect(await h.suggestions()).toEqual([
      expect.objectContaining({
        type: "income",
        key: "voorbeeld werkgever bv",
        expectedAmount: 123456,
        tolerance: 6173, // 5% beats the 4456 spread
        dayOfMonth: 24,
        categoryId: await h.cat("Salaris / bijbaan"),
      }),
    ]);
  });

  it("suggests what a charge costs now after a raise (rent), not the average of old and new", async () => {
    const h = await history();
    await h.series("Stichting DUWO", [
      ["2026-03-02", -46848],
      ["2026-04-01", -46848],
      ["2026-05-04", -46848],
      ["2026-06-01", -46848],
      ["2026-07-01", -48145],
      ["2026-08-03", -48145],
      ["2026-09-01", -48145],
    ]);
    const [rent] = await h.suggestions();
    expect(rent.expectedAmount).toBe(48145);
  });

  it("does not suggest variable amounts", async () => {
    const h = await history();
    await h.series("Restaurant De Gouden Lepel", [
      ["2026-07-12", -3000],
      ["2026-08-12", -5500],
      ["2026-09-12", -8000],
    ]);
    expect(await h.suggestions()).toEqual([]);
  });

  it("allows small amounts to vary by up to 2 euro, larger ones by 10%", async () => {
    const h = await history();
    await h.series("Telefoon", [
      ["2026-07-15", -1500],
      ["2026-08-15", -1700],
      ["2026-09-15", -1300],
    ]);
    await h.series("Energie", [
      ["2026-07-15", -10000],
      ["2026-08-15", -11000],
      ["2026-09-15", -9000],
    ]);
    await h.series("Water", [
      ["2026-07-15", -10000],
      ["2026-08-15", -11001],
      ["2026-09-15", -10000],
    ]);
    expect(await h.keys()).toEqual(["expense:energie", "expense:telefoon"]);
  });

  it("does not suggest groceries or coffee", async () => {
    const h = await history();
    for (const month of ["2026-06", "2026-07", "2026-08", "2026-09"]) {
      await h.series("Albert Heijn 1234", [
        [`${month}-03`, -4237],
        [`${month}-10`, -3980],
        [`${month}-17`, -4410],
        [`${month}-24`, -4105],
      ]);
      await h.series("Koffie Voorbeeld", [
        [`${month}-02`, -450],
        [`${month}-03`, -450],
        [`${month}-04`, -380],
        [`${month}-05`, -450],
        [`${month}-08`, -450],
      ]);
    }
    expect(await h.suggestions()).toEqual([]);
  });

  it("does not suggest irregular timing", async () => {
    const h = await history();
    await h.series("Kapper", [
      ["2026-07-03", -2500],
      ["2026-08-15", -2500],
      ["2026-09-09", -2500],
    ]);
    expect(await h.suggestions()).toEqual([]);
  });

  it("allows a day spread of 5 but not 6", async () => {
    const h = await history();
    await h.series("Five", [
      ["2026-07-10", -1000],
      ["2026-08-15", -1000],
      ["2026-09-12", -1000],
    ]);
    await h.series("Six", [
      ["2026-07-10", -1000],
      ["2026-08-16", -1000],
      ["2026-09-12", -1000],
    ]);
    expect(await h.keys()).toEqual(["expense:five"]);
  });

  it("handles payments around the turn of the month", async () => {
    const h = await history();
    const txs = await h.series("Verhuurder Voorbeeld", [
      ["2026-05-29", -65000],
      ["2026-07-01", -65000], // June's rent, paid a day late
      ["2026-07-31", -65000],
      ["2026-08-31", -65000],
    ]);
    const [s] = await h.suggestions();
    expect(s).toMatchObject({ dayOfMonth: 31, startDate: "2026-05-01" });
    expect(s.evidence.transactionIds).toEqual(txs.map((t) => t.id));

    // Accepting matches all four, the late one to June.
    const { item } = await acceptSuggestion(h.db, { key: s.key, type: s.type }, { today: TODAY });
    expect(
      (await getOccurrences(h.db, { to: "2026-08" })).map((o) => [o.month, o.status, o.actualDate]),
    ).toEqual([
      ["2026-05", "matched", "2026-05-29"],
      ["2026-06", "matched", "2026-07-01"],
      ["2026-07", "matched", "2026-07-31"],
      ["2026-08", "matched", "2026-08-31"],
    ]);
    expect(item.dayOfMonth).toBe(31);
  });

  it("handles a payment early in the month that drifts across the month start", async () => {
    const h = await history();
    await h.series("Zorgverzekeraar", [
      ["2026-06-01", -14500],
      ["2026-06-30", -14500], // July's premium, a day early
      ["2026-08-02", -14500],
      ["2026-09-01", -14500],
    ]);
    const [s] = await h.suggestions();
    expect(s).toMatchObject({ dayOfMonth: 1, startDate: "2026-06-01" });
    expect(s.evidence.months).toEqual(["2026-06", "2026-07", "2026-08", "2026-09"]);
  });

  it("drops ended subscriptions", async () => {
    const h = await history();
    await h.series("Disney Plus", [
      ["2026-04-08", -899],
      ["2026-05-08", -899],
      ["2026-06-08", -899],
    ]);
    await h.tx("2026-09-15", -100, { counterparty: "Newest data" });
    expect(await h.suggestions()).toEqual([]);
    // Last seen two months before the newest data: still stale.
    await h.series("Disney Plus", [["2026-07-08", -899]]);
    expect(await h.keys()).toEqual([]);
    // Last seen in the month before the newest data: current.
    await h.series("Disney Plus", [["2026-08-08", -899]]);
    expect(await h.keys()).toEqual(["expense:disney plus"]);
  });

  it("uses the latest run of consecutive months", async () => {
    const h = await history();
    await h.series("Gym", [
      ["2026-01-05", -2999],
      ["2026-02-05", -2999],
      ["2026-03-05", -2999],
      // gap in April
      ["2026-05-05", -2999],
      ["2026-06-05", -2999],
    ]);
    expect(await h.suggestions("2026-06-30")).toEqual([]);
    await h.series("Gym", [["2026-07-05", -2999]]);
    expect((await h.suggestions("2026-07-30"))[0]).toMatchObject({ startDate: "2026-05-01" });
  });

  it("tolerates a one-off extra payment to the same counterparty", async () => {
    const h = await history();
    const subs = await h.series("Apple", [
      ["2026-07-20", -299],
      ["2026-08-20", -299],
      ["2026-09-20", -299],
    ]);
    await h.series("Apple", [["2026-08-02", -1499]]); // bought an app
    const [s] = await h.suggestions();
    expect(s).toMatchObject({ expectedAmount: 299, dayOfMonth: 20 });
    expect(s.evidence.transactionIds).toEqual(subs.map((t) => t.id));
  });

  it("ignores internal transfers, foreign currency, future rows and matched history", async () => {
    const h = await history();
    const rows: [string, number][] = [
      ["2026-07-12", -20000],
      ["2026-08-12", -20000],
      ["2026-09-12", -20000],
    ];
    await h.series("J. Student", rows, { isInternalTransfer: true });
    await h.series("Train", rows, { currency: "GBP" });
    await h.series("Later", [
      ["2026-07-25", -500],
      ["2026-08-25", -500],
      ["2026-09-25", -500],
    ]);
    expect(await h.suggestions("2026-09-20")).toEqual([]);
    await h.series("Spotify", [
      ["2026-07-10", -999],
      ["2026-08-10", -999],
      ["2026-09-10", -999],
    ]);
    expect(await h.keys("2026-09-20")).toEqual(["expense:spotify"]);
    await createRecurringItem(
      h.db,
      {
        name: "Spotify",
        type: "expense",
        matchCounterparty: "Spotify",
        expectedAmount: 999,
        dayOfMonth: 10,
        startDate: "2026-07-01",
      },
      { today: "2026-09-20" },
    );
    expect(await h.keys("2026-09-20")).toEqual([]);
  });

  it("does not suggest what an active item already covers, but does after deactivation", async () => {
    const h = await history();
    const rows: [string, number][] = [
      ["2026-07-10", -999],
      ["2026-08-10", -999],
      ["2026-09-10", -999],
    ];
    await h.series("Spotify AB", rows);
    // An item that matches by name but not by amount: the history stays unmatched.
    const item = await createRecurringItem(
      h.db,
      {
        name: "Spotify Family",
        type: "expense",
        matchCounterparty: "spotify",
        expectedAmount: 1799,
        dayOfMonth: 10,
        startDate: "2026-10-01",
      },
      { today: TODAY },
    );
    expect(await h.suggestions()).toEqual([]);
    await updateRecurringItem(h.db, item.id, { active: false }, { today: TODAY });
    expect(await h.keys()).toEqual(["expense:spotify ab"]);
  });

  it("does not suggest rejected ones, per sign", async () => {
    const h = await history();
    const rows = (sign: number): [string, number][] => [
      ["2026-07-10", sign * 5000],
      ["2026-08-10", sign * 5000],
      ["2026-09-10", sign * 5000],
    ];
    await h.series("Mam", rows(1));
    await h.series("Mam", rows(-1));
    expect(await h.keys()).toEqual(["expense:mam", "income:mam"]);
    await rejectSuggestion(h.db, { key: "  MAM ", type: "income" });
    await rejectSuggestion(h.db, { key: "mam", type: "income" }); // twice is fine
    expect(await h.keys()).toEqual(["expense:mam"]);
    expect(await h.db.select().from(schema.recurringSuggestionRejections)).toHaveLength(1);
  });

  it("validates input", async () => {
    const h = await history();
    await expect(h.suggestions("today")).rejects.toThrow(RecurringError);
    await expect(rejectSuggestion(h.db, { key: " ", type: "expense" })).rejects.toThrow(/key/);
    await expect(rejectSuggestion(h.db, { key: "x", type: "transfer" as never })).rejects.toThrow(
      /Type/,
    );
  });
});

describe("acceptSuggestion", () => {
  async function netflix() {
    const h = await history();
    const txs = await h.series(
      "Netflix",
      [
        ["2026-06-05", -1399],
        ["2026-07-05", -1399],
        ["2026-08-06", -1399],
        ["2026-09-04", -1399],
      ],
      { categoryId: null },
    );
    await h.cover("2026-06", "2026-07", "2026-08", "2026-09");
    return { ...h, txs };
  }

  it("creates the item from the first month and matches the history", async () => {
    const h = await netflix();
    const { item, created } = await acceptSuggestion(
      h.db,
      { key: "netflix", type: "expense", categoryId: await h.cat("Abonnementen") },
      { today: TODAY },
    );
    expect(created).toBe(true);
    expect(item).toMatchObject({
      name: "Netflix",
      startDate: "2026-06-01",
      expectedAmount: 1399,
      dayOfMonth: 5,
      categoryId: await h.cat("Abonnementen"),
    });
    expect((await h.occurrences(item.id)).map((o) => [o.month, o.status, o.transactionId])).toEqual(
      [
        ["2026-06", "matched", h.txs[0].id],
        ["2026-07", "matched", h.txs[1].id],
        ["2026-08", "matched", h.txs[2].id],
        ["2026-09", "matched", h.txs[3].id],
      ],
    );
    // History is now recurring, not variable spending, and got the category.
    for (const t of h.txs)
      expect(await h.getTx(t.id)).toMatchObject({ categoryId: await h.cat("Abonnementen") });
    expect(await h.suggestions()).toEqual([]);
  });

  it("is idempotent", async () => {
    const h = await netflix();
    const first = await acceptSuggestion(
      h.db,
      { key: "netflix", type: "expense" },
      { today: TODAY },
    );
    const before = await snapshot(h.db);
    const second = await acceptSuggestion(
      h.db,
      { key: "Netflix", type: "expense" },
      { today: TODAY },
    );
    expect(second).toEqual({ item: first.item, created: false });
    expect(await snapshot(h.db)).toEqual(before);
    expect(await listRecurringItems(h.db)).toHaveLength(1);
  });

  it("applies overrides and validates them", async () => {
    const h = await netflix();
    await expect(
      acceptSuggestion(
        h.db,
        { key: "netflix", type: "expense", expectedAmount: -5 },
        { today: TODAY },
      ),
    ).rejects.toThrow(/positive integer/);
    expect(await listRecurringItems(h.db)).toHaveLength(0);
    const { item } = await acceptSuggestion(
      h.db,
      { key: "netflix", type: "expense", name: "Netflix Standard", tolerance: 0, dayOfMonth: 6 },
      { today: TODAY },
    );
    expect(item).toMatchObject({ name: "Netflix Standard", tolerance: 0, dayOfMonth: 6 });
  });

  it("does not mark the current month missed when it is not paid yet", async () => {
    const h = await history();
    await h.series("Huur", [
      ["2026-06-28", -65000],
      ["2026-07-28", -65000],
      ["2026-08-28", -65000],
    ]);
    await h.cover("2026-06", "2026-07", "2026-08", "2026-09");
    const { item } = await acceptSuggestion(
      h.db,
      { key: "huur", type: "expense" },
      { today: TODAY },
    );
    expect((await h.occ(item.id, "2026-09")).status).toBe("expected");
  });

  it("refuses an unknown suggestion", async () => {
    const h = await netflix();
    await expect(
      acceptSuggestion(h.db, { key: "spotify", type: "expense" }, { today: TODAY }),
    ).rejects.toThrow(RecurringError);
    await expect(
      acceptSuggestion(h.db, { key: "netflix", type: "income" }, { today: TODAY }),
    ).rejects.toThrow(/no such suggestion/);
  });
});
