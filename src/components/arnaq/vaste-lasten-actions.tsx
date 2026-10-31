"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { useI18n } from "@/i18n/client";
import { api, euroInputToCents } from "@/lib/client/api";
import { categoryLabel } from "@/lib/view/categories";
import { formatter } from "@/lib/view/format";
import { CategoryIcon } from "./category-icon";
import { ErrorLine, Field, GhostButton, PrimaryButton, inputClass } from "./form";
import type { LinkableTransaction } from "@/lib/recurring/linkable";
import { ChaseSpinner } from "./motion";
import { useAction } from "./use-action";

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
  const { locale, t } = useI18n();
  const { euroExact: euro } = formatter(locale);
  const { run, pending: busy, error } = useAction();
  const done = t.ui.fixed.done;

  function act(path: "accept" | "reject", s: SuggestionView) {
    return run(
      () => api("POST", `/api/recurring/suggestions/${path}`, { key: s.key, type: s.type }),
      { success: path === "accept" ? done.added : done.dismissed },
    );
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
  const { locale, t } = useI18n();
  const { euroExact: euro } = formatter(locale);
  const { run: act, pending: busy, error } = useAction();
  const [confirming, setConfirming] = useState<number | null>(null);
  const done = t.ui.fixed.done;

  async function run(call: () => ReturnType<typeof api>, success: string) {
    if (await act(call, { success })) setConfirming(null);
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
                onClick={() =>
                  run(
                    () => api("PATCH", `/api/recurring/${it.id}`, { active: !it.active }),
                    it.active ? done.paused : done.resumed,
                  )
                }
              >
                {it.active ? t.ui.fixed.item.pause : t.ui.fixed.item.resume}
              </GhostButton>
              {confirming === it.id ? (
                <>
                  <PrimaryButton
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      run(() => api("DELETE", `/api/recurring/${it.id}`), done.removed)
                    }
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

/** Start from one of the person's own transactions: tapping one fills in the form, which can still be edited. */
function TransactionPicker({
  transactions,
  onPick,
}: {
  transactions: LinkableTransaction[];
  onPick: (t: LinkableTransaction) => void;
}) {
  const { locale, t } = useI18n();
  const f = t.ui.fixed.form;
  const { euroExact: euro, dayLabel } = formatter(locale);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = transactions
    .filter(
      (x) => q === "" || `${x.counterparty ?? ""} ${x.description ?? ""}`.toLowerCase().includes(q),
    )
    .slice(0, 30);
  return (
    <div className="grid gap-2">
      <Field label={f.pick} hint={f.pickHint}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={f.pickSearch}
          className={inputClass}
        />
      </Field>
      <ul className="bg-soft border-hair max-h-56 divide-y divide-[var(--hair,rgba(127,127,127,.2))] overflow-y-auto rounded-2xl border">
        {shown.length === 0 ? (
          <li className="text-ink-muted px-4 py-3 text-[14px]">{f.pickNone}</li>
        ) : (
          shown.map((x) => (
            <li key={x.id}>
              <button
                type="button"
                onClick={() => onPick(x)}
                className="grid min-h-11 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2 text-left"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-semibold">
                    {x.counterparty ?? x.description}
                  </span>
                  <span className="text-ink-muted block text-[13px]">
                    {dayLabel(x.date)}
                    {x.count > 1 ? ` · ${f.pickTimes(x.count)}` : ""}
                  </span>
                </span>
                <span className="num text-[15px] font-semibold">{euro(x.amount)}</span>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

/** Add a fixed cost: from one of your transactions, or by hand. */
export function AddItemForm({
  categories,
  today,
  linkable,
}: {
  categories: Cat[];
  today: string;
  linkable: LinkableTransaction[];
}) {
  const { locale, t } = useI18n();
  const f = t.ui.fixed.form;
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"expense" | "income">("expense");
  // The transaction the form was filled from; the fields restart from it (and stay editable).
  const [picked, setPicked] = useState<LinkableTransaction | null>(null);
  const pickedType = picked === null ? null : picked.amount < 0 ? "expense" : "income";
  const pickedCategory = picked?.categoryId ?? 0;
  const startFrom = picked ? `${picked.date.slice(0, 7)}-01` : `${today.slice(0, 7)}-01`;
  const [formError, setFormError] = useState<string | null>(null);
  const { run, pending: busy, error: apiError } = useAction();
  const error = formError ?? apiError;

  async function submit(form: FormData) {
    setFormError(null);
    const cents = euroInputToCents(String(form.get("amount") ?? ""));
    if (cents === null || cents === 0) return setFormError(f.errAmount);
    const name = String(form.get("name") ?? "").trim();
    if (!name) return setFormError(f.errName);
    const counterparty = String(form.get("counterparty") ?? "").trim();
    const categoryId = Number(form.get("categoryId"));
    const ok = await run(
      () =>
        api("POST", "/api/recurring", {
          name,
          type,
          expectedAmount: cents,
          dayOfMonth: Number(form.get("day")),
          frequency: String(form.get("frequency")),
          matchCounterparty: counterparty || name,
          categoryId: categoryId > 0 ? categoryId : null,
          startDate: String(form.get("start")),
          tolerance: Math.round(cents * 0.1),
        }),
      { success: t.ui.fixed.done.created },
    );
    if (ok) setOpen(false);
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
            onClick={() => {
              setType(kind);
              setPicked(null);
            }}
            className="seg-item min-h-10 px-4 text-sm font-semibold"
          >
            {kind === "expense" ? f.expense : f.income}
          </button>
        ))}
      </div>
      {picked === null ? (
        <TransactionPicker
          transactions={linkable.filter((x) => (type === "expense") === x.amount < 0)}
          onPick={setPicked}
        />
      ) : (
        <div className="bg-soft flex flex-wrap items-center justify-between gap-2 rounded-2xl px-4 py-2 text-[14px]">
          <span className="min-w-0 truncate">
            {f.pickedFrom(picked.counterparty ?? picked.description ?? "")}
          </span>
          <button
            type="button"
            onClick={() => setPicked(null)}
            className="text-accent min-h-11 font-semibold"
          >
            {f.pickClear}
          </button>
        </div>
      )}
      <div key={picked?.id ?? 0} className="grid gap-4">
        <Field label={f.name}>
          <input
            name="name"
            defaultValue={picked ? (picked.counterparty ?? picked.description ?? "") : undefined}
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
              defaultValue={
                picked
                  ? (Math.abs(picked.amount) / 100)
                      .toFixed(2)
                      .replace(".", locale === "nl" ? "," : ".")
                  : undefined
              }
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
              defaultValue={picked ? Number(picked.date.slice(8, 10)) : 1}
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
            <select
              name="categoryId"
              className={inputClass}
              defaultValue={
                pickedType === type &&
                categories.some(
                  (c) => c.id === pickedCategory && (c.type === type || c.type === "savings"),
                )
                  ? String(pickedCategory)
                  : "0"
              }
            >
              <option value="0">{f.none}</option>
              {categories
                // An outgoing item can also put money aside (a Savings category), e.g. a monthly BTW reserve.
                .filter((c) => c.type === type || (type === "expense" && c.type === "savings"))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {categoryLabel(c.name, locale)}
                  </option>
                ))}
            </select>
          </Field>
        </div>
        <Field label={f.counterparty} hint={f.counterpartyHint}>
          <input
            name="counterparty"
            maxLength={100}
            defaultValue={picked ? (picked.counterparty ?? "") : undefined}
            className={inputClass}
          />
        </Field>
        <Field label={f.from}>
          <input
            name="start"
            type="date"
            defaultValue={startFrom}
            required
            className={inputClass}
          />
        </Field>
      </div>
      <ErrorLine message={error} />
      <div className="flex gap-2">
        <PrimaryButton type="submit" disabled={busy}>
          {busy ? (
            <span className="inline-flex items-center gap-2">
              <ChaseSpinner />
              {f.save}
            </span>
          ) : (
            f.save
          )}
        </PrimaryButton>
        <GhostButton type="button" onClick={() => setOpen(false)}>
          {t.ui.common.cancel}
        </GhostButton>
      </div>
    </form>
  );
}
