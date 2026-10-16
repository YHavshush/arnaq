"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { api } from "@/lib/client/api";
import { useI18n } from "@/i18n/client";
import { categoryLabel } from "@/lib/view/categories";
import { formatter } from "@/lib/view/format";
import { CategoryIcon } from "./category-icon";
import { ErrorLine, inputClass } from "./form";

interface Item {
  id: number;
  date: string;
  amount: number;
  counterparty: string | null;
  description: string | null;
  reason: "uncategorised" | "foreign-currency";
  currency: string;
  /** A category worth offering ("Probably X?"). */
  suggestedCategoryId: number | null;
}
interface Cat {
  id: number;
  name: string;
  type: string;
}

/** Transactions that need a category. Choosing one saves at once; "remember" teaches Kasboek the shop. */
export function ReviewList({ items, categories }: { items: Item[]; categories: Cat[] }) {
  const router = useRouter();
  const { locale, t: msg } = useI18n();
  const { dayLabel, euroExact } = formatter(locale);
  const [busy, startTransition] = useTransition();
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<number | null>(null);

  async function choose(item: Item, categoryId: number) {
    if (!categoryId) return;
    setError(null);
    const res = await api("PUT", `/api/transactions/${item.id}/category`, {
      categoryId,
      learn: remember && !!(item.counterparty || item.description),
    });
    if (!res.ok) return setError(res.error);
    setSaved(item.id);
    startTransition(() => router.refresh());
  }

  const byId = new Map(categories.map((c) => [c.id, c]));
  const expense = categories.filter((c) => c.type === "expense");
  const income = categories.filter((c) => c.type === "income");

  return (
    <div className="glass overflow-hidden">
      <label className="border-hair flex min-h-12 items-center gap-3 border-b px-4 text-[15px]">
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
          className="size-5"
        />
        {msg.ui.upload.review.remember}
      </label>
      <ul className="divide-hair divide-y">
        {items.map((t) => (
          <li key={t.id} className="grid gap-2 px-4 py-3" aria-busy={busy && saved === t.id}>
            <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3">
              <CategoryIcon name={null} />
              <div className="min-w-0">
                <div className="truncate font-semibold">
                  {t.counterparty || t.description || msg.ui.common.unknown}
                </div>
                <div className="text-ink-muted truncate text-[13px]">
                  {dayLabel(t.date)}
                  {t.reason === "foreign-currency"
                    ? `, ${msg.ui.upload.review.inCurrency(t.currency)}`
                    : ""}
                </div>
              </div>
              <div className="num font-semibold">{euroExact(t.amount)}</div>
            </div>
            {t.suggestedCategoryId !== null && byId.get(t.suggestedCategoryId) && (
              <div className="flex items-center justify-between gap-3 text-[14px]">
                <span className="text-ink-muted">
                  {msg.ui.upload.review.probably(
                    categoryLabel(byId.get(t.suggestedCategoryId)!.name, locale),
                  )}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => choose(t, t.suggestedCategoryId!)}
                  className="bg-accent text-accent-ink inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold"
                >
                  {msg.ui.upload.review.yes}
                </button>
              </div>
            )}
            <select
              aria-label={msg.ui.upload.review.category(
                t.counterparty ?? t.description ?? msg.ui.upload.review.transaction,
              )}
              className={inputClass}
              defaultValue=""
              disabled={busy}
              onChange={(e) => choose(t, Number(e.target.value))}
            >
              <option value="">{msg.ui.upload.review.choose}</option>
              <optgroup label={msg.ui.upload.review.expenses}>
                {expense.map((c) => (
                  <option key={c.id} value={c.id}>
                    {categoryLabel(c.name, locale)}
                  </option>
                ))}
              </optgroup>
              <optgroup label={msg.ui.upload.review.income}>
                {income.map((c) => (
                  <option key={c.id} value={c.id}>
                    {categoryLabel(c.name, locale)}
                  </option>
                ))}
              </optgroup>
            </select>
          </li>
        ))}
      </ul>
      {error && (
        <div className="px-4 pb-3">
          <ErrorLine message={error} />
        </div>
      )}
    </div>
  );
}
