import { eq } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { wipeMyData } from "@/lib/account";
import { ensureSavingsCategory, ensureTaxesCategory, seedDefaults } from "@/lib/categories/seed";
import { DEFAULT_CATEGORIES } from "@/lib/categories/defaults";
import { EXPORT_VERSION } from "@/lib/export";
import { BtwError, setBtwSettings } from "@/lib/btw/settings";
import { ForecastError } from "@/lib/forecast/errors";
import { setOwnSpending } from "@/lib/forecast/own";
import { SavingsError, setSavingsAnchor, setSavingsSettings } from "@/lib/savings/settings";

export class RestoreError extends Error {}

/** Biggest backup we accept: rows in all tables together. */
export const MAX_RESTORE_ROWS = 200_000;

type Row = Record<string, unknown>;
const CHUNK = 500;

const pick = (row: Row, keys: string[]): Row => {
  const out: Row = {};
  for (const k of keys) if (row[k] !== undefined && row[k] !== null) out[k] = row[k];
  return out;
};

function rowsOf(tables: Record<string, unknown>, name: string): Row[] {
  const v = tables[name];
  if (v === undefined) return [];
  if (
    !Array.isArray(v) ||
    !v.every((r) => typeof r === "object" && r !== null && !Array.isArray(r))
  )
    throw new RestoreError(`The backup has a broken "${name}" table.`);
  return v as Row[];
}

/**
 * Insert rows in chunks without their old ids (ids are shared by everyone, so the old ones may already
 * belong to someone else) and return old id -> new id. `fields` are the only columns taken from the file;
 * the owner is never taken from it.
 */
async function insertMapped(
  db: Db,
  table: Parameters<Db["insert"]>[0],
  rows: Row[],
  fields: string[],
  transform: (row: Row) => Row | null = (r) => r,
): Promise<Map<unknown, number>> {
  const map = new Map<unknown, number>();
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows
      .slice(i, i + CHUNK)
      .map((r) => ({
        old: r.id,
        row: transform(pick(r, fields)),
      }))
      .filter((x): x is { old: unknown; row: Row } => x.row !== null);
    if (chunk.length === 0) continue;
    const inserted = await db
      .insert(table)
      .values(chunk.map((x) => x.row) as never[])
      .returning({ id: (table as unknown as { id: never }).id });
    inserted.forEach((r, k) => map.set(chunk[k].old, (r as { id: number }).id));
  }
  return map;
}

/**
 * Replace what the current person has with the contents of a backup made by "Full backup" (version 1 or
 * 2). All ids are renumbered; links between rows (a payment and its fixed cost, a transaction and its
 * category) are kept. The smart-sorting settings and consent are not restored: those are a choice to make
 * again. The savings goal and the amount already saved are the person's own, so they are. Runs in one transaction (the caller's), so a broken file changes nothing.
 */
