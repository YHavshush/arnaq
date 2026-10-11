import { connection } from "next/server";
import { BudgetError } from "@/lib/budget/budgets";
import { CategoriseError } from "@/lib/categories/categorise";
import { ImportError } from "@/lib/import/service";

const DOMAIN_ERRORS = [BudgetError, CategoriseError, ImportError];

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
    throw e;
  }
}

export const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

/**
 * Call at the top of GET handlers that do not read the request. With Cache Components,
 * Next.js would otherwise prerender them at build time (synchronous SQLite calls are not
 * detected as dynamic) and serve stale data.
 */
export async function requestTime(): Promise<void> {
  await connection();
}
