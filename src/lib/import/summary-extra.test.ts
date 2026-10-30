import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDb } from "@/db";
import { importStatement } from "./service";

const statement = readFileSync(
  path.join(process.cwd(), "tests/fixtures/revolut-statement-sample.csv"),
  "utf8",
);

describe("what the upload reports back for the done screen", () => {
  it("says how many new rows were sorted on their own, how many are still open, and the newest date", async () => {
    const db = await createDb(":memory:");
    const s = await importStatement(db, { content: statement, filename: "s.csv" });
    expect(s.rowsImported).toBe(9);
    expect(s.sortedNow).toBeGreaterThan(0);
    expect(s.sortedNow).toBeLessThanOrEqual(9);
    expect(s.openAfter).toBeGreaterThanOrEqual(0);
    expect(s.latest).toBe("2026-10-09");
  });

  it("an upload with nothing new sorts nothing now, but still tells what is open and the newest date", async () => {
    const db = await createDb(":memory:");
    const first = await importStatement(db, { content: statement, filename: "s.csv" });
    const again = await importStatement(db, { content: statement, filename: "again.csv" });
    expect(again).toMatchObject({ rowsImported: 0, sortedNow: 0, latest: "2026-10-09" });
    expect(again.openAfter).toBe(first.openAfter);
  });
});