export async function restoreFromBackup(db: Db, backup: unknown): Promise<Record<string, number>> {
  const b = backup as { app?: unknown; version?: unknown; tables?: unknown } | null;
  if (
    !b ||
    (b.app !== "arnaq" && b.app !== "kasboek") ||
    typeof b.version !== "number" ||
    b.version < 1 ||
    b.version > EXPORT_VERSION
  )
    throw new RestoreError("This is not an arnaq backup, or it is from a newer version.");
  if (typeof b.tables !== "object" || b.tables === null || Array.isArray(b.tables))
    throw new RestoreError("The backup has no tables.");
  const t = b.tables as Record<string, unknown>;
  const names = [
    "accounts",
    "categories",
    "categorisationRules",
    "imports",
    "transactions",
    "recurringItems",
    "recurringOccurrences",
    "recurringSuggestionRejections",
    "budgets",
    "monthlyTotalBudget",
    "merchantLabels",
  ];
  const data = Object.fromEntries(names.map((n) => [n, rowsOf(t, n)])) as Record<string, Row[]>;
  const total = names.reduce((s, n) => s + data[n].length, 0);
  if (total > MAX_RESTORE_ROWS) throw new RestoreError("This backup is too large to restore here.");

  await wipeMyData(db);

  const account = await insertMapped(db, schema.accounts, data.accounts, [
    "name",
    "bank",
    "iban",
    "currency",
  ]);
  const slugOf = new Map(DEFAULT_CATEGORIES.map((c) => [c.name, c.slug]));
  const category = await insertMapped(
    db,
    schema.categories,
    data.categories,
    ["name", "type", "sortOrder", "slug"],
    (r) => ({
      ...r,
      // Older backups have no slug: the default categories get theirs back by name.
      slug: r.slug ?? slugOf.get(String(r.name)) ?? undefined,
    }),
  );
  if (data.categories.length === 0) await seedDefaults(db);

  const mapped = (m: Map<unknown, number>, id: unknown) => (id == null ? undefined : m.get(id));
  const withRef =
    (key: string, m: Map<unknown, number>, required: boolean) =>
    (r: Row): Row | null => {
      const to = mapped(m, r[key]);
      if (to === undefined && (required || r[key] != null))
        return required ? null : { ...r, [key]: undefined };
      return { ...r, [key]: to };
    };

  await insertMapped(
    db,
    schema.categorisationRules,
    data.categorisationRules,
    ["pattern", "categoryId", "priority"],
    withRef("categoryId", category, true),
  );
  const imports = await insertMapped(
    db,
    schema.imports,
    data.imports,
    [
      "accountId",
      "month",
      "periodFrom",
      "periodTo",
      "filename",
      "uploadedAt",
      "rowsTotal",
      "rowsImported",
      "rowsDuplicate",
      "rowsSkipped",
    ],
    withRef("accountId", account, true),
  );
  const items = await insertMapped(
    db,
    schema.recurringItems,
    data.recurringItems,
    [
      "name",
      "type",
      "matchCounterparty",
      "matchIban",
      "expectedAmount",
      "tolerance",
      "dayOfMonth",
      "frequency",
      "categoryId",
      "startDate",
      "endDate",
      "active",
    ],
    withRef("categoryId", category, false),
  );
  // A fixed cost's occurrence and the payment it matched point at each other: occurrences first
  // (without the payment), then transactions, then the link back.
  const occurrences = await insertMapped(
    db,
    schema.recurringOccurrences,
    data.recurringOccurrences,
    ["recurringItemId", "month", "expectedDate", "expectedAmount", "status"],
    withRef("recurringItemId", items, true),
  );
  const transactions = await insertMapped(
    db,
    schema.transactions,
    data.transactions,
    [
      "accountId",
      "importId",
      "date",
      "amount",
      "currency",
      "counterparty",
      "counterpartyIban",
      "description",
      "categoryId",
      "importHash",
      "matchedOccurrenceId",
      "isInternalTransfer",
      "categorySource",
      "suggestedCategoryId",
      "merchantKey",
      "balanceAfter",
    ],
    (r) => {
      const acct = mapped(account, r.accountId);
      if (acct === undefined) return null;
      return {
        ...r,
        accountId: acct,
        importId: mapped(imports, r.importId),
        categoryId: mapped(category, r.categoryId),
        suggestedCategoryId: mapped(category, r.suggestedCategoryId),
        matchedOccurrenceId: mapped(occurrences, r.matchedOccurrenceId),
      };
    },
  );
  for (const o of data.recurringOccurrences) {
    const newOcc = occurrences.get(o.id);
    const newTx = mapped(transactions, o.transactionId);
    if (newOcc !== undefined && newTx !== undefined)
      await db
        .update(schema.recurringOccurrences)
        .set({ transactionId: newTx })
        .where(eq(schema.recurringOccurrences.id, newOcc));
  }

  await insertMapped(db, schema.recurringSuggestionRejections, data.recurringSuggestionRejections, [
    "key",
    "type",
    "rejectedAt",
  ]);
  const budgets = data.budgets
    .map((r) => ({ ...pick(r, ["month", "amount"]), categoryId: mapped(category, r.categoryId) }))
    .filter((r) => r.categoryId !== undefined);
  for (let i = 0; i < budgets.length; i += CHUNK)
    await db.insert(schema.budgets).values(budgets.slice(i, i + CHUNK) as never[]);
  const totals = data.monthlyTotalBudget.map((r) => pick(r, ["month", "amount"]));
  for (let i = 0; i < totals.length; i += CHUNK)
    await db.insert(schema.monthlyTotalBudget).values(totals.slice(i, i + CHUNK) as never[]);
  // Learned shops are the person's own; what a model said is not restored (it can be asked again).
  await insertMapped(
    db,
    schema.merchantLabels,
    data.merchantLabels.filter((r) => r.source === "user"),
    ["merchantKey", "categoryId", "source"],
    withRef("categoryId", category, true),
  );

  // The savings goal and starting amount. A hand-edited or damaged value is skipped, not fatal.
  const settings = rowsOf(t, "userSettings")[0];
  if (settings) {
    const cents = (v: unknown) => (typeof v === "number" ? v : undefined);
    for (const change of [
      { start: cents(settings.savingsStart) },
      { goal: settings.savingsGoal === null ? null : cents(settings.savingsGoal) },
    ]) {
      try {
        await setSavingsSettings(db, change);
      } catch (e) {
        if (!(e instanceof SavingsError)) throw e;
      }
    }
    // The savings balance a statement reported (a hand-edited or damaged value is skipped, not fatal).
    if (
      typeof settings.savingsAnchor === "number" &&
      typeof settings.savingsAnchorDate === "string"
    ) {
      try {
        await setSavingsAnchor(db, {
          amount: settings.savingsAnchor,
          asOf: settings.savingsAnchorDate,
        });
      } catch (e) {
        if (!(e instanceof SavingsError)) throw e;
      }
    }
    // What they expect to spend each month (a damaged value is skipped, not fatal).
    if (typeof settings.forecastOwnSpending === "number") {
      try {
        await setOwnSpending(db, settings.forecastOwnSpending);
      } catch (e) {
        if (!(e instanceof ForecastError)) throw e;
      }
    }
    // Who the BTW is for and the pocket word (null or damaged: the defaults stay).
    const text = (v: unknown) => (typeof v === "string" ? v : undefined);
    try {
      await setBtwSettings(db, {
        client: text(settings.btwClient),
        pocket: text(settings.btwPocket),
      });
    } catch (e) {
      if (!(e instanceof BtwError)) throw e;
    }
  }
  // A backup from before the Savings category existed does not have it.
  await ensureSavingsCategory(db);
  await ensureTaxesCategory(db);

  return Object.fromEntries([
    ["accounts", account.size],
    ["categories", category.size],
    ["transactions", transactions.size],
    ["imports", imports.size],
    ["recurringItems", items.size],
    ["budgets", budgets.length],
  ]);
}
