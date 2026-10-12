import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDb } from "@/db";
import { importCsv } from "@/lib/import/service";
import {
  HORIZONS,
  loadOverzicht,
  loadPrognose,
  loadUpload,
  loadVasteLasten,
  parseHorizon,
  parseMonth,
} from "./load";

const fixture = (n: string) => readFileSync(path.join(process.cwd(), "tests/fixtures", n), "utf8");

describe("parseMonth / parseHorizon", () => {
  it("accept only valid input", () => {
    expect(parseMonth("2026-10", "x")).toBe("2026-10");
    expect(parseMonth(["2026-02", "2026-03"], "x")).toBe("2026-02");
    for (const bad of ["2026-13", "2026-1", "abc", "", undefined, "1999-01", "2026-10-01"])
      expect(parseMonth(bad, "fallback")).toBe("fallback");
    expect(parseHorizon("12")).toBe(12);
    expect(parseHorizon("5")).toBe(6);
    expect(parseHorizon(undefined)).toBe(6);
    expect(HORIZONS).toContain(24);
  });
});

describe("screen loaders on an imported month", () => {
  async function seeded() {
    const db = await createDb(":memory:");
    await importCsv(db, {
      content: fixture("rabobank-sample.csv"),
      filename: "rabo.csv",
      today: "2026-09-20",
    });
    return db;
  }

  it("loadUpload: counts what is sorted and what still needs a category", async () => {
    const u = await loadUpload(await seeded());
    expect(u.total).toBe(7);
    expect(u.reviewCount + u.sorted).toBe(u.total);
    expect(u.share).toBeCloseTo(u.sorted / u.total);
    expect(u.imports).toHaveLength(1);
    expect(u.categories.every((c) => c.type !== "transfer")).toBe(true);
  });

  it("loadOverzicht, loadVasteLasten and loadPrognose run on real data and an empty database", async () => {
    const db = await seeded();
    const o = await loadOverzicht(db, "2026-09", "2026-09-20", "nl");
    expect(o.hasActivity).toBe(true);
    expect([o.prev, o.next]).toEqual(["2026-08", "2026-10"]);
    const v = await loadVasteLasten(db, "2026-09", "2026-09-20", "nl");
    expect(v.categories.length).toBeGreaterThan(5);
    const p = await loadPrognose(db, "2026-09-20", 3, "nl");
    expect(p.points.length).toBeGreaterThan(3);

    const empty = await createDb(":memory:");
    expect((await loadOverzicht(empty, "2026-09", "2026-09-20", "nl")).hasActivity).toBe(false);
    expect((await loadUpload(empty)).share).toBe(0);
    expect((await loadPrognose(empty, "2026-09-20", 6, "nl")).hasForecast).toBe(false);
  });
});
