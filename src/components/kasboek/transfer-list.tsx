"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/client/api";
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
  /** null: found by Kasboek itself; otherwise the person chose it (or taught it). */
  source: string | null;
}

/**
 * Transactions treated as moves between the person's own accounts. They are left out of income and
 * spending, so a wrong one must be easy to find and put back: "Change" opens the category list.
 */
export function TransferList({
  items,
  categories,
  transfer,
}: {
  items: Item[];
  categories: PickerCategory[];
  transfer: PickerCategory | null;
}) {
  const router = useRouter();
  const { locale, t: msg } = useI18n();
  const m = msg.ui.upload;
  const { dayLabel, euroExact } = formatter(locale);
  const [busy, startTransition] = useTransition();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheetFor, setSheetFor] = useState<Item | null>(null);
  const nameOf = (it: Item) => it.counterparty || it.description || msg.ui.common.unknown;

  async function change(item: Item, categoryId: number) {
    setSheetFor(null);
    if (sending) return;
    setSending(true);
    setError(null);
    const res = await api("PUT", `/api/transactions/${item.id}/category`, {
      categoryId,
      learn: true,
    });
    setSending(false);
    if (!res.ok) return setError(res.error);
    startTransition(() => router.refresh());
  }

  return (
    <div className="glass overflow-hidden">
      <p className="text-ink-muted border-hair border-b px-4 py-3 text-[14px]">
        {m.transfers.intro}
      </p>
      <ul className="divide-hair divide-y">
        {items.map((it) => (
          <li key={it.id} className="grid gap-2 px-4 py-3">
            <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3">
              <CategoryIcon name={transfer?.name ?? null} />
              <div className="min-w-0">
                <div className="truncate font-semibold">{nameOf(it)}</div>
                <div className="text-ink-muted text-[13px]">
                  {dayLabel(it.date)}, {it.source === null ? m.transfers.found : m.transfers.chosen}
                </div>
              </div>
              <div className="num font-semibold">{euroExact(it.amount)}</div>
            </div>
            <div>
              <GhostButton
                type="button"
                disabled={busy || sending}
                aria-label={m.transfers.changeFor(nameOf(it))}
                onClick={() => setSheetFor(it)}
              >
                {m.transfers.change}
              </GhostButton>
            </div>
          </li>
        ))}
      </ul>
      {error && (
        <div className="px-4 pb-3">
          <ErrorLine message={error} />
        </div>
      )}
      <CategorySheet
        open={sheetFor !== null}
        title={sheetFor ? m.review.pickTitle(nameOf(sheetFor)) : ""}
        categories={categories}
        transfer={null}
        direction={sheetFor && sheetFor.amount > 0 ? "in" : "out"}
        onPick={(id) => sheetFor && change(sheetFor, id)}
        onClose={() => setSheetFor(null)}
      />
    </div>
  );
}
