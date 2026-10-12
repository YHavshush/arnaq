import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { first, schema, type Db } from "@/db";
import { applyRules } from "@/lib/categories/categorise";
import { detectInternalTransfers } from "@/lib/categories/transfers";
import { isDate } from "@/lib/recurring/dates";
import { latestTransactionMonth, syncRecurring, type SyncResult } from "@/lib/recurring/sync";
import { detectBank, getParser } from "./parsers";
import type { Bank, ParsedRow, SkippedRow } from "./types";

export interface ImportInput {
  content: string;
  filename: string;
  /** Explicit account. If omitted, the account is resolved from the file (bank + IBAN). */
  accountId?: number;
  /** YYYY-MM label for the import. If omitted, the dominant month in the file is used. */
  month?: string;
  /**
   * Today (YYYY-MM-DD), used to decide which recurring occurrences are overdue (missed).
   * Without it, occurrences are still generated and matched but nothing is marked missed.
   */
  today?: string;
}

export interface ImportSummary {
  importId: number;
  accountId: number;
  bank: Bank;
  month: string;
  rowsTotal: number;
  rowsImported: number;
  rowsDuplicate: number;
  rowsSkipped: number;
  skipped: SkippedRow[];
  /** Rows imported in a currency other than the account currency; kept out of EUR totals. */
  foreignCurrencyRows: number;
  warnings: string[];
  /** What the upload did to recurring items: occurrences planned, matched, missed. */
  recurring: SyncResult;
}

export class ImportError extends Error {}

/** A bank export for one month is far below this; more rows means the wrong file. */
export const MAX_IMPORT_ROWS = 20_000;
/** Detail for at most this many skipped rows goes back to the client (the count is always exact). */
const MAX_SKIPPED_DETAIL = 50;
const INSERT_CHUNK = 500;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Hash that identifies a transaction across re-uploads. Identical rows in one file get a counter. */
export function buildImportHashes(accountId: number, rows: ParsedRow[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const base = [accountId, row.sourceKey, row.date, row.amount, row.currency].join("|");
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return createHash("sha256").update(`${base}|#${n}`).digest("hex");
  });
}

function dominantMonth(rows: ParsedRow[]): string | null {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.date.slice(0, 7), (counts.get(r.date.slice(0, 7)) ?? 0) + 1);
  return (
    [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null
  );
}

async function resolveAccount(db: Db, bank: Bank, identifier: string | null): Promise<number> {
  const accounts = await db.select().from(schema.accounts).where(eq(schema.accounts.bank, bank));
  if (identifier) {
    const byIban = accounts.find((a) => a.iban === identifier);
    if (byIban) return byIban.id;
    const [created] = await db
      .insert(schema.accounts)
      .values({
        name: `${bank === "rabobank" ? "Rabobank" : "Revolut"} ${identifier}`,
        bank,
        iban: identifier,
      })
      .returning();
    return created.id;
  }
  if (accounts.length === 1) return accounts[0].id;
  if (accounts.length === 0) {
    const [created] = await db
      .insert(schema.accounts)
      .values({ name: bank === "rabobank" ? "Rabobank" : "Revolut", bank })
      .returning();
    return created.id;
  }
  throw new ImportError(`Several ${bank} accounts exist, pick one with accountId.`);
}

