import { beforeAll, describe, expect, it } from "vitest";
import { todayIso } from "@/lib/api";
import { addMonths, monthOf } from "@/lib/recurring/dates";
import type { Plan } from "@/lib/view/plan";

type Handlers = {
  plan: typeof import("./plan/route");
  recurring: typeof import("./recurring/route");
  categories: typeof import("./categories/route");
};
let h: Handlers;

beforeAll(async () => {
  process.env.DATABASE_URL = ":memory:";
  h = {
    plan: await import("./plan/route"),
    recurring: await import("./recurring/route"),
    categories: await import("./categories/route"),
  };
});

const req = (method: string, url: string, body?: unknown) =>
  new Request(`http://localhost${url}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const current = () => monthOf(todayIso());

describe("the plan over HTTP", () => {
  it("types a cell, shows it in the grid and in the totals, and clears it again", async () => {
    const cats = (await (await h.categories.GET()).json()) as { id: number; name: string }[];
    const groceries = cats.find((c) => c.name === "Boodschappen")!.id;
    const rent = (await (
      await h.recurring.POST(
        req("POST", "/api/recurring", {
          name: "Huur",
          type: "expense",
          expectedAmount: 100000,
          dayOfMonth: 1,
          startDate: `${current()}-01`,
          matchCounterparty: "Verhuurder",
        }),
      )
    ).json()) as { id: number };
    const next = addMonths(current(), 1);
    const get = async (q = "") => {
      const res = await h.plan.GET(req("GET", `/api/plan${q}`));
      expect(res.status).toBe(200);
      return (await res.json()) as Plan;
    };

    const before = await get("?months=3&basis=budget");
    expect(before.months).toHaveLength(4);
    expect(before.basis).toBe("budget");

    const put = (body: unknown) => h.plan.PUT(req("PUT", "/api/plan", body));
    let res = await put({ kind: "item", id: rent.id, month: next, amount: 120000, scope: "after" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { months: string[] }).months.at(-1)).toBe(
      addMonths(current(), 24),
    );
    res = await put({ kind: "category", id: groceries, month: next, amount: 5000, scope: "month" });
    expect(res.status).toBe(200);

    const after = await get("?months=3&basis=budget");
    const rentRow = after.sections.fixed.find((r) => r.key === `item-${rent.id}`)!;
    expect(rentRow.cells[1]).toMatchObject({ amount: 120000, source: "typed", suggestion: 100000 });
    const food = after.allCategories.find((r) => r.key === `category-${groceries}`)!;
    expect(food.cells[1]).toMatchObject({ amount: 5000, source: "typed" });
    expect(after.footer[1].expenses).toBe(before.footer[1].expenses + 20000 + 5000);

    // Clear the rent from the month after next on: only next month keeps the typed amount.
    res = await put({
      kind: "item",
      id: rent.id,
      month: addMonths(next, 1),
      amount: null,
      scope: "after",
    });
    expect(res.status).toBe(200);
    const cleared = await get("?months=3");
    const r = cleared.sections.fixed.find((x) => x.key === `item-${rent.id}`)!;
    expect(r.cells.map((c) => c.source)).toEqual(["item", "typed", "item", "item"]);
  });

  it("refuses what cannot be typed: past months, the BTW, bad amounts, unknown ids, a bad body", async () => {
    const cats = (await (await h.categories.GET()).json()) as { id: number; name: string }[];
    const groceries = cats.find((c) => c.name === "Boodschappen")!.id;
    const next = addMonths(current(), 1);
    const ok = { kind: "category", id: groceries, month: next, amount: 100, scope: "month" };
    const status = async (body: unknown) =>
      (await h.plan.PUT(req("PUT", "/api/plan", body))).status;
    for (const bad of [
      { month: addMonths(current(), -1) },
      { month: addMonths(current(), 25) },
      { month: "2026-13" },
      { kind: "btw" },
      { kind: "other" },
      { amount: -1 },
      { amount: 12.5 },
      { amount: "100" },
      { id: 2_147_483_647 },
      { id: 99_999_999_999 },
      { scope: "forever" },
    ])
      expect(await status({ ...ok, ...bad }), JSON.stringify(bad)).toBe(422);
    expect(await status([ok])).toBe(400);
    expect(await status(null)).toBe(400);
    expect(
      (await h.plan.PUT(new Request("http://localhost/api/plan", { method: "PUT", body: "{" })))
        .status,
    ).toBe(400);
    expect(await status(ok)).toBe(200);
  });

  it("refuses a horizon or basis it does not know", async () => {
    for (const q of ["?months=0", "?months=25", "?months=abc", "?basis=mine"])
      expect((await h.plan.GET(req("GET", `/api/plan${q}`))).status, q).toBe(422);
  });
});
