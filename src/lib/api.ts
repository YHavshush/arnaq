import { connection } from "next/server";
import { MAX_CENTS } from "@/lib/money";
import { BudgetError } from "@/lib/budget/budgets";
import { CategoriseError } from "@/lib/categories/categorise";
import { ForecastError } from "@/lib/forecast/errors";
import { ImportError } from "@/lib/import/service";
import { RecurringError } from "@/lib/recurring/errors";

const DOMAIN_ERRORS = [BudgetError, CategoriseError, ForecastError, ImportError, RecurringError];

/**
 * Postgres reports integrity violations (foreign key, unique, not null, check) as SQLSTATE class
 * 23 and unusable values as class 22. Drizzle wraps the driver error, so look at the cause as well.
 */
function isConstraintViolation(e: unknown): boolean {
  for (let err = e, depth = 0; err && typeof err === "object" && depth < 3; depth++) {
    const code = (err as { code?: unknown }).code;
    // 23: integrity constraint. 22: bad value (number out of range for the column, NUL in text).
    if (typeof code === "string" && (code.startsWith("23") || code.startsWith("22"))) return true;
    err = (err as { cause?: unknown }).cause;
  }
  return false;
}

/** Run a handler; turn expected domain errors into 422 JSON, bad JSON into 400. */
export async function handle(fn: () => Response | Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof SyntaxError)
      return Response.json({ error: "Invalid JSON body." }, { status: 400 });
    if (DOMAIN_ERRORS.some((C) => e instanceof C)) {
      return Response.json({ error: (e as Error).message }, { status: 422 });
    }
    // A foreign key or unique constraint hit: the request referenced something that is not there
    // (or already exists). Never leak the SQL, just say so.
    if (isConstraintViolation(e)) {
      return Response.json(
        { error: "The request conflicts with existing data (unknown reference or duplicate)." },
        { status: 422 },
      );
    }
    throw e;
  }
}

/** A safe integer within the accepted money range (also used for ids). */
export const isInt = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && Math.abs(v) <= MAX_CENTS;

/**
 * Call at the top of GET handlers that do not read the request. With Cache Components,
 * Next.js would otherwise prerender them at build time (database calls are not detected as
 * dynamic) and serve stale data.
 */
export async function requestTime(): Promise<void> {
  await connection();
}

/**
 * Today's local date as YYYY-MM-DD. Only the API layer asks the clock; library code takes
 * `today` as an argument so it stays deterministic and testable.
 */
export function todayIso(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Ids are Postgres `integer` (int4) columns. */
export const MAX_ID = 2_147_483_647;

/** Parse a positive integer route id, or null. */
export function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 && id <= MAX_ID ? id : null;
}

/**
 * An optional whole-number query parameter: undefined when absent, NaN when it is not plain
 * digits (so "1e1", " 6", "-1" or "1.5" never sneak through Number()); the domain validates the range.
 */
export function intParam(params: URLSearchParams, name: string): number | undefined {
  const raw = params.get(name);
  if (raw === null) return undefined;
  return /^\d{1,4}$/.test(raw) ? Number(raw) : Number.NaN;
}
