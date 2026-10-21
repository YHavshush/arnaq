"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useI18n } from "@/i18n/client";
import { api, euroInputToCents } from "@/lib/client/api";
import { categoryLabel } from "@/lib/view/categories";
import { formatter } from "@/lib/view/format";
import { CategoryIcon } from "./category-icon";
import { ErrorLine, Field, GhostButton, PrimaryButton, inputClass } from "./form";

interface Cat {
  id: number;
  name: string;
  type: "expense" | "income" | "transfer" | "savings";
}

interface SuggestionView {
  key: string;
  type: "expense" | "income";
  name: string;
  expectedAmount: number;
  dayOfMonth: number;
  categoryName: string | null;
  months: number;
}

/** Detected recurring payments: accept (becomes a fixed cost) or reject (never offered again). */
export function SuggestionList({ suggestions }: { suggestions: SuggestionView[] }) {
  const router = useRouter();
  const { locale, t } = useI18n();
  const { euro } = formatter(locale);
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function act(path: "accept" | "reject", s: SuggestionView) {
    setError(null);
    const res = await api("POST", `/api/recurring/suggestions/${path}`, {
      key: s.key,
      type: s.type,
    });
    if (!res.ok) return setError(res.error);
    startTransition(() => router.refresh());
  }

  return (
    <div className="glass overflow-hidden">
      <ul className="divide-hair divide-y">
        {suggestions.map((s) => (
          <li key={`${s.type}:${s.key}`} className="grid gap-3 px-4 py-3">
            <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3">
              <CategoryIcon name={s.categoryName} />
              <div className="min-w-0">
                <div className="truncate font-semibold">{s.name}</div>
                <div className="text-ink-muted text-[13px]">
                  {t.ui.fixed.suggestion.months(s.months, s.dayOfMonth)}
                </div>
              </div>
              <div className="num font-semibold">{euro(s.expectedAmount)}</div>
            </div>
            <div className="flex gap-2">
              <PrimaryButton type="button" disabled={busy} onClick={() => act("accept", s)}>
                {t.ui.fixed.suggestion.add}
              </PrimaryButton>
              <GhostButton type="button" disabled={busy} onClick={() => act("reject", s)}>
                {t.ui.fixed.suggestion.dismiss}
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
    </div>
  );
}

interface ItemView {
  id: number;
  name: string;
  type: "expense" | "income";
  expectedAmount: number;
  dayOfMonth: number;
  frequency: "monthly" | "quarterly" | "yearly";
  active: boolean;
  categoryName: string | null;
}

/** All fixed costs with pause/resume and delete. Delete asks twice (it cannot be undone). */
export function ItemManager({ items }: { items: ItemView[] }) {
  const router = useRouter();
  const { locale, t } = useI18n();
  const { euro } = formatter(locale);
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);

  async function run(res: ReturnType<typeof api>) {
    setError(null);
    const r = await res;
    if (!r.ok) return setError(r.error);
    setConfirming(null);
    startTransition(() => router.refresh());
  }

  if (items.length === 0) return null;
  return (
    <div className="glass overflow-hidden">
      <ul className="divide-hair divide-y">
        {items.map((it) => (
          <li key={it.id} className="grid gap-2 px-4 py-3">
            <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3">
              <CategoryIcon name={it.categoryName} />
              <div className="min-w-0">
                <div className="truncate font-semibold">
                  {it.name}
                  {!it.active && (
                    <span className="text-ink-muted ml-2 text-[13px] font-medium">
                      {t.ui.fixed.item.paused}
                    </span>
                  )}
                </div>
                <div className="text-ink-muted text-[13px]">
                  {t.ui.fixed.item.meta(it.dayOfMonth, t.ui.fixed.freq[it.frequency])}
                </div>
              </div>
              <div className="num font-semibold">{euro(it.expectedAmount)}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <GhostButton
                type="button"
                disabled={busy}
                onClick={() => run(api("PATCH", `/api/recurring/${it.id}`, { active: !it.active }))}
              >
                {it.active ? t.ui.fixed.item.pause : t.ui.fixed.item.resume}
              </GhostButton>
              {confirming === it.id ? (
                <>
                  <PrimaryButton
                    type="button"
                    disabled={busy}
                    onClick={() => run(api("DELETE", `/api/recurring/${it.id}`))}
                  >
                    {t.ui.fixed.item.confirmRemove}
                  </PrimaryButton>
                  <GhostButton type="button" onClick={() => setConfirming(null)}>
                    {t.ui.common.cancel}
                  </GhostButton>
                </>
              ) : (
                <GhostButton type="button" disabled={busy} onClick={() => setConfirming(it.id)}>
                  {t.ui.fixed.item.remove}
                </GhostButton>
              )}
            </div>
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

/** Add a fixed cost by hand. */
export function AddItemForm({ categories, today }: { categories: Cat[]; today: string }) {
  const router = useRouter();
  const { locale, t } = useI18n();
  const f = t.ui.fixed.form;
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"expense" | "income">("expense");
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  async function submit(form: FormData) {
    setError(null);
    const cents = euroInputToCents(String(form.get("amount") ?? ""));
    if (cents === null || cents === 0) return setError(f.errAmount);
    const name = String(form.get("name") ?? "").trim();
    if (!name) return setError(f.errName);
    const counterparty = String(form.get("counterparty") ?? "").trim();
    const categoryId = Number(form.get("categoryId"));
    const res = await api("POST", "/api/recurring", {
      name,
      type,
      expectedAmount: cents,
      dayOfMonth: Number(form.get("day")),
      frequency: String(form.get("frequency")),
      matchCounterparty: counterparty || name,
      categoryId: categoryId > 0 ? categoryId : null,
      startDate: String(form.get("start")),
      tolerance: Math.round(cents * 0.1),
    });
    if (!res.ok) return setError(res.error);
    setOpen(false);
    startTransition(() => router.refresh());
  }

  if (!open)
    return (
      <GhostButton type="button" onClick={() => setOpen(true)}>
        <span className="inline-flex items-center gap-1.5">
          <Plus className="size-4" /> {f.open}
        </span>
      </GhostButton>
    );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit(new FormData(e.currentTarget));
      }}
      className="glass fade-in grid gap-4 p-4"
    >
      <div role="radiogroup" aria-label={f.kind} className="liquid seg w-fit">
        {(["expense", "income"] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={type === kind}
            onClick={() => setType(kind)}
            className="seg-item min-h-10 px-4 text-sm font-semibold"
          >
            {kind === "expense" ? f.expense : f.income}
          </button>
        ))}
      </div>
      <Field label={f.name}>
        <input
          name="name"
          required
          maxLength={100}
          className={inputClass}
          placeholder={f.namePlaceholder}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={f.amount}>
          <input
            name="amount"
            required
            inputMode="decimal"
            className={inputClass}
            placeholder={f.amountPlaceholder}
          />
        </Field>
        <Field label={f.day}>
          <input
            name="day"
            type="number"
            min={1}
            max={31}
            defaultValue={1}
            required
            className={inputClass}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={f.frequency}>
          <select name="frequency" className={inputClass} defaultValue="monthly">
            <option value="monthly">{f.monthly}</option>
            <option value="quarterly">{f.quarterly}</option>
            <option value="yearly">{f.yearly}</option>
          </select>
        </Field>
        <Field label={f.category}>
          <select name="categoryId" className={inputClass} defaultValue="0">
            <option value="0">{f.none}</option>
            {categories
              .filter((c) => c.type === type)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {categoryLabel(c.name, locale)}
                </option>
              ))}
          </select>
        </Field>
      </div>
      <Field label={f.counterparty} hint={f.counterpartyHint}>
        <input name="counterparty" maxLength={100} className={inputClass} />
      </Field>
      <Field label={f.from}>
        <input
          name="start"
          type="date"
          defaultValue={`${today.slice(0, 7)}-01`}
          required
          className={inputClass}
        />
      </Field>
      <ErrorLine message={error} />
      <div className="flex gap-2">
        <PrimaryButton type="submit" disabled={busy}>
          {f.save}
        </PrimaryButton>
        <GhostButton type="button" onClick={() => setOpen(false)}>
          {t.ui.common.cancel}
        </GhostButton>
      </div>
    </form>
  );
}
