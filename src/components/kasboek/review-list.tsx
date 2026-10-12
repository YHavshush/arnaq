"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { api } from "@/lib/client/api";
import { dayLabel, euroExact } from "@/lib/view/format";
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
}
interface Cat {
  id: number;
  name: string;
  type: string;
}

/** Transactions that need a category. Choosing one saves at once; "onthoud" also learns a rule. */
export function ReviewList({ items, categories }: { items: Item[]; categories: Cat[] }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<number | null>(null);

  async function choose(item: Item, categoryId: number) {
    if (!categoryId) return;
    setError(null);
    const res = await api("PUT", `/api/transactions/${item.id}/category`, {
      categoryId,
      createRule: remember && !!(item.counterparty || item.description),
    });
    if (!res.ok) return setError(res.error);
    setSaved(item.id);
    startTransition(() => router.refresh());
  }

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
        Onthoud mijn keuze voor dezelfde winkel
      </label>
      <ul className="divide-hair divide-y">
        {items.map((t) => (
          <li key={t.id} className="grid gap-2 px-4 py-3" aria-busy={busy && saved === t.id}>
            <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3">
              <CategoryIcon name={null} />
              <div className="min-w-0">
                <div className="truncate font-semibold">
                  {t.counterparty || t.description || "Onbekend"}
                </div>
                <div className="text-ink-muted truncate text-[13px]">
                  {dayLabel(t.date)}
                  {t.reason === "foreign-currency" ? `, in ${t.currency}` : ""}
                </div>
              </div>
              <div className="num font-semibold">{euroExact(t.amount)}</div>
            </div>
            <select
              aria-label={`Categorie voor ${t.counterparty ?? t.description ?? "transactie"}`}
              className={inputClass}
              defaultValue=""
              disabled={busy}
              onChange={(e) => choose(t, Number(e.target.value))}
            >
              <option value="">Kies een categorie…</option>
              <optgroup label="Uitgaven">
                {expense.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Inkomen">
                {income.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
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
