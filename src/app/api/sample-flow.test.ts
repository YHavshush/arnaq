import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

let sample: typeof import("./sample/route");
let upload: typeof import("./import/route");
let csvOut: typeof import("./export/csv/route");
beforeAll(async () => {
  process.env.DATABASE_URL = ":memory:";
  sample = await import("./sample/route");
  upload = await import("./import/route");
  csvOut = await import("./export/csv/route");
});

const loaded = async () => ((await (await sample.GET()).json()) as { loaded: boolean }).loaded;
const csv = () =>
  new File(
    [readFileSync(path.join(process.cwd(), "tests/fixtures/rabobank-sample.csv"))],
    "rabobank-sample.csv",
    {
      type: "text/csv",
    },
  );
const post = (file: File) => {
  const form = new FormData();
  form.set("file", file);
  return upload.POST(new Request("http://localhost/api/import", { method: "POST", body: form }));
};
const transactionsText = async () => await (await csvOut.GET()).text();

describe("sample data over HTTP (one account, in order)", () => {
  it("starts empty, loads on POST, shows in the export, and loading again adds nothing", async () => {
    expect(await loaded()).toBe(false);
    const res = await sample.POST();
    expect(res.status).toBe(201);
    expect((await res.json()).transactions).toBeGreaterThan(80);
    expect(await loaded()).toBe(true);
    expect(await transactionsText()).toContain("Basic-Fit");
    const again = await sample.POST();
    expect(again.status).toBe(201);
    expect((await again.json()).transactions).toBe(0);
  });

  it("an unusable file leaves the sample in place", async () => {
    const bad = await post(new File(["x,y\n1,2\n"], "bad.csv"));
    expect(bad.status).toBe(422);
    expect(await loaded()).toBe(true);
  });

  it("a real statement replaces the sample in one step", async () => {
    const res = await post(csv());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ rowsImported: 7 });
    expect(await loaded()).toBe(false);
    expect(await transactionsText()).not.toContain("Basic-Fit");
  });

  it("refuses the sample once real data exists, with a 422 and a message", async () => {
    const res = await sample.POST();
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBeTruthy();
  });

  it("DELETE with no sample data is harmless", async () => {
    const res = await sample.DELETE();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ removed: false });
  });
});
