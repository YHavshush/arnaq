import { createHash } from "node:crypto";
import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { MAX_ITEMS_PER_CALL, type CategoriserProvider, type ClassifyItem } from "./provider";
import { toClassifyFields } from "./scrub";
import { validateAnswers } from "./validate";

/** Runs one database transaction as the current user (`userDb` in the app, a plain wrapper in tests). */
export interface SmartDeps {
  run<T>(fn: (db: Db) => Promise<T>): Promise<T>;
}

export interface SmartLimits {
  /** Distinct shops the model may be asked about per user per day. */
  merchantsPerDay: number;
  callsPerDay: number;
  maxCallsPerRun: number;
  callTimeoutMs: number;
  runTimeoutMs: number;
  leaseMs: number;
}

export const DEFAULT_LIMITS: SmartLimits = {
  merchantsPerDay: 300,
  callsPerDay: 15,
  maxCallsPerRun: 4,
  callTimeoutMs: 20_000,
  runTimeoutMs: 45_000,
  leaseMs: 60_000,
};

export interface SmartResult {
  status: "done" | "busy" | "capped" | "nothing";
  asked: number;
  applied: number;
  suggested: number;
}

/** Catch-all categories are never applied by a model: "Overig" is where guesses go to hide. */
const CATCH_ALL = new Set(["other", "other-income"]);

const hashOptions = (ids: number[]) =>
  createHash("sha256")
    .update([...ids].sort((a, b) => a - b).join(","))
    .digest("hex")
    .slice(0, 16);

interface Plan {
  items: ClassifyItem[];
  keyByRef: Map<string, string>;
  options: { ref: string; label: string }[];
  categoryByRef: Map<string, number>;
  optionsHash: string;
}

/**
 * One smart run for the current user, in three steps so that no database transaction is open while
 * the model is being asked: (A) take a lease, collect what to ask (distinct shops that are still open
 * and not asked before) and reserve the daily allowance; (B) ask the provider in batches with a time
 * limit, validating every answer; (C) store what was answered (cached per shop) and apply the
 * answers that are safe, suggesting the rest. A failure at any point leaves everything as it was: the
 * person simply sorts those transactions by hand.
 */
