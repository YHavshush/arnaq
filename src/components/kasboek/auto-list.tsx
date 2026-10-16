"use client";

import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { api } from "@/lib/client/api";
import { useI18n } from "@/i18n/client";
import { categoryLabel } from "@/lib/view/categories";
import { formatter } from "@/lib/view/format";
import { CategoryIcon } from "./category-icon";
import { ErrorLine, GhostButton, inputClass } from "./form";

interface Item {
  id: number;
  date: string;
  amount: number;
  counterparty: string | null;
  description: string | null;
  categoryId: number;
}
interface Cat {
  id: number;
  name: string;
  type: string;
}

/**
 * What Kasboek categorised by itself, for the person to check. Each row says so ("Automatic"), has
 * the category to change and an Undo; "All correct" approves the lot. A correction is remembered.
 */
export function AutoList({ items, categories }: { items: Item[]; categories: Cat[] }) {
  const router = useRouter();
  const { locale, t: msg } = useI18n();
  const m = msg.ui.upload;
  const { dayLabel, euroExact } = formatter(locale);
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const byId = new Map(categories.map((c) => [c.id, c]));

  const done = (res: { ok: boolean; error?: string }) => {
    if (!res.ok) return setError(res.error ?? "");
    startTransition(() => router.refresh());
  };

  async function change(item: Item, categoryId: number) {
    if (!categoryId || categoryId === item.categoryId) return;
    setError(null);
    const res = await api<{ alsoCategorised: number }>(
      "PUT",
      `/api/transactions/${item.id}/category`,
      {
        categoryId,
        learn: true,
      },
    );
    if (res.ok && res.data.alsoCategorised > 0)
      setNote(m.auto.alsoChanged(res.data.alsoCategorised));
    else setNote(null);
    done(res);
  }

  const expense = categories.filter((c) => c.type === "expense");
  const income = categories.filter((c) => c.type === "income");

  return (
    <div className="glass overflow-hidden">
      <p className="text-ink-muted border-hair border-b px-4 py-3 text-[14px]">{m.auto.intro}</p>
      <ul className="divide-hair divide-y">
        {items.map((it) => {
          const name = it.counterparty || it.description || msg.ui.common.unknown;
          const cat = byId.get(it.categoryId);
          return (
            <li key={it.id} className="grid gap-2 px-4 py-3">
              <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3">
                <CategoryIcon name={cat?.name ?? null} />
                <div className="min-w-0">
                  <div className="truncate font-semibold">{name}</div>
                  <div className="text-ink-muted flex items-center gap-1.5 text-[13px]">
                    <span>{dayLabel(it.date)}</span>
                    <span className="bg-soft text-ink inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold">
                      <Sparkles aria-hidden className="size-3" />
                      {m.auto.label}
                    </span>
                  </div>
                </div>
                <div className="num font-semibold">{euroExact(it.amount)}</div>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                <select
                  aria-label={m.review.category(name)}
                  className={inputClass}
                  value={it.categoryId}
                  disabled={busy}
                  onChange={(e) => change(it, Number(e.target.value))}
                >
                  <optgroup label={m.review.expenses}>
                    {expense.map((c) => (
                      <option key={c.id} value={c.id}>
                        {categoryLabel(c.name, locale)}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label={m.review.income}>
                    {income.map((c) => (
                      <option key={c.id} value={c.id}>
                        {categoryLabel(c.name, locale)}
                      </option>
                    ))}
                  </optgroup>
                </select>
                <GhostButton
                  type="button"
                  disabled={busy}
                  aria-label={m.auto.undoFor(name)}
                  onClick={async () => {
                    setError(null);
                    setNote(null);
                    done(await api("POST", `/api/transactions/${it.id}/undo`, {}));
                  }}
                >
                  {m.auto.undo}
                </GhostButton>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="border-hair flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
        <span className="text-ink-muted text-[13px]" aria-live="polite">
          {note}
        </span>
        <GhostButton
          type="button"
          disabled={busy}
          onClick={async () => {
            setError(null);
            done(await api("POST", "/api/transactions/confirm", { ids: items.map((i) => i.id) }));
          }}
        >
          {m.auto.allCorrect}
        </GhostButton>
      </div>
      {error && (
        <div className="px-4 pb-3">
          <ErrorLine message={error} />
        </div>
      )}
    </div>
  );
}
