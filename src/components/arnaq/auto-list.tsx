"use client";

import { ChevronDown, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { api } from "@/lib/client/api";
import { useI18n } from "@/i18n/client";
import { categoryLabel } from "@/lib/view/categories";
import { formatter } from "@/lib/view/format";
import { CategoryIcon } from "./category-icon";
import { CategorySheet, type PickerCategory } from "./category-picker";
import { ErrorLine, GhostButton } from "./form";

interface Item {
  id: number;
  date: string;
  amount: number;
  counterparty: string | null;
  description: string | null;
  categoryId: number;
}
type Cat = PickerCategory;

/**
 * What arnaq categorised by itself, for the person to check. Each row says so ("Automatic"), has
 * the category to change and an Undo; "All correct" approves the lot. A correction is remembered.
 */
export function AutoList({
  items,
  categories,
  special,
}: {
  items: Item[];
  categories: Cat[];
  special: Cat[];
}) {
  const router = useRouter();
  const { locale, t: msg } = useI18n();
  const m = msg.ui.upload;
  const { dayLabel, euroExact } = formatter(locale);
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [sheetFor, setSheetFor] = useState<Item | null>(null);
  const [sending, setSending] = useState(false);
  const byId = new Map(categories.map((c) => [c.id, c]));

  const done = (res: { ok: boolean; error?: string }) => {
    if (!res.ok) return setError(res.error ?? "");
    startTransition(() => router.refresh());
  };

  async function change(item: Item, categoryId: number) {
    setSheetFor(null);
    if (!categoryId || categoryId === item.categoryId || sending) return;
    setSending(true);
    setError(null);
    const res = await api<{ alsoCategorised: number }>(
      "PUT",
      `/api/transactions/${item.id}/category`,
      {
        categoryId,
        learn: true,
      },
    );
    setSending(false);
    if (res.ok && res.data.alsoCategorised > 0)
      setNote(m.auto.alsoChanged(res.data.alsoCategorised));
    else setNote(null);
    done(res);
  }

  const nameOf = (it: Item) => it.counterparty || it.description || msg.ui.common.unknown;

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
                <button
                  type="button"
                  aria-label={m.review.category(name)}
                  className="bg-soft border-hair flex min-h-11 w-full min-w-0 items-center justify-between gap-2 rounded-xl border px-3 text-left text-base disabled:opacity-50"
                  disabled={busy || sending}
                  onClick={() => setSheetFor(it)}
                >
                  <span className="truncate">{categoryLabel(cat?.name ?? "", locale)}</span>
                  <ChevronDown aria-hidden className="text-ink-muted size-4 shrink-0" />
                </button>
                <GhostButton
                  type="button"
                  disabled={busy || sending}
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
          disabled={busy || sending}
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
      <CategorySheet
        open={sheetFor !== null}
        title={sheetFor ? m.review.pickTitle(nameOf(sheetFor)) : ""}
        categories={categories}
        special={special}
        direction={sheetFor && sheetFor.amount > 0 ? "in" : "out"}
        currentId={sheetFor?.categoryId}
        onPick={(id) => sheetFor && change(sheetFor, id)}
        onClose={() => setSheetFor(null)}
      />
    </div>
  );
}