export async function importCsv(db: Db, input: ImportInput): Promise<ImportSummary> {
  if (input.month && !MONTH_RE.test(input.month))
    throw new ImportError(`Invalid month "${input.month}", use YYYY-MM.`);
  if (input.today !== undefined && !isDate(input.today))
    throw new ImportError(`Invalid date "${input.today}", use YYYY-MM-DD.`);

  const detected = detectBank(input.content);
  let bank: Bank;
  let accountId = input.accountId;
  if (accountId !== undefined) {
    const account = await first(
      db.select().from(schema.accounts).where(eq(schema.accounts.id, accountId)),
    );
    if (!account) throw new ImportError(`Account ${accountId} does not exist.`);
    bank = account.bank;
    if (detected && detected !== bank) {
      throw new ImportError(
        `This looks like a ${detected} file but account ${accountId} is ${bank}.`,
      );
    }
  } else {
    if (!detected)
      throw new ImportError("Could not recognise this CSV as a Rabobank or Revolut export.");
    bank = detected;
  }

  let parsed;
  try {
    parsed = getParser(bank).parse(input.content);
  } catch (e) {
    throw new ImportError(e instanceof Error ? e.message : String(e));
  }
  if (parsed.rows.length + parsed.skipped.length > MAX_IMPORT_ROWS)
    throw new ImportError(`Too many rows (max ${MAX_IMPORT_ROWS} per file).`);
  if (parsed.rows.length === 0 && parsed.skipped.length === 0)
    throw new ImportError("The file contains no transactions.");

  const warnings: string[] = [];
  const month = input.month ?? dominantMonth(parsed.rows);
  if (!month)
    throw new ImportError(
      "No importable rows found, so the month cannot be detected. Pass a month.",
    );
  const outside = parsed.rows.filter((r) => r.date.slice(0, 7) !== month).length;
  if (outside > 0)
    warnings.push(`${outside} row(s) fall outside ${month}; they were imported anyway.`);

  return await db.transaction(async (tx) => {
    accountId ??= await resolveAccount(tx, bank, parsed.accountIdentifier);
    const account = (await first(
      tx.select().from(schema.accounts).where(eq(schema.accounts.id, accountId)),
    ))!;

    const [imp] = await tx
      .insert(schema.imports)
      .values({ accountId, month, filename: input.filename })
      .returning();

    const hashes = buildImportHashes(accountId, parsed.rows);
    let imported = 0;
    let foreign = 0;
    // Insert in chunks; rows whose hash already exists are skipped and not returned.
    for (let from = 0; from < parsed.rows.length; from += INSERT_CHUNK) {
      const chunk = parsed.rows.slice(from, from + INSERT_CHUNK);
      const inserted = new Set(
        (
          await tx
            .insert(schema.transactions)
            .values(
              chunk.map((row, j) => ({
                accountId: account.id,
                importId: imp.id,
                date: row.date,
                amount: row.amount,
                currency: row.currency,
                counterparty: row.counterparty,
                counterpartyIban: row.counterpartyIban,
                description: row.description,
                importHash: hashes[from + j],
              })),
            )
            .onConflictDoNothing({ target: schema.transactions.importHash })
            .returning({ importHash: schema.transactions.importHash })
        ).map((r) => r.importHash),
      );
      chunk.forEach((row, j) => {
        if (!inserted.has(hashes[from + j])) return;
        imported++;
        if (row.currency !== account.currency) foreign++;
      });
    }

    const duplicate = parsed.rows.length - imported;
    await tx
      .update(schema.imports)
      .set({
        rowsTotal: parsed.rows.length + parsed.skipped.length,
        rowsImported: imported,
        rowsDuplicate: duplicate,
        rowsSkipped: parsed.skipped.length,
      })
      .where(and(eq(schema.imports.id, imp.id)));

    // New rows get categorised and own-account transfers are flagged straight away.
    await detectInternalTransfers(tx);
    await applyRules(tx, { importId: imp.id });
    // Then recurring items: plan through the newest data, match, and flag what is overdue.
    // Rules ran first, so an item's category only fills in what the rules left open.
    const recurring = await syncRecurring(tx, {
      throughMonth: await latestTransactionMonth(tx),
      today: input.today,
    });

    if (foreign > 0)
      warnings.push(`${foreign} row(s) are not in ${account.currency}; review them manually.`);

    return {
      importId: imp.id,
      accountId: account.id,
      bank,
      month,
      rowsTotal: parsed.rows.length + parsed.skipped.length,
      rowsImported: imported,
      rowsDuplicate: duplicate,
      rowsSkipped: parsed.skipped.length,
      skipped: parsed.skipped.slice(0, MAX_SKIPPED_DETAIL),
      foreignCurrencyRows: foreign,
      warnings,
      recurring,
    };
  });
}
