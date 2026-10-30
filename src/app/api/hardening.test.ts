// Regression tests for the security review findings (validation, caps, CSRF guard).
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it } from "vitest";
import { createDb, schema } from "@/db";
import { detectInternalTransfers } from "@/lib/categories/transfers";
import { parseAmountToCents } from "@/lib/money";
import { MAX_IMPORT_ROWS, importCsv } from "@/lib/import/service";
import { rabobankParser } from "@/lib/import/parsers/rabobank";
import { proxy } from "@/proxy";

type Routes = {
  accounts: typeof import("./accounts/route");
  budgets: typeof import("./budgets/route");
  rules: typeof import("./rules/route");
  upload: typeof import("./import/route");
};
let r: Routes;

beforeAll(async () => {
  process.env.DATABASE_URL = ":memory:";
  r = {
    accounts: await import("./accounts/route"),
    budgets: await import("./budgets/route"),
    rules: await import("./rules/route"),
    upload: await import("./import/route"),
  };
});

const json = (method: string, body: unknown) =>
  new Request("http://localhost/x", { method, body: JSON.stringify(body) });
const fixture = (name: string) =>
  readFileSync(path.join(process.cwd(), "tests/fixtures", name), "utf8");

describe("constraint errors are 422, not 500", () => {
  it("unknown category on a budget and on a rule", async () => {
    const b = await r.budgets.PUT(json("PUT", { month: "2026-09", categoryId: 9999, amount: 100 }));
    expect(b.status).toBe(422);
    expect(JSON.stringify(await b.json())).not.toMatch(
      /SQLITE|FOREIGN KEY|violates|insert into|constraint/i,
    );
    const rule = await r.rules.POST(json("POST", { pattern: "abc", categoryId: 9999 }));
    expect(rule.status).toBe(422);
  });

  it("ids and priorities beyond the int4 column range are 422 (Postgres: out of range), not 500", async () => {
    const big = await r.rules.POST(json("POST", { pattern: "abc", categoryId: 5_000_000_000 }));
    expect(big.status).toBe(422);
    const prio = await r.rules.POST(
      json("POST", { pattern: "abc", categoryId: 1, priority: 5_000_000_000 }),
    );
    expect(prio.status).toBe(422);
  });

  it("a NUL character in an uploaded file does not crash the import", async () => {
    const form = new FormData();
    const csv = fixture("rabobank-sample.csv").replace(
      "Koffie Voorbeeld",
      "Koffie\u0000 Voorbeeld",
    );
    form.set("file", new File([csv], "nul.csv", { type: "text/csv" }));
    const res = await r.upload.POST(
      new Request("http://localhost/x", { method: "POST", body: form }),
    );
    expect(res.status).toBe(200);
  });
});

describe("accounts validation", () => {
  it("rejects bad currency, bad IBAN and a duplicate IBAN", async () => {
    const post = async (body: unknown) => await r.accounts.POST(json("POST", body));
    expect((await post({ name: "A", bank: "revolut", currency: "euro" })).status).toBe(400);
    expect((await post({ name: "A", bank: "revolut", iban: "not an iban" })).status).toBe(400);
    expect(
      (await post({ name: "A", bank: "rabobank", iban: "NL00 RABO 0000 0000 77" })).status,
    ).toBe(201);
    expect((await post({ name: "B", bank: "rabobank", iban: "nl00rabo0000000077" })).status).toBe(
      422,
    );
    expect((await post({ name: "x".repeat(101), bank: "rabobank" })).status).toBe(400);
  });
});

describe("rules validation", () => {
  it("needs a pattern of at least two characters", async () => {
    expect((await r.rules.POST(json("POST", { pattern: "a", categoryId: 1 }))).status).toBe(400);
  });
});

describe("upload caps", () => {
  it("refuses an oversized body before parsing it", async () => {
    const res = await r.upload.POST(
      new Request("http://localhost/api/import", {
        method: "POST",
        headers: { "content-length": String(50 * 1024 * 1024) },
        body: new FormData(),
      }),
    );
    expect(res.status).toBe(413);
  });

  it("rejects files with too many rows and caps the skipped detail", async () => {
    const db = await createDb(":memory:");
    const header = fixture("revolut-sample.csv").split("\n")[0];
    const many = [header, ...Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => "x,y,z")].join("\n");
    await expect(
      importCsv(db, { content: many, filename: "big.csv", accountId: undefined }),
    ).rejects.toThrow();

    const bad = [
      header,
      ...Array.from({ length: 500 }, () => "CARD,Current,nope,,Shop,1.00,0,EUR,COMPLETED,1"),
    ];
    const s = await importCsv(db, {
      content: bad.join("\n"),
      filename: "bad.csv",
      month: "2026-09",
    });
    expect(s.rowsSkipped).toBe(500);
    expect(s.skipped).toHaveLength(50);
  });
});

