import { beforeAll, describe, expect, it } from "vitest";

let route: typeof import("./savings/settings/route");
beforeAll(async () => {
  process.env.DATABASE_URL = ":memory:";
  route = await import("./savings/settings/route");
});

const put = (body: unknown) =>
  new Request("http://localhost/api/savings/settings", {
    method: "PUT",
    body: JSON.stringify(body),
  });

describe("savings settings over HTTP", () => {
  it("starts empty, saves a goal and a starting amount, and clears the goal", async () => {
    expect(await (await route.GET()).json()).toEqual({ goal: null, start: 0 });
    const saved = await route.PUT(put({ goal: 500000, start: 120000 }));
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ goal: 500000, start: 120000 });
    expect(await (await route.GET()).json()).toEqual({ goal: 500000, start: 120000 });
    expect(await (await route.PUT(put({ goal: null }))).json()).toEqual({
      goal: null,
      start: 120000,
    });
  });

  it("answers 422 to nonsense, with a message", async () => {
    for (const body of [
      { goal: 0 },
      { goal: -1 },
      { goal: "100" },
      { start: -5 },
      { start: 1.5 },
      { start: "abc" },
    ]) {
      const res = await route.PUT(put(body));
      expect(res.status, JSON.stringify(body)).toBe(422);
      expect((await res.json()).error).toBeTruthy();
    }
  });

  it("answers 400 when the body is not an object", async () => {
    for (const body of [null, [1], "x"])
      expect((await route.PUT(put(body))).status, String(body)).toBe(400);
  });
});
