import { readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { schema, type Db } from "@/db";
import { createRecurringItem, type RecurringItemInput } from "@/lib/recurring/items";
import { setup as baseSetup, snapshot } from "@/lib/recurring/test-utils";
import { ImportError, importCsv } from "./service";

const fixture = (name: string) =>
  readFileSync(path.join(process.cwd(), "tests/fixtures", name), "utf8");
const rabobank = (db: Db, today?: string) =>
  importCsv(db, { content: fixture("rabobank-sample.csv"), filename: "rabo.csv", today });

const REVOLUT_HEADER =
  "Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance";

/** An empty database (no account yet: the upload creates it) plus the recurring helpers. */
function setup() {
  const s = baseSetup();
  s.db.delete(schema.accounts).run();
  const create = (input: Partial<RecurringItemInput> & Pick<RecurringItemInput, "name">) =>
    createRecurringItem(
      s.db,
      {
        type: "expense",
        expectedAmount: 999,
        dayOfMonth: 10,
        startDate: "2026-09-01",
        ...input,
      },
      { today: "2026-09-01" },
    );
  const txBy = (counterparty: string) =>
    s.db
      .select()
      .from(schema.transactions)
      .where(eq(schema.transactions.counterparty, counterparty))
      .get()!;
  return { ...s, create, txBy };
}

describe("importCsv and recurring items", () => {
  it("flips occurrences to matched and links the transactions back", () => {
    const { db, create, occ, txBy, cat } = setup();
    const spotify = create({ name: "Spotify", matchCounterparty: "spotify" });
    const rent = create({
      name: "Huur",
      matchIban: "NL00BANK0000000011",
      expectedAmount: 65000,
      tolerance: 500,
      dayOfMonth: 1,
    });
    expect(occ(spotify.id, "2026-09").status).toBe("expected");

    const summary = rabobank(db, "2026-10-11");
    expect(summary.recurring).toEqual({
      occurrencesCreated: 0,
      matched: 2,
      unlinked: 0,
      missed: 0,
    });

    const sp = txBy("Spotify AB");
    const huur = txBy("Verhuurder Voorbeeld BV");
    expect(occ(spotify.id, "2026-09")).toMatchObject({ status: "matched", transactionId: sp.id });
    expect(occ(rent.id, "2026-09")).toMatchObject({ status: "matched", transactionId: huur.id });
    expect(sp.matchedOccurrenceId).toBe(occ(spotify.id, "2026-09").id);
    expect(huur.matchedOccurrenceId).toBe(occ(rent.id, "2026-09").id);
    // Rules ran first; the items had no category to add.
    expect(sp.categoryId).toBe(cat("Abonnementen"));
  });

  it("re-uploading the same file changes nothing", () => {
    const { db, create } = setup();
    create({ name: "Spotify", matchCounterparty: "spotify" });
    create({ name: "Gym", matchCounterparty: "Basic-Fit", expectedAmount: 2999, dayOfMonth: 15 });
    rabobank(db, "2026-10-11");
    const before = snapshot(db);
    const again = rabobank(db, "2026-10-11");
    expect(again.rowsImported).toBe(0);
    expect(again.recurring).toEqual({ occurrencesCreated: 0, matched: 0, unlinked: 0, missed: 0 });
    expect(snapshot(db)).toEqual(before);
  });

  it("marks a missing payment missed only once its month is uploaded; a late upload rescues it", () => {
    const { db, create, occ, txBy } = setup();
    const gym = createRecurringItem(
      db,
      {
        name: "Gym",
        type: "expense",
        matchCounterparty: "Basic-Fit",
        expectedAmount: 2999,
        dayOfMonth: 15,
        startDate: "2026-09-01",
      },
      { today: "2026-10-11" },
    );
    // September has not been uploaded: no cry wolf, even though the window has passed.
    expect(occ(gym.id, "2026-09").status).toBe("expected");
    create({ name: "Spotify", matchCounterparty: "spotify" });

    expect(rabobank(db, "2026-10-11").recurring.missed).toBe(1);
    expect(occ(gym.id, "2026-09").status).toBe("missed");
    expect(occ(gym.id, "2026-10").status).toBe("expected"); // October is not uploaded

    // The gym was paid from Revolut, three days late; that upload comes in afterwards.
    const revolut = [
      REVOLUT_HEADER,
      "CARD_PAYMENT,Current,2026-09-18 07:00:00,2026-09-18 07:00:01,Basic-Fit,-29.99,0.00,EUR,COMPLETED,100.00",
    ].join("\n");
    const s = importCsv(db, { content: revolut, filename: "rev.csv", today: "2026-10-11" });
    expect(s.recurring).toMatchObject({ matched: 1, missed: 0 });
    expect(occ(gym.id, "2026-09")).toMatchObject({
      status: "matched",
      transactionId: txBy("Basic-Fit").id,
    });
  });

  it("without today it still matches but never marks anything missed", () => {
    const { db, create, occ } = setup();
    const gym = create({ name: "Gym", matchCounterparty: "Basic-Fit", dayOfMonth: 15 });
    const spotify = create({ name: "Spotify", matchCounterparty: "spotify" });
    const s = rabobank(db);
    expect(s.recurring).toMatchObject({ matched: 1, missed: 0 });
    expect(occ(spotify.id, "2026-09").status).toBe("matched");
    expect(occ(gym.id, "2026-09").status).toBe("expected");
  });

  it("plans occurrences through the month of the newest transaction", () => {
    const { db, occurrences } = setup();
    const item = createRecurringItem(
      db,
      {
        name: "Spotify",
        type: "expense",
        matchCounterparty: "spotify",
        expectedAmount: 999,
        dayOfMonth: 10,
        startDate: "2026-07-01",
      },
      { today: "2026-07-01" },
    );
    expect(occurrences(item.id).map((o) => o.month)).toEqual(["2026-07"]);
    const s = rabobank(db, "2026-10-11");
    expect(s.recurring.occurrencesCreated).toBe(2);
    expect(occurrences(item.id).map((o) => [o.month, o.status])).toEqual([
      ["2026-07", "expected"], // July and August were never uploaded
      ["2026-08", "expected"],
      ["2026-09", "matched"],
    ]);
  });

  it("releases a match when the other side of a transfer shows up", () => {
    const { db, create, occ } = setup();
    // A (wrong) item that happens to match the 200 euro top-up to Revolut.
    const item = create({
      name: "Sparen",
      matchCounterparty: "J. Student",
      expectedAmount: 20000,
      dayOfMonth: 12,
    });
    rabobank(db, "2026-10-11");
    expect(occ(item.id, "2026-09").status).toBe("matched");
    const s = importCsv(db, {
      content: fixture("revolut-sample.csv"),
      filename: "rev.csv",
      today: "2026-10-11",
    });
    expect(s.recurring.unlinked).toBe(1);
    expect(occ(item.id, "2026-09")).toMatchObject({ status: "missed", transactionId: null });
  });

  it("rejects an invalid today", () => {
    const { db } = setup();
    expect(() => rabobank(db, "11-10-2026")).toThrow(ImportError);
  });
});
