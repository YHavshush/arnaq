import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { DEFAULT_BTW_INCOME_MATCH } from "@/lib/btw/defaults";
import { SENTINEL_OWNER } from "./claim";

/**
 * Migration 0013 moves the single BTW client (user_settings.btw_client and btw_payment_lag) into the btw_clients list.
 * Run the real migration files: everything up to 0012 first, add people as they were before, then 0013.
 */
const SOURCE = path.join(process.cwd(), "drizzle");
const TAG = "0013_btw_clients";
type Journal = { entries: { idx: number; tag: string }[] };

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** A migrations folder holding every migration before `tag` (or all of them). */
function folder(upTo?: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "arnaq-migrations-"));
  dirs.push(dir);
  mkdirSync(path.join(dir, "meta"));
  const journal = JSON.parse(
    readFileSync(path.join(SOURCE, "meta/_journal.json"), "utf8"),
  ) as Journal;
  const stop = upTo ? journal.entries.findIndex((e) => e.tag === upTo) : journal.entries.length;
  expect(stop).toBeGreaterThan(0);
  const entries = journal.entries.slice(0, stop);
  for (const e of entries)
    copyFileSync(path.join(SOURCE, `${e.tag}.sql`), path.join(dir, `${e.tag}.sql`));
  writeFileSync(path.join(dir, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
  return dir;
}

const U = (n: number) => `00000000-0000-0000-0000-00000000010${n}`;

describe("migration 0013: the single BTW client becomes the first entry of the list", () => {
  it("gives every person one client, exactly as the app read it before, and stays per person", async () => {
    const client = new PGlite();
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: folder(TAG) });

    // As the owner, before 0013: four people.
    for (let n = 1; n <= 4; n++)
      await client.query("insert into app_users (user_id) values ($1)", [U(n)]);
    // 1: their own client, paid a month later.
    await client.query(
      "insert into user_settings (user_id, btw_client, btw_payment_lag) values ($1, 'Acme BV', 1)",
      [U(1)],
    );
    // 2: a settings row without a client (smart sorting chosen, say): the default client.
    await client.query("insert into user_settings (user_id, smart_provider) values ($1, 'off')", [
      U(2),
    ]);
    // 3: no settings row at all: the default client, lag 0.
    // 4: no client but a lag: the default client with that lag.
    await client.query("insert into user_settings (user_id, btw_payment_lag) values ($1, 2)", [
      U(4),
    ]);

    await migrate(db, { migrationsFolder: folder() });

    const rows = (
      await client.query<{
        user_id: string;
        name: string;
        payment_lag: number;
        vat_percent: number;
      }>(
        // The migrations also made the sentinel owner (0003); it gets the default client like anyone else.
        "select user_id, name, payment_lag, vat_percent from btw_clients where user_id <> $1 order by user_id",
        [SENTINEL_OWNER],
      )
    ).rows;
    expect(rows).toEqual([
      { user_id: U(1), name: "Acme BV", payment_lag: 1, vat_percent: 21 },
      { user_id: U(2), name: DEFAULT_BTW_INCOME_MATCH, payment_lag: 0, vat_percent: 21 },
      { user_id: U(3), name: DEFAULT_BTW_INCOME_MATCH, payment_lag: 0, vat_percent: 21 },
      { user_id: U(4), name: DEFAULT_BTW_INCOME_MATCH, payment_lag: 2, vat_percent: 21 },
    ]);
    // The old columns stay where they were (not dropped, not cleared).
    const old = await client.query<{ btw_client: string | null; btw_payment_lag: number }>(
      "select btw_client, btw_payment_lag from user_settings where user_id = $1",
      [U(1)],
    );
    expect(old.rows).toEqual([{ btw_client: "Acme BV", btw_payment_lag: 1 }]);

    // As the app: a person sees and changes only their own clients.
    await client.exec("SET ROLE kasboek_app");
    await client.query("select set_config('app.user_id', $1, false)", [U(1)]);
    expect((await client.query("select name from btw_clients")).rows).toEqual([
      { name: "Acme BV" },
    ]);
    await client.query("update btw_clients set payment_lag = 0");
    await client.query("delete from btw_clients where name = $1", [DEFAULT_BTW_INCOME_MATCH]);
    // A new row is theirs, whatever it says.
    await client.query("insert into btw_clients (name) values ('Globex')");
    await expect(
      client.query("insert into btw_clients (user_id, name) values ($1, 'Sneaky')", [U(2)]),
    ).rejects.toThrow();
    // The same name in another case is refused.
    await expect(
      client.query("insert into btw_clients (name) values ('acme bv')"),
    ).rejects.toThrow();
    await client.exec("RESET ROLE");
    const after = (
      await client.query<{ user_id: string; name: string; payment_lag: number }>(
        "select user_id, name, payment_lag from btw_clients where user_id <> $1 order by user_id, name",
        [SENTINEL_OWNER],
      )
    ).rows;
    expect(after).toEqual([
      { user_id: U(1), name: "Acme BV", payment_lag: 0 },
      { user_id: U(1), name: "Globex", payment_lag: 0 },
      { user_id: U(2), name: DEFAULT_BTW_INCOME_MATCH, payment_lag: 0 },
      { user_id: U(3), name: DEFAULT_BTW_INCOME_MATCH, payment_lag: 0 },
      { user_id: U(4), name: DEFAULT_BTW_INCOME_MATCH, payment_lag: 2 },
    ]);
    await client.close();
  });
});