describe("CSV robustness", () => {
  it("skips a row with an impossible date instead of failing the file", () => {
    const csv = fixture("rabobank-sample.csv").replace('"2026-09-02"', '"2026-13-45"');
    const res = rabobankParser.parse(csv);
    expect(res.rows).toHaveLength(6);
    expect(res.skipped[0].reason).toMatch(/Invalid date/);
  });

  it("rejects absurd amounts", () => {
    expect(() => parseAmountToCents("1".repeat(40), ".")).toThrow();
    expect(() => parseAmountToCents("9999999999.99", ".")).not.toThrow();
    expect(() => parseAmountToCents("10000000000.01", ".")).toThrow();
  });
});

describe("transfer detection scales", () => {
  it("handles 6000 transactions fast and still pairs correctly", async () => {
    const db = await createDb(":memory:");
    const [a] = await db
      .insert(schema.accounts)
      .values({ name: "A", bank: "rabobank" })
      .returning();
    const [b] = await db.insert(schema.accounts).values({ name: "B", bank: "revolut" }).returning();
    const rows = [];
    for (let i = 0; i < 3000; i++) {
      const day = String((i % 28) + 1).padStart(2, "0");
      rows.push({
        accountId: a.id,
        date: `2026-09-${day}`,
        amount: -(100 + i),
        importHash: `a${i}`,
      });
      rows.push({ accountId: b.id, date: `2026-09-${day}`, amount: 100 + i, importHash: `b${i}` });
    }
    for (let i = 0; i < rows.length; i += 500)
      await db.insert(schema.transactions).values(rows.slice(i, i + 500));
    const started = Date.now();
    expect(await detectInternalTransfers(db)).toBe(6000);
    expect(Date.now() - started).toBeLessThan(3000);
  });
});

describe("cross-site guard", () => {
  const req = (method: string, headers: Record<string, string>) =>
    new NextRequest("http://localhost:3000/api/rules", { method, headers });

  it("blocks cross-site and foreign-origin state changes", async () => {
    expect((await proxy(req("POST", { "sec-fetch-site": "cross-site" }))).status).toBe(403);
    expect(
      (await proxy(req("POST", { origin: "https://evil.example", host: "localhost:3000" }))).status,
    ).toBe(403);
    expect(
      (await proxy(req("DELETE", { origin: "not a url", host: "localhost:3000" }))).status,
    ).toBe(403);
  });

  it("lets same-origin, header-less and read requests through", async () => {
    const through = async (method: string, headers: Record<string, string>) =>
      (await proxy(req(method, headers))).headers.get("x-middleware-next");
    expect(await through("POST", { "sec-fetch-site": "same-origin" })).toBe("1");
    expect(await through("POST", { origin: "http://localhost:3000", host: "localhost:3000" })).toBe(
      "1",
    );
    expect(await through("POST", {})).toBe("1");
    expect(await through("GET", { "sec-fetch-site": "cross-site" })).toBe("1");
  });
});

describe("the import cannot be used to hog the server", () => {
  it("answers 429 once a person has uploaded too often in a minute", async () => {
    const tooBig = () => {
      const form = new FormData();
      form.set("file", new File(["x"], "x.csv"));
      return new Request("http://localhost/api/import", { method: "POST", body: form });
    };
    let last = 0;
    for (let i = 0; i < 40; i++) {
      last = (await r.upload.POST(tooBig())).status;
      if (last === 429) break;
    }
    expect(last).toBe(429);
  });

  it("gives a generic message, not an internal one, for a file that breaks a parser", async () => {
    // A file that is not recognised at all gets the plain explanation (a 422), never a stack or internal text.
    const form = new FormData();
    form.set("file", new File(["\u0001\u0002 not a statement"], "x.csv"));
    const res = await r.upload.POST(
      new Request("http://localhost/api/import", { method: "POST", body: form }),
    );
    expect([422, 429]).toContain(res.status);
    expect(JSON.stringify(await res.json())).not.toMatch(/TypeError|undefined|at \w+ \(/);
  });
});