export async function runSmart(
  deps: SmartDeps,
  provider: CategoriserProvider,
  opts: {
    today: string;
    now?: Date;
    limits?: Partial<SmartLimits>;
    categoryLabel?: (name: string) => string;
  },
): Promise<SmartResult> {
  const limits = { ...DEFAULT_LIMITS, ...opts.limits };
  const now = opts.now ?? new Date();
  const label = opts.categoryLabel ?? ((n: string) => n);
  const result: SmartResult = { status: "nothing", asked: 0, applied: 0, suggested: 0 };

  // A: lease, plan, reserve.
  const plan = await deps.run(async (db): Promise<Plan | "busy" | "capped" | null> => {
    const [settings] = await db.select().from(schema.userSettings);
    if (settings?.smartLeaseUntil && new Date(settings.smartLeaseUntil) > now) return "busy";
    const leaseUntil = new Date(now.getTime() + limits.leaseMs).toISOString();
    await db
      .insert(schema.userSettings)
      .values({ smartLeaseUntil: leaseUntil })
      .onConflictDoUpdate({
        target: schema.userSettings.userId,
        set: { smartLeaseUntil: leaseUntil },
      });

    const categories = (await db.select().from(schema.categories)).filter(
      (c) => c.type === "expense" || c.type === "income", // never a transfer or savings: the person decides those
    );
    const optionsHash = hashOptions(categories.map((c) => c.id));
    const [usage] = await db
      .select()
      .from(schema.aiUsage)
      .where(eq(schema.aiUsage.day, opts.today));
    const room = limits.merchantsPerDay - (usage?.merchants ?? 0);
    if (room <= 0 || (usage?.calls ?? 0) >= limits.callsPerDay) return "capped";

    const open = await db
      .select()
      .from(schema.transactions)
      .where(
        and(
          isNull(schema.transactions.categoryId),
          eq(schema.transactions.isInternalTransfer, false),
          or(
            isNull(schema.transactions.categorySource),
            ne(schema.transactions.categorySource, "undone"),
          )!,
        ),
      );
    const known = new Map(
      (await db.select().from(schema.merchantLabels)).map((l) => [l.merchantKey, l] as const),
    );
    const wanted = new Map<string, { merchant: string; description: string }>();
    for (const t of open) {
      const fields = toClassifyFields(t);
      if (!fields || wanted.has(fields.merchant)) continue;
      const cached = known.get(fields.merchant);
      // Asked before: a person's own label or an answer stays; an abstention is retried only when the
      // person's categories changed since.
      if (
        cached &&
        (cached.source === "user" ||
          cached.categoryId !== null ||
          cached.optionsHash === optionsHash)
      )
        continue;
      wanted.set(fields.merchant, fields);
    }
    if (wanted.size === 0) return null;

    const chosen = [...wanted.values()].slice(
      0,
      Math.min(room, limits.maxCallsPerRun * MAX_ITEMS_PER_CALL),
    );
    const calls = Math.ceil(chosen.length / MAX_ITEMS_PER_CALL);
    await db
      .insert(schema.aiUsage)
      .values({ day: opts.today, merchants: chosen.length, calls })
      .onConflictDoUpdate({
        target: [schema.aiUsage.userId, schema.aiUsage.day],
        set: {
          merchants: sql`${schema.aiUsage.merchants} + ${chosen.length}`,
          calls: sql`${schema.aiUsage.calls} + ${calls}`,
        },
      });
    const options = categories.map((c, i) => ({ ref: `c${i + 1}`, label: label(c.name) }));
    return {
      items: chosen.map((f, i) => ({
        ref: `m${i + 1}`,
        merchant: f.merchant,
        description: f.description,
      })),
      keyByRef: new Map(chosen.map((f, i) => [`m${i + 1}`, f.merchant])),
      options,
      categoryByRef: new Map(categories.map((c, i) => [`c${i + 1}`, c.id])),
      optionsHash,
    };
  });
  if (plan === "busy" || plan === "capped") return { ...result, status: plan };
  if (plan === null) {
    await release(deps);
    return result;
  }
  result.asked = plan.items.length;

  // B: ask, in batches, within the time limits. Nothing here touches the database.
  const answers = new Map<string, { category: string | null; basis: string }>();
  const deadline = Date.now() + limits.runTimeoutMs;
  let usage = { input: 0, output: 0 };
  for (
    let from = 0;
    from < plan.items.length && Date.now() < deadline;
    from += MAX_ITEMS_PER_CALL
  ) {
    const batch = plan.items.slice(from, from + MAX_ITEMS_PER_CALL);
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      Math.min(limits.callTimeoutMs, deadline - Date.now()),
    );
    try {
      const res = await provider.classify({
        items: batch,
        options: plan.options,
        signal: controller.signal,
      });
      for (const [ref, a] of validateAnswers(batch, plan.options, res.answers)) answers.set(ref, a);
      usage = {
        input: usage.input + (res.usage?.input ?? 0),
        output: usage.output + (res.usage?.output ?? 0),
      };
    } catch {
      // A timeout, an error or nonsense: this batch is left for the person.
    } finally {
      clearTimeout(timer);
    }
  }

  // C: store and apply.
  const applied = await deps.run(async (db) => {
    let apply = 0;
    let suggest = 0;
    const typeOf = new Map(
      (await db.select().from(schema.categories)).map((c) => [c.id, c] as const),
    );
    for (const item of plan.items) {
      const a = answers.get(item.ref);
      if (!a) continue;
      const key = plan.keyByRef.get(item.ref)!;
      const categoryId = a.category === null ? null : (plan.categoryByRef.get(a.category) ?? null);
      await db
        .insert(schema.merchantLabels)
        .values({
          merchantKey: key,
          categoryId,
          source: "model",
          provider: provider.id,
          optionsHash: categoryId === null ? plan.optionsHash : null,
        })
        .onConflictDoUpdate({
          target: [schema.merchantLabels.userId, schema.merchantLabels.merchantKey],
          set: {
            categoryId,
            provider: provider.id,
            optionsHash: categoryId === null ? plan.optionsHash : null,
            updatedAt: new Date().toISOString(),
          },
          setWhere: eq(schema.merchantLabels.source, "model"),
        });
      if (categoryId === null) continue;
      const category = typeOf.get(categoryId);
      if (!category) continue;

      const rows = await db
        .select()
        .from(schema.transactions)
        .where(
          and(
            eq(schema.transactions.merchantKey, key),
            isNull(schema.transactions.categoryId),
            eq(schema.transactions.isInternalTransfer, false),
            or(
              isNull(schema.transactions.categorySource),
              ne(schema.transactions.categorySource, "undone"),
            )!,
          ),
        );
      const autoIds: number[] = [];
      const suggestIds: number[] = [];
      for (const t of rows) {
        const fits = category.type === (t.amount > 0 ? "income" : "expense");
        if (!fits) continue;
        const sure =
          a.basis === "known_merchant" &&
          !CATCH_ALL.has(category.slug ?? "") &&
          (t.suggestedCategoryId === null || t.suggestedCategoryId === categoryId);
        (sure ? autoIds : suggestIds).push(t.id);
      }
      if (autoIds.length)
        await db
          .update(schema.transactions)
          .set({ categoryId, categorySource: "model", suggestedCategoryId: null })
          .where(inArray(schema.transactions.id, autoIds));
      if (suggestIds.length)
        await db
          .update(schema.transactions)
          .set({ suggestedCategoryId: categoryId })
          .where(inArray(schema.transactions.id, suggestIds));
      apply += autoIds.length;
      suggest += suggestIds.length;
    }
    await db
      .update(schema.aiUsage)
      .set({
        inputTokens: sql`${schema.aiUsage.inputTokens} + ${usage.input}`,
        outputTokens: sql`${schema.aiUsage.outputTokens} + ${usage.output}`,
      })
      .where(eq(schema.aiUsage.day, opts.today));
    await db.update(schema.userSettings).set({ smartLeaseUntil: null });
    return { apply, suggest };
  });
  return { ...result, status: "done", applied: applied.apply, suggested: applied.suggest };
}

async function release(deps: SmartDeps) {
  await deps.run((db) => db.update(schema.userSettings).set({ smartLeaseUntil: null }));
}
