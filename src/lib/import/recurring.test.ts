import { readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { one, schema, type Db } from "@/db";
import { createRecurringItem, type RecurringItemInput } from "@/lib/recurring/items";
import { setup as baseSetup, snapshot } from "@/lib/recurring/test-utils";
import { ImportError, importCsv } from "./service";

const fixture = (name: string) =>
  readFileSync(path.join(process.cwd(), "tests/fixtures", name), "utf8");
const rabobank = async (db: Db, today?: string) =>
  await importCsv(db, { content: fixture("rabobank-sample.csv"), filename: "rabo.csv", today });

const REVOLUT_HEADER =
  "Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance";

/** An empty database (no account yet: the upload creates it) plus the recurring helpers. */
async function setup() {
  const s = await baseSetup();
  await s.db.delete(schema.accounts);
  const create = async (input: Partial<RecurringItemInput> & Pick<RecurringItemInput, "name">) =>
    await createRecurringItem(
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
  const txBy = async (counterparty: string) =>
    (await one(
      s.db
        .select()
        .from(schema.transactions)
        .where(eq(schema.transactions.counterparty, counterparty)),
    ))!;
  return { ...s, create, txBy };
}

describe("importCsv and recurring items", () => {
  it("flips occurrences to matched and links the transactions back", async () => {
    const { db, create, occ, txBy, cat } = await setup();
    const spotify = await create({ name: "Spotify", matchCounterparty: "spotify" });
    const rent = await create({
      name: "Huur",
      matchIban: "NL00BANK0000000011",
      expectedAmount: 65000,
      tolerance: 500,
      dayOfMonth: 1,
    });
    expect((await occ(spotify.id, "2026-09")).status).toBe("expected");

    const summary = await rabobank(db, "2026-10-11");
    expect(summary.recurring).toEqual({
      occurrencesCreated: 0,
      matched: 2,
      unlinked: 0,
      missed: 0,
    });

    const sp = await txBy("Spotify AB");
    const huur = await txBy("Verhuurder Voorbeeld BV");
    expect(await occ(spotify.id, "2026-09")).toMatchObject({
      status: "matched",
      transactionId: sp.id,
    });
    expect(await occ(rent.id, "2026-09")).toMatchObject({
      status: "matched",
      transactionId: huur.id,
    });
    expect(sp.matchedOccurrenceId).toBe((await occ(spotify.id, "2026-09")).id);
    expect(huur.matchedOccurrenceId).toBe((await occ(rent.id, "2026-09")).id);
    // Rules ran first; the items had no category to add.
    expect(sp.categoryId).toBe(await cat("Abonnementen"));
  });

  it("re-uploading the same file changes nothing", async () => {
    const { db, create } = await setup();
    await create({ name: "Spotify", matchCounterparty: "spotify" });
    await create({
      name: "Gym",
      matchCounterparty: "Basic-Fit",
      expectedAmount: 2999,
      dayOfMonth: 15,
    });
    await rabobank(db, "2026-10-11");
    const before = await snapshot(db);
    const again = await rabobank(db, "2026-10-11");
    expect(again.rowsImported).toBe(0);
    expect(again.recurring).toEqual({ occurrencesCreated: 0, matched: 0, unlinked: 0, missed: 0 });
    expect(await snapshot(db)).toEqual(before);
  });

  it("marks a missing payment missed only once its month is uploaded; a late upload rescues it", async () => {
    const { db, create, occ, txBy } = await setup();
    const gym = await createRecurringItem(
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
    expect((await occ(gym.id, "2026-09")).status).toBe("expected");
    await create({ name: "Spotify", matchCounterparty: "spotify" });

    expect((await rabobank(db, "2026-10-11")).recurring.missed).toBe(1);
    expect((await occ(gym.id, "2026-09")).status).toBe("missed");
    expect((await occ(gym.id, "2026-10")).status).toBe("expected"); // October is not uploaded

    // The gym was paid from Revolut, three days late; that upload comes in afterwards.
    const revolut = [
      REVOLUT_HEADER,
      "CARD_PAYMENT,Current,2026-09-18 07:00:00,2026-09-18 07:00:01,Basic-Fit,-29.99,0.00,EUR,COMPLETED,100.00",
    ].join("\n");
    const s = await importCsv(db, { content: revolut, filename: "rev.csv", today: "2026-10-11" });
    expect(s.recurring).toMatchObject({ matched: 1, missed: 0 });
    expect(await occ(gym.id, "2026-09")).toMatchObject({
      status: "matched",
      transactionId: (await txBy("Basic-Fit")).id,
    });
  });

  it("without today it still matches but never marks anything missed", async () => {
    const { db, create, occ } = await setup();
    const gym = await create({ name: "Gym", matchCounterparty: "Basic-Fit", dayOfMonth: 15 });
    const spotify = await create({ name: "Spotify", matchCounterparty: "spotify" });
    const s = await rabobank(db);
    expect(s.recurring).toMatchObject({ matched: 1, missed: 0 });
    expect((await occ(spotify.id, "2026-09")).status).toBe("matched");
    expect((await occ(gym.id, "2026-09")).status).toBe("expected");
  });

  it("plans occurrences through the month of the newest transaction", async () => {
    const { db, occurrences } = await setup();
    const item = await createRecurringItem(
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
    expect((await occurrences(item.id)).map((o) => o.month)).toEqual(["2026-07"]);
    const s = await rabobank(db, "2026-10-11");
    expect(s.recurring.occurrencesCreated).toBe(2);
    expect((await occurrences(item.id)).map((o) => [o.month, o.status])).toEqual([
      ["2026-07", "expected"], // July and August were never uploaded
      ["2026-08", "expected"],
      ["2026-09", "matched"],
    ]);
  });

  it("releases a match when the other side of a transfer shows up", async () => {
    const { db, create, occ } = await setup();
    // A (wrong) item that happens to match the 200 euro top-up to Revolut.
    const item = await create({
      name: "Sparen",
      matchCounterparty: "J. Student",
      expectedAmount: 20000,
      dayOfMonth: 12,
    });
    await rabobank(db, "2026-10-11");
    expect((await occ(item.id, "2026-09")).status).toBe("matched");
    const s = await importCsv(db, {
      content: fixture("revolut-sample.csv"),
      filename: "rev.csv",
      today: "2026-10-11",
    });
    expect(s.recurring.unlinked).toBe(1);
    expect(await occ(item.id, "2026-09")).toMatchObject({ status: "missed", transactionId: null });
  });

  it("rejects an invalid today", async () => {
    const { db } = await setup();
    await expect(rabobank(db, "11-10-2026")).rejects.toThrow(ImportError);
  });
});
