// Regression tests for the milestone 4 code review and security review findings.
import { describe, expect, it } from "vitest";
import { MAX_CENTS } from "@/lib/money";
import { isInt } from "@/lib/api";
import { MAX_ITEMS, RecurringError, createRecurringItem, updateRecurringItem } from "./items";
import { markMissed, planOccurrences } from "./occurrences";
import { matchOccurrences } from "./matching";
import { generateOccurrences } from "./occurrences";
import { setup } from "./test-utils";

const base = {
  name: "Rent",
  type: "expense" as const,
  matchCounterparty: "Landlord",
  expectedAmount: 65000,
  dayOfMonth: 3,
  startDate: "2026-01-01",
};

describe("markMissed with rent early in the month", () => {
  it("judges the first uploaded month even though the window reaches back before the first upload", async () => {
    const s = await setup();
    const item = await s.addItem({ name: "Rent", matchCounterparty: "Landlord", dayOfMonth: 3 });
    await s.cover("2026-01", "2026-02", "2026-03");
    await generateOccurrences(s.db, { throughMonth: "2026-03" });
    await markMissed(s.db, { today: "2026-06-01" });
    expect((await s.occ(item.id, "2026-01")).status).toBe("missed");
    expect((await s.occ(item.id, "2026-02")).status).toBe("missed");
    expect((await s.occ(item.id, "2026-03")).status).toBe("missed");
  });

  it("still waits when a month inside the data is missing", async () => {
    const s = await setup();
    const item = await s.addItem({ dayOfMonth: 3, matchCounterparty: "Landlord" });
    await s.cover("2026-01", "2026-03"); // February was never uploaded
    await generateOccurrences(s.db, { throughMonth: "2026-03" });
    await markMissed(s.db, { today: "2026-06-01" });
    expect((await s.occ(item.id, "2026-02")).status).toBe("expected"); // own month not uploaded
    expect((await s.occ(item.id, "2026-03")).status).toBe("expected"); // window reaches into the gap
  });

  it("does not judge a month that is not uploaded yet, even long after", async () => {
    const s = await setup();
    const item = await s.addItem({ dayOfMonth: 15 });
    await s.cover("2026-01");
    await generateOccurrences(s.db, { throughMonth: "2026-02" });
    await markMissed(s.db, { today: "2026-06-01" });
    expect((await s.occ(item.id, "2026-02")).status).toBe("expected");
  });
});

describe("editing the day of month keeps history", () => {
  it("does not delete a past, unmatched occurrence when the day moves earlier", async () => {
    const s = await setup();
    const item = await createRecurringItem(
      s.db,
      { ...base, dayOfMonth: 20, startDate: "2026-01-15" },
      { today: "2026-02-25" },
    );
    await s.cover("2026-01", "2026-02");
    await markMissed(s.db, { today: "2026-02-25" });
    expect((await s.occ(item.id, "2026-01")).status).toBe("missed");
    await updateRecurringItem(s.db, item.id, { dayOfMonth: 10 }, { today: "2026-03-10" });
    expect(await s.occ(item.id, "2026-01")).toMatchObject({
      status: "missed",
      expectedDate: "2026-01-20",
    });
  });

  it("still drops past occurrences when the start date moves past them", async () => {
    const s = await setup();
    const item = await createRecurringItem(
      s.db,
      { ...base, startDate: "2026-01-01" },
      { today: "2026-03-10" },
    );
    await updateRecurringItem(s.db, item.id, { startDate: "2026-03-01" }, { today: "2026-03-10" });
    expect((await s.occurrences(item.id)).map((o) => o.month)).toEqual(["2026-03"]);
  });
});

describe("input limits", () => {
  const today = "2026-03-10";
  it("rejects absurd start and end dates (one request must not create thousands of occurrences)", async () => {
    const s = await setup();
    await expect(
      createRecurringItem(s.db, { ...base, startDate: "0001-01-01" }, { today }),
    ).rejects.toThrow(RecurringError);
    await expect(
      createRecurringItem(s.db, { ...base, endDate: "9999-12-31" }, { today }),
    ).rejects.toThrow(/moet tussen/);
    const ok = await createRecurringItem(s.db, { ...base, startDate: "2000-01-01" }, { today });
    expect((await s.occurrences(ok.id)).length).toBeLessThan(400);
  });

  it("rejects non-safe and out-of-range amounts", async () => {
    const s = await setup();
    for (const expectedAmount of [1e300, MAX_CENTS + 1, 2 ** 53, 0.5, -1]) {
      await expect(
        createRecurringItem(s.db, { ...base, expectedAmount }, { today }),
      ).rejects.toThrow(RecurringError);
    }
    await expect(
      createRecurringItem(s.db, { ...base, tolerance: 1e300 }, { today }),
    ).rejects.toThrow(RecurringError);
    expect(isInt(1e300)).toBe(false);
    expect(isInt(5)).toBe(true);
  });

  it("limits name length and the number of items", async () => {
    const s = await setup();
    await expect(
      createRecurringItem(s.db, { ...base, name: "x".repeat(201) }, { today }),
    ).rejects.toThrow(/te lang/);
    // Seed directly: creating through the API re-syncs everything each time.
    for (let i = 0; i < MAX_ITEMS; i++)
      await s.addItem({ name: `Item ${i}`, startDate: "2026-03-01" });
    await expect(createRecurringItem(s.db, base, { today })).rejects.toThrow(/maximaal/);
  });
});

describe("matching scales", () => {
  it("matches 24 items against ~10k transactions quickly and gives the same answer as before", async () => {
    const s = await setup();
    const items = [];
    for (let i = 0; i < 24; i++)
      items.push(
        await s.addItem({
          name: `Item ${i}`,
          matchCounterparty: `Shop${i}`,
          expectedAmount: 1000 + i,
          dayOfMonth: 5,
          startDate: "2021-01-01",
        }),
      );
    // One real payment per item per month, plus lots of unrelated noise.
    for (let y = 2021; y <= 2025; y++)
      for (let m = 1; m <= 12; m++)
        for (const [i] of items.entries())
          await s.tx(`${y}-${String(m).padStart(2, "0")}-05`, -(1000 + i), {
            counterparty: `Shop${i}`,
          });
    for (let d = 0; d < 3000; d++)
      await s.tx(
        `2023-${String((d % 12) + 1).padStart(2, "0")}-${String((d % 27) + 1).padStart(2, "0")}`,
        -77,
        {
          counterparty: "Noise",
        },
      );
    await generateOccurrences(s.db, { throughMonth: "2025-12" });
    const started = Date.now();
    const result = await matchOccurrences(s.db);
    expect(result.matched).toBe(24 * 60);
    // Guards against quadratic matching (that took minutes); generous because CI and laptops get busy.
    expect(Date.now() - started).toBeLessThan(8000);
    expect(planOccurrences(items[0], { throughMonth: "2025-12" })).toHaveLength(60);
  });
});
