import { and, eq, inArray } from "drizzle-orm";
import { schema } from "@/db";
import { bankName } from "@/lib/import/banks";
import { ImportError, MAX_IMPORT_ROWS, importRows } from "@/lib/import/service";
import type { Bank, ParsedRow, SkippedRow } from "@/lib/import/types";
import { addDays, isDate } from "@/lib/recurring/dates";
import { clearSample } from "@/lib/sample/sample";
import { instantMs, type RunAsUser } from "./connections";
import { applyReportedBalance, convertTransactions } from "./convert";
import {
  EnableBankingError,
  getBalances,
  getTransactions,
  isSessionOver,
  type Balance,
  type BankingConfig,
} from "./enable-banking";
import type { SyncLinkReport } from "./types";

/** A first sync reaches this far back; later ones start a week before the last one, so late bookings are caught. */
export const FIRST_SYNC_DAYS = 90;
export const OVERLAP_DAYS = 7;
/** Pages of transactions read per account per refresh, at most. A bank that sends more is reported, not followed. */
export const MAX_PAGES = 50;

interface Fetched {
  report: SyncLinkReport;
  linkId: number;
  accountId: number;
  bank: Bank;
  from: string;
  rows: ParsedRow[];
  skipped: SkippedRow[];
}

const messageOf = (e: unknown): string => {
  if (e instanceof ImportError) return e.message;
  if (e instanceof EnableBankingError) {
    if (e.code === "ASPSP_RATE_LIMIT_EXCEEDED" || e.status === 429)
      return "The bank is busy. Try again later.";
    if (e.code === "TOO_MANY_PAGES")
      return "The bank sent more transactions than arnaq reads at once.";
    return "Enable Banking could not be reached. Try again later.";
  }
  return "The transactions could not be saved.";
};

/**
 * "Refresh now": for every active bank link, read the booked transactions since the last refresh (a week of overlap; 90
 * days the first time) and the bank's balances, and put them through the same importer as an uploaded file, so sorting,
 * transfers between own accounts, rows already uploaded from a file, fixed costs and the import log all behave the
 * same. The bank is asked first, without holding the database; then each account is stored in a transaction of its
 * own: an account that fails stores nothing and the others still count. A consent that is over marks its connection
 * expired. Reports per linked account.
 */
export async function syncBankLinks(
  config: BankingConfig,
  run: RunAsUser,
  opts: { today: string; now?: number },
): Promise<SyncLinkReport[]> {
  const { today } = opts;
  const now = opts.now ?? Date.now();
  if (!isDate(today)) throw new Error("Invalid date.");
  const links = await run((db) =>
    db
      .select({
        id: schema.bankLinks.id,
        connectionId: schema.bankLinks.connectionId,
        accountUid: schema.bankLinks.accountUid,
        accountId: schema.bankLinks.accountId,
        lastSyncedAt: schema.bankLinks.lastSyncedAt,
        sessionId: schema.bankConnections.sessionId,
        validUntil: schema.bankConnections.validUntil,
        accountName: schema.accounts.name,
        bank: schema.accounts.bank,
      })
      .from(schema.bankLinks)
      .innerJoin(
        schema.bankConnections,
        eq(schema.bankConnections.id, schema.bankLinks.connectionId),
      )
      .innerJoin(schema.accounts, eq(schema.accounts.id, schema.bankLinks.accountId))
      .where(eq(schema.bankConnections.status, "active"))
      .orderBy(schema.bankLinks.id),
  );

  const reports: SyncLinkReport[] = [];
  const fetched: Fetched[] = [];
  const expired = new Set<number>();
  for (const link of links) {
    const report: SyncLinkReport = {
      linkId: link.id,
      accountName: link.accountName,
      status: "ok",
      imported: 0,
      duplicate: 0,
    };
    reports.push(report);
    const until = instantMs(link.validUntil);
    if (expired.has(link.connectionId) || (until !== null && until <= now) || !link.sessionId) {
      expired.add(link.connectionId);
      report.status = "expired";
      continue;
    }
    const lastDay = instantMs(link.lastSyncedAt);
    const fromRaw =
      lastDay === null
        ? addDays(today, -FIRST_SYNC_DAYS)
        : addDays(new Date(lastDay).toISOString().slice(0, 10), -OVERLAP_DAYS);
    const from = fromRaw > today ? today : fromRaw;
    try {
      const raw: unknown[] = [];
      const seen = new Set<string>();
      let key: string | null = null;
      for (let page = 0; ; page++) {
        if (page >= MAX_PAGES) throw new EnableBankingError(502, "TOO_MANY_PAGES");
        const result = await getTransactions(config, link.accountUid, {
          dateFrom: from,
          dateTo: today,
          continuationKey: key,
        });
        raw.push(...result.transactions);
        if (raw.length > MAX_IMPORT_ROWS) throw new EnableBankingError(502, "TOO_MANY_PAGES");
        // An empty page can still carry a key: keep going. The same key twice would loop forever: stop.
        if (!result.continuationKey || seen.has(result.continuationKey)) break;
        seen.add(result.continuationKey);
        key = result.continuationKey;
      }
      let balances: Balance[] = [];
      try {
        balances = await getBalances(config, link.accountUid);
      } catch (e) {
        if (isSessionOver(e)) throw e;
        // A balance is a bonus: the transactions still count without it.
      }
      // Banks book a little before or after the dates asked for; a month either side is believed, nothing beyond.
      const { rows, skipped } = convertTransactions(raw, {
        from: addDays(from, -31),
        to: addDays(today, 7),
      });
      applyReportedBalance(rows, balances);
      fetched.push({
        report,
        linkId: link.id,
        accountId: link.accountId,
        bank: link.bank,
        from,
        rows,
        skipped,
      });
    } catch (e) {
      if (isSessionOver(e)) {
        expired.add(link.connectionId);
        report.status = "expired";
      } else {
        report.status = "failed";
        report.error = messageOf(e);
      }
    }
  }
  // Every link of a connection whose consent is over is expired, also the ones read before it was found out.
  for (const r of reports)
    if (expired.has(links.find((l) => l.id === r.linkId)!.connectionId)) {
      r.status = "expired";
      delete r.error;
    }

  await run(async (db) => {
    if (expired.size > 0)
      await db
        .update(schema.bankConnections)
        .set({ status: "expired" })
        .where(
          and(
            inArray(schema.bankConnections.id, [...expired]),
            eq(schema.bankConnections.status, "active"),
          ),
        );
    const work = fetched.filter((f) => f.report.status === "ok");
    if (work.some((f) => f.rows.length > 0)) await clearSample(db, today);
    for (const f of work) {
      try {
        await db.transaction(async (tx) => {
          const [still] = await tx
            .select({ id: schema.bankLinks.id })
            .from(schema.bankLinks)
            .where(eq(schema.bankLinks.id, f.linkId));
          if (!still) throw new ImportError("This bank link was removed.");
          const summary = await importRows(tx, {
            bank: f.bank,
            accountId: f.accountId,
            parsed: { rows: f.rows, skipped: f.skipped, accountIdentifier: null },
            period: { from: f.from, to: today },
            filename: `${bankName(f.bank)} (Enable Banking)`,
            today,
          });
          await tx
            .update(schema.bankLinks)
            .set({ lastSyncedAt: new Date(now).toISOString() })
            .where(eq(schema.bankLinks.id, f.linkId));
          f.report.imported = summary.rowsImported;
          f.report.duplicate = summary.rowsDuplicate;
        });
      } catch (e) {
        f.report.status = "failed";
        f.report.error = messageOf(e);
      }
    }
  });
  return reports;
}
