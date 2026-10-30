"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/client/api";
import type { CategoryDetailRow } from "@/lib/view/category-detail";
import { categoryLabel } from "@/lib/view/categories";
import { formatter } from "@/lib/view/format";
import { CategoryIcon } from "./category-icon";
import { CategorySheet, type PickerCategory } from "./category-picker";
import { ErrorLine } from "./form";

/**
 * The transactions behind one category, grouped by day. A tap on a row opens the category sheet, so a wrong sort is
 * fixed where it is found; the row says "Moved" for a moment and leaves the list when the page refreshes.
 */
export function CategoryTransactions({
  rows,
  categoryName,
  categories,
  special,
  currentId,
}: {
  rows: CategoryDetailRow[];
  categoryName: string;
  categories: PickerCategory[];
  special: PickerCategory[];
  currentId: number;
}) {
  const router = useRouter();
  const { locale, t } = useI18n();
  const c = t.ui.category;
  const { dayLabel, euroExact } = formatter(locale);
  const [sheetFor, setSheetFor] = useState<CategoryDetailRow | null>(null);
  const [moved, setMoved] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const all = new Map([...categories, ...special].map((x) => [x.id, x]));

  async function pick(row: CategoryDetailRow, categoryId: number) {
    setSheetFor(null);
    if (categoryId === currentId) return;
    setError(null);
    const res = await api("PUT", `/api/transactions/${row.id}/category`, {
      categoryId,
      learn: !!(row.counterparty || row.description),
    });
    if (!res.ok) return setError(res.error);
    setMoved(row.id);
    startTransition(() => router.refresh());
  }

  const days: { date: string; rows: CategoryDetailRow[] }[] = [];
  for (const r of rows) {
    const last = days[days.length - 1];
    if (last && last.date === r.date) last.rows.push(r);
    else days.push({ date: r.date, rows: [r] });
  }

  return (
    <div>
      <div className="glass px-4 pt-2 pb-1">
        {days.map((d) => (
          <section key={d.date}>
            <h3 className="text-ink-muted pt-3 pb-1 text-xs font-semibold tracking-wide uppercase">
              {dayLabel(d.date)}
            </h3>
            <ul className="divide-hair divide-y">
              {d.rows.map((r) => {
                const hint = r.suggestedCategoryId ? all.get(r.suggestedCategoryId) : undefined;
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setSheetFor(r)}
                      className={`grid min-h-14 w-full grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 py-2.5 text-left transition-opacity ${moved === r.id ? "opacity-50" : ""}`}
                    >
                      <CategoryIcon name={categoryName} />
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">
                          {r.counterparty || r.description || t.ui.common.unknown}
                        </span>
                        <span className="text-ink-muted block truncate text-[13px]">
                          {moved === r.id
                            ? c.moved
                            : hint
                              ? c.probably(categoryLabel(hint.name, locale))
                              : (c.source[r.source ?? ""] ?? "")}
                        </span>
                      </span>
                      <span className="num font-semibold">{euroExact(r.amount)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      <p className="text-ink-muted mt-3 px-2 text-center text-[13px]">{c.hint}</p>
      <ErrorLine message={error} />
      <CategorySheet
        open={sheetFor !== null}
        title={c.moveTitle(sheetFor?.counterparty ?? sheetFor?.description ?? t.ui.common.unknown)}
        categories={categories}
        special={special}
        direction={sheetFor && sheetFor.amount > 0 ? "in" : "out"}
        currentId={currentId}
        onPick={(id) => sheetFor && pick(sheetFor, id)}
        onClose={() => setSheetFor(null)}
      />
    </div>
  );
}
