import { describe, expect, it } from "vitest";
import { schema } from "@/db";
import { coveredMonths } from "./occurrences";
import { setup } from "./test-utils";

describe("coveredMonths with a statement that stops a little before the month's end", () => {
  const upload = async (to: string) => {
    const { db, account } = await setup();
    await db.insert(schema.imports).values({
      accountId: account.id,
      month: "2026-10",
      filename: "s.pdf",
      periodFrom: "2026-01-01",
      periodTo: to,
    });
    return await coveredMonths(db);
  };

  it("a statement to 28 October (a Wednesday export) still covers October", async () => {
    const covered = await upload("2026-10-28");
    expect(covered.has("2026-10")).toBe(true);
    expect(covered.has("2026-09")).toBe(true);
  });

  it("one that stops a week short does not", async () => {
    const covered = await upload("2026-10-24");
    expect(covered.has("2026-10")).toBe(false);
    expect(covered.has("2026-09")).toBe(true);
  });
});
