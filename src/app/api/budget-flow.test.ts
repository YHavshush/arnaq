import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

type Handlers = {
  upload: typeof import("./import/route");
  overview: typeof import("./overview/route");
  budgets: typeof import("./budgets/route");
  review: typeof import("./review/route");
  category: typeof import("./transactions/[id]/category/route");
  categories: typeof import("./categories/route");
};
let h: Handlers;

beforeAll(async () => {
  process.env.DATABASE_URL = ":memory:";
  h = {
    upload: await import("./import/route"),
    overview: await import("./overview/route"),
    budgets: await import("./budgets/route"),
    review: await import("./review/route"),
    category: await import("./transactions/[id]/category/route"),
    categories: await import("./categories/route"),
  };
});

const json = (method: string, url: string, body: unknown) =>
  new Request(`http://localhost${url}`, { method, body: JSON.stringify(body) });

describe("import, review, budget and overview over HTTP", () => {
  it("runs the whole flow", async () => {
    const form = new FormData();
    form.set(
      "file",
      new File(
        [readFileSync(path.join(process.cwd(), "tests/fixtures/rabobank-sample.csv"))],
        "r.csv",
      ),
    );
    expect(
      (
        await h.upload.POST(
          new Request("http://localhost/api/import", { method: "POST", body: form }),
        )
      ).status,
    ).toBe(200);

    const cats = (await (await h.categories.GET()).json()) as { id: number; name: string }[];
    const id = (name: string) => cats.find((c) => c.name === name)!.id;

    // The two coffee rows are recognised by the built-in list (only the transfer without a Revolut side needs review).
    const review = (await (await h.review.GET()).json()) as { id: number }[];
    expect(review).toHaveLength(1);

    expect(
      (
        await h.budgets.PUT(
          json("PUT", "/b", { month: "2026-09", categoryId: id("Eten & drinken"), amount: 5000 }),
        )
      ).status,
    ).toBe(200);
    const o = await (
      await h.overview.GET(new Request("http://localhost/api/overview?month=2026-09"))
    ).json();
    const eten = o.expenses.find((l: { name: string }) => l.name === "Eten & drinken");
    expect(eten).toMatchObject({ budget: 5000, actual: 900, remaining: 4100 });
  });

  it("returns 422 for a bad month and 400 for a bad body", async () => {
    expect(
      (await h.overview.GET(new Request("http://localhost/api/overview?month=nope"))).status,
    ).toBe(422);
    expect((await h.budgets.PUT(json("PUT", "/b", { month: "2026-09" }))).status).toBe(400);
  });
});
