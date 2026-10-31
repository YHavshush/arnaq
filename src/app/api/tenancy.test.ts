// Proof that one user cannot see or change another user's data through any route or loader, and that
// a signed-out visitor gets nothing. Every route file must be listed here: a new route fails the guard
// test until someone decides how it is covered.
import { readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { TEST_USER_A, TEST_USER_B, schema } from "@/db";
import { buildExport } from "@/lib/export";
import { loadOverzicht, loadPrognose, loadUpload, loadVasteLasten } from "@/lib/view/load";
import { asTestUser, setTestUser } from "../../../tests/helpers/test-user";

type Handler = (req: Request, ctx?: { params: Promise<{ id: string }> }) => Promise<Response>;
type Route = Partial<Record<"GET" | "POST" | "PUT" | "PATCH" | "DELETE", Handler>>;

// Every route file under src/app/api, loaded by Vite.
const files = import.meta.glob<Route>("./**/route.ts");
const load = async (key: string) => await files[`./${key}/route.ts`]();

/** Route (relative to src/app/api) -> the methods it has. The guard below keeps this in sync. */
const ROUTES: Record<string, string[]> = {
  accounts: ["GET", "POST"],
  budgets: ["GET", "PUT"],
  "budgets/copy": ["POST"],
  "budgets/total": ["PUT"],
  categories: ["GET"],
  export: ["GET"],
  "export/csv": ["GET"],
  forecast: ["GET"],
  import: ["POST"],
  overview: ["GET"],
  recurring: ["GET", "POST"],
  "merchant-labels/[id]": ["DELETE"],
  "recurring/[id]": ["GET", "PATCH", "DELETE"],
  "recurring/sync": ["POST"],
  "smart/settings": ["GET", "PUT"],
  "savings/settings": ["GET", "PUT"],
  "btw/settings": ["GET", "PUT"],
  sample: ["GET", "POST", "DELETE"],
  "categorise/smart": ["POST"],
  "categorise/auto": ["POST"],
  "account/delete": ["POST"],
  "account/restore": ["POST"],
  "recurring/missed": ["GET"],
  "recurring/occurrences": ["GET"],
  "recurring/suggestions": ["GET"],
  "recurring/suggestions/accept": ["POST"],
  "recurring/suggestions/reject": ["POST"],
  review: ["GET"],
  rules: ["GET", "POST"],
  "rules/[id]": ["DELETE"],
  "transactions/[id]/category": ["PUT"],
  "transactions/[id]/undo": ["POST"],
  "transactions/confirm": ["POST"],
};

const TEST_USER_C = "00000000-0000-0000-0000-00000000000c"; // never given any data, for the sample test
const MARK = "TENANT-A-MARKER";
const MARK_IBAN = "NL00MARK0000000001";
const FIXTURE_NAME = "Koffie Voorbeeld"; // a counterparty in tests/fixtures/rabobank-sample.csv
const url = (p: string) => `http://localhost${p}`;
const json = (method: string, p: string, body: unknown) =>
  new Request(url(p), {
    method,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
const call = async (key: string, method: string, req: Request, id?: number) => {
  const handler = (await load(key))[method as keyof Route]!;
  return await handler(req, id === undefined ? undefined : ctx(id));
};

interface A {
  categoryId: number;
  itemId: number;
  ruleId: number;
  accountId: number;
  transactionId: number;
}
let a: A;
let exportOfA: string;

beforeAll(async () => {
  process.env.DATABASE_URL = ":memory:";
  setTestUser(TEST_USER_A);
  const ok = async (res: Response, status = 200) => {
    expect(res.status).toBe(status);
    return (await res.json()) as Record<string, unknown>;
  };

  const categories = (await (
    await call("categories", "GET", new Request(url("/api/categories")))
  ).json()) as { id: number; name: string }[];
  const categoryId = categories.find((c) => c.name === "Boodschappen")!.id;
  const account = await ok(
    await call(
      "accounts",
      "POST",
      json("POST", "/api/accounts", { name: `${MARK} account`, bank: "rabobank", iban: MARK_IBAN }),
    ),
    201,
  );
  const rule = (
    await ok(
      await call(
        "rules",
        "POST",
        json("POST", "/api/rules", { pattern: "tenant-a-marker", categoryId }),
      ),
      201,
    )
  ).rule as { id: number };
  await ok(
    await call(
      "budgets",
      "PUT",
      json("PUT", "/api/budgets", { month: "2026-09", categoryId, amount: 12345 }),
    ),
  );
  await ok(
    await call(
      "budgets/total",
      "PUT",
      json("PUT", "/api/budgets/total", { month: "2026-09", amount: 99999 }),
    ),
  );
  const item = await ok(
    await call(
      "recurring",
      "POST",
      json("POST", "/api/recurring", {
        name: `${MARK} item`,
        type: "expense",
        expectedAmount: 4242,
        dayOfMonth: 5,
        startDate: "2026-09-01",
        matchCounterparty: "tenant-a-marker",
      }),
    ),
    201,
  );
  await ok(
    await call(
      "recurring/suggestions/reject",
      "POST",
      json("POST", "/api/recurring/suggestions/reject", {
        key: "tenant-a-marker-rejected",
        type: "expense",
      }),
    ),
  );
  const form = new FormData();
  form.set(
    "file",
    new File(
      [readFileSync(path.join(process.cwd(), "tests/fixtures/rabobank-sample.csv"), "utf8")],
      "r.csv",
      { type: "text/csv" },
    ),
  );
  await ok(
    await call("import", "POST", new Request(url("/api/import"), { method: "POST", body: form })),
  );
  const review = (await (await call("review", "GET", new Request(url("/api/review")))).json()) as {
    id: number;
  }[];
  a = {
    categoryId,
    itemId: item.id as number,
    ruleId: rule.id,
    accountId: account.id as number,
    transactionId: review[0].id,
  };
  exportOfA = JSON.stringify((await asTestUser((db) => buildExport(db, new Date(0)))).tables);
});

describe("every route is accounted for", () => {
  it("lists exactly the route files that exist", () => {
    const found = Object.keys(files)
      .map((f) => f.replace(/^\.\//, "").replace(/\/route\.ts$/, ""))
      .sort();
    expect(Object.keys(ROUTES).sort()).toEqual(found);
  });

  it("lists exactly the methods each route exports", async () => {
    for (const [key, methods] of Object.entries(ROUTES)) {
      const mod = await load(key);
      const exported = (["GET", "POST", "PUT", "PATCH", "DELETE"] as const).filter(
        (m) => typeof mod[m] === "function",
      );
      expect(exported, key).toEqual(methods);
    }
  });
});

describe("user B sees nothing of user A", () => {
  beforeAll(() => setTestUser(TEST_USER_B));

  const gets = Object.entries(ROUTES)
    .filter(([, m]) => m.includes("GET"))
    .map(([k]) => k);

  it.each(gets)("GET %s contains none of A's data", async (key) => {
    const p =
      `/api/${key}`.replace("[id]", String(a.itemId)) +
      (key === "overview" ? "?month=2026-09" : "");
    const res = await call(
      key,
      "GET",
      new Request(url(p)),
      key.includes("[id]") ? a.itemId : undefined,
    );
    const text = await res.text();
    for (const secret of [MARK, MARK_IBAN, FIXTURE_NAME])
      expect(text, `${key} leaked ${secret}`).not.toContain(secret);
    if (key === "recurring/[id]") expect(res.status).toBe(404);
  });

  it("B has their own defaults and none of A's rows", async () => {
    const categories = (await (
      await call("categories", "GET", new Request(url("/api/categories")))
    ).json()) as unknown[];
    expect(categories.length).toBeGreaterThan(10);
    expect(await (await call("accounts", "GET", new Request(url("/api/accounts")))).json()).toEqual(
      [],
    );
    expect(await (await call("review", "GET", new Request(url("/api/review")))).json()).toEqual([]);
    expect(
      await (await call("recurring", "GET", new Request(url("/api/recurring")))).json(),
    ).toEqual([]);
  });

  it("the page loaders show nothing of A", async () => {
    const out = await asTestUser(async (db) =>
      JSON.stringify({
        o: await loadOverzicht(db, "2026-09", "2026-09-20", "en"),
        p: await loadPrognose(db, "2026-09-20", 6, "en"),
        v: await loadVasteLasten(db, "2026-09", "2026-09-20", "en"),
        u: await loadUpload(db),
      }),
    );
    for (const secret of [MARK, MARK_IBAN, FIXTURE_NAME]) expect(out).not.toContain(secret);
  });

  it("B's export has none of A's data", async () => {
    const text = JSON.stringify((await asTestUser((db) => buildExport(db, new Date(0)))).tables);
    for (const secret of [MARK, MARK_IBAN, FIXTURE_NAME]) expect(text).not.toContain(secret);
    const csv = await (await call("export/csv", "GET", new Request(url("/api/export/csv")))).text();
    expect(csv).not.toContain(FIXTURE_NAME);
  });
});

describe("user B cannot change A's data, even knowing its ids", () => {
  beforeAll(() => setTestUser(TEST_USER_B));

  it("recurring items: not found", async () => {
    expect((await call("recurring/[id]", "GET", new Request(url("/x")), a.itemId)).status).toBe(
      404,
    );
    expect(
      (await call("recurring/[id]", "PATCH", json("PATCH", "/x", { name: "hacked" }), a.itemId))
        .status,
    ).toBe(404);
    expect(
      (
        await call(
          "recurring/[id]",
          "DELETE",
          new Request(url("/x"), { method: "DELETE" }),
          a.itemId,
        )
      ).status,
    ).toBe(404);
  });

  it("A's transaction cannot be categorised, A's category cannot be used", async () => {
    const own = (
      (await (await call("categories", "GET", new Request(url("/api/categories")))).json()) as {
        id: number;
      }[]
    )[0].id;
    expect(
      (
        await call(
          "transactions/[id]/category",
          "PUT",
          json("PUT", "/x", { categoryId: own }),
          a.transactionId,
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await call(
          "rules",
          "POST",
          json("POST", "/api/rules", { pattern: "zzz", categoryId: a.categoryId }),
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await call(
          "budgets",
          "PUT",
          json("PUT", "/api/budgets", { month: "2026-09", categoryId: a.categoryId, amount: 1 }),
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await call(
          "recurring",
          "POST",
          json("POST", "/api/recurring", {
            name: "x",
            type: "expense",
            expectedAmount: 1,
            dayOfMonth: 1,
            startDate: "2026-09-01",
            matchCounterparty: "x",
            categoryId: a.categoryId,
          }),
        )
      ).status,
    ).toBe(422);
  });

  it("another user cannot undo or confirm A's automatic categories", async () => {
    // Make one of A's transactions automatic, as A; then back to the other user.
    setTestUser(TEST_USER_A);
    await asTestUser((db) =>
      db
        .update(schema.transactions)
        .set({ categoryId: a.categoryId, categorySource: "catalog" })
        .where(eq(schema.transactions.id, a.transactionId)),
    );
    setTestUser(TEST_USER_B);
    const undo = await call(
      "transactions/[id]/undo",
      "POST",
      json("POST", "/x", {}),
      a.transactionId,
    );
    expect((await undo.json()) as { changed: boolean }).toEqual({ changed: false });
    const confirm = await call(
      "transactions/confirm",
      "POST",
      json("POST", "/api/transactions/confirm", { ids: [a.transactionId] }),
    );
    expect((await confirm.json()) as { confirmed: number }).toEqual({ confirmed: 0 });
    setTestUser(TEST_USER_A);
    const still = await asTestUser((db) =>
      db.select().from(schema.transactions).where(eq(schema.transactions.id, a.transactionId)),
    );
    // Put A's row back as it was, for the checks that A's data is unchanged.
    await asTestUser((db) =>
      db
        .update(schema.transactions)
        .set({ categoryId: null, categorySource: null })
        .where(eq(schema.transactions.id, a.transactionId)),
    );
    setTestUser(TEST_USER_B);
    expect(still[0]).toMatchObject({ categoryId: a.categoryId, categorySource: "catalog" });
  });

  it("A's account cannot receive an upload; deleting A's rule changes nothing", async () => {
    const form = new FormData();
    form.set(
      "file",
      new File(
        [readFileSync(path.join(process.cwd(), "tests/fixtures/rabobank-sample.csv"), "utf8")],
        "r.csv",
      ),
    );
    form.set("accountId", String(a.accountId));
    expect(
      (
        await call(
          "import",
          "POST",
          new Request(url("/api/import"), { method: "POST", body: form }),
        )
      ).status,
    ).toBe(422);
    await call("rules/[id]", "DELETE", new Request(url("/x"), { method: "DELETE" }), a.ruleId);
  });

  it("B can use the same names, IBAN and files as A: nothing collides", async () => {
    expect(
      (
        await call(
          "accounts",
          "POST",
          json("POST", "/api/accounts", { name: "B", bank: "rabobank", iban: MARK_IBAN }),
        )
      ).status,
    ).toBe(201);
    const form = new FormData();
    form.set(
      "file",
      new File(
        [readFileSync(path.join(process.cwd(), "tests/fixtures/rabobank-sample.csv"), "utf8")],
        "r.csv",
      ),
    );
    const res = await call(
      "import",
      "POST",
      new Request(url("/api/import"), { method: "POST", body: form }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { rowsDuplicate: number }).rowsDuplicate).toBe(0); // not "already known": B's own rows
  });

  it("afterwards A's data is exactly as it was", async () => {
    setTestUser(TEST_USER_A);
    const now = JSON.stringify((await asTestUser((db) => buildExport(db, new Date(0)))).tables);
    expect(now).toBe(exportOfA);
    const rules = JSON.stringify(
      await (await call("rules", "GET", new Request(url("/api/rules")))).json(),
    );
    expect(rules).toContain("tenant-a-marker");
  });
});

describe("a signed-out visitor gets nothing", () => {
  beforeAll(() => setTestUser(null));

  const cases = Object.entries(ROUTES).flatMap(([key, methods]) =>
    methods.map((m) => [key, m] as const),
  );
  it.each(cases)("%s %s answers 401", async (key, method) => {
    const body = method === "GET" || method === "DELETE" ? undefined : JSON.stringify({});
    const req = new Request(url(`/api/${key}`), { method, body });
    const res = await call(key, method, req, key.includes("[id]") ? 1 : undefined);
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain(FIXTURE_NAME);
  });
});

describe("savings settings are per person", () => {
  it("B does not see A's goal, and A's stays", async () => {
    const get = async () =>
      await (
        await call("savings/settings", "GET", new Request(url("/api/savings/settings")))
      ).json();
    setTestUser(TEST_USER_A);
    expect(
      (
        await call(
          "savings/settings",
          "PUT",
          json("PUT", "/api/savings/settings", { goal: 123456, start: 7000 }),
        )
      ).status,
    ).toBe(200);
    expect(await get()).toMatchObject({ goal: 123456, start: 7000 });
    setTestUser(TEST_USER_B);
    expect(await get()).toMatchObject({ goal: null, start: 0 });
    setTestUser(TEST_USER_A);
    expect(await get()).toMatchObject({ goal: 123456, start: 7000 });
  });
});

describe("BTW settings are per person", () => {
  it("B keeps the defaults while A's client stays", async () => {
    const get = async () =>
      await (await call("btw/settings", "GET", new Request(url("/api/btw/settings")))).json();
    setTestUser(TEST_USER_A);
    expect(
      (
        await call(
          "btw/settings",
          "PUT",
          json("PUT", "/api/btw/settings", { client: "Acme", pocket: "Tax pot" }),
        )
      ).status,
    ).toBe(200);
    expect(await get()).toEqual({ client: "Acme", pocket: "Tax pot" });
    setTestUser(TEST_USER_B);
    expect(await get()).toEqual({ client: "Featurn", pocket: "BTW" });
    expect(
      (await call("btw/settings", "PUT", json("PUT", "/api/btw/settings", { client: 5 }))).status,
    ).toBe(422);
    setTestUser(TEST_USER_A);
    expect(await get()).toEqual({ client: "Acme", pocket: "Tax pot" });
  });
});

describe("sample data is per person", () => {
  it("C (empty) can load it, A never sees it, and clearing C's leaves A's data alone", async () => {
    const loadedFor = async () =>
      (
        (await (await call("sample", "GET", new Request(url("/api/sample")))).json()) as {
          loaded: boolean;
        }
      ).loaded;
    setTestUser(TEST_USER_C);
    expect(
      (await call("sample", "POST", new Request(url("/api/sample"), { method: "POST" }))).status,
    ).toBe(201);
    expect(await loadedFor()).toBe(true);
    setTestUser(TEST_USER_A);
    expect(await loadedFor()).toBe(false);
    // A has real data, so A cannot add the sample either.
    expect(
      (await call("sample", "POST", new Request(url("/api/sample"), { method: "POST" }))).status,
    ).toBe(422);
    setTestUser(TEST_USER_C);
    expect(
      (await call("sample", "DELETE", new Request(url("/api/sample"), { method: "DELETE" })))
        .status,
    ).toBe(200);
    expect(await loadedFor()).toBe(false);
    setTestUser(TEST_USER_A);
    const exportNow = await (await call("export", "GET", new Request(url("/api/export")))).text();
    expect(exportNow).toContain(MARK);
  });
});
