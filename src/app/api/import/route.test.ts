import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

let POST: typeof import("./route").POST;

beforeAll(async () => {
  process.env.DATABASE_URL = ":memory:";
  ({ POST } = await import("./route"));
});

const upload = (fields: Record<string, string | File>) => {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return POST(new Request("http://localhost/api/import", { method: "POST", body: form }));
};
const csv = (name: string) =>
  new File([readFileSync(path.join(process.cwd(), "tests/fixtures", name))], name, {
    type: "text/csv",
  });

describe("POST /api/import", () => {
  it("imports a file and reports counts, then reports duplicates on re-upload", async () => {
    const first = await upload({ file: csv("rabobank-sample.csv") });
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ bank: "rabobank", rowsImported: 7 });

    const second = await upload({ file: csv("rabobank-sample.csv") });
    expect(await second.json()).toMatchObject({ rowsImported: 0, rowsDuplicate: 7 });
  });

  it("returns 400 without a file and 422 for an unreadable CSV", async () => {
    expect((await upload({ month: "2026-09" })).status).toBe(400);
    const bad = await upload({ file: new File(["x,y\n1,2\n"], "bad.csv") });
    expect(bad.status).toBe(422);
  });
});
