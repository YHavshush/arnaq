"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/client/api";
import { formatter } from "@/lib/view/format";
import type { Plan } from "@/lib/view/plan";
import { addDefaults, newItemBody, untilChoices, type NewKind } from "@/lib/view/plan-grid";
import { DIALOG_CLASS, fit, place } from "./plan-editor";
import { ErrorLine, GhostButton, PrimaryButton, inputClass } from "./form";
import { useAction } from "./use-action";

/** Which kind of row is being added, and the element to give focus back to. */
export interface AddTarget {
  kind: NewKind;
  anchor: HTMLElement | null;
}

/**
 * "Add income" / "Add fixed cost": a small dialog in the style of the cell editor that creates a real fixed item
 * (the Fixed page's own endpoint). It starts in a month of the grid (by default the month after this one) and can end.
 */
export function PlanAddDialog({
  plan,
  target,
  onClose,
}: {
  plan: Plan;
  target: AddTarget | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const open = target !== null;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (target && !dialog.open) {
      place(dialog, target.anchor);
      dialog.showModal();
      fit(dialog, target.anchor);
      dialog.querySelector<HTMLInputElement>("input[name=name]")?.focus();
    }
    if (!open && dialog.open) dialog.close();
    // Only when it opens or closes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={target ? "plan-add-title" : undefined}
      onClose={() => {
        target?.anchor?.focus({ preventScroll: true });
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close();
      }}
      className={DIALOG_CLASS}
    >
      {target && (
        <AddBody
          key={target.kind}
          plan={plan}
          kind={target.kind}
          close={() => ref.current?.close()}
        />
      )}
    </dialog>
  );
}

function AddBody({ plan, kind, close }: { plan: Plan; kind: NewKind; close: () => void }) {
  const { locale, t } = useI18n();
  const a = t.ui.plan.add;
  const f = formatter(locale);
  const defaults = addDefaults(plan, kind);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [day, setDay] = useState(String(defaults.day));
  const [from, setFrom] = useState(defaults.from);
  const [until, setUntil] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const { run, pending, error } = useAction();
  const busy = pending || done;

  // Close once the grid behind has the new row.
  useEffect(() => {
    if (done && !pending) close();
  }, [done, pending, close]);

  // An end before the start makes no sense: moving the start past it clears it.
  const ends = untilChoices(plan, from);
  const untilValue = ends.includes(until) ? until : "";

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setFormError(null);
    const built = newItemBody({ kind, name, amount, day, from, until: untilValue || null });
    if (!built.ok)
      return setFormError(
        built.error === "name" ? a.errName : built.error === "amount" ? a.errAmount : a.errDay,
      );
    const ok = await run(() => api("POST", "/api/recurring", built.body), {
      success: a.created(name.trim()),
    });
    if (ok) setDone(true);
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-[minmax(0,1fr)] gap-4 p-5">
      <h2 id="plan-add-title" className="font-display text-xl font-medium">
        {kind === "income" ? a.incomeTitle : a.costTitle}
      </h2>
      <label className="grid grid-cols-[minmax(0,1fr)] gap-1.5 text-sm font-medium">
        {a.name}
        <input
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          autoComplete="off"
          disabled={busy}
          placeholder={kind === "income" ? a.incomePlaceholder : a.costPlaceholder}
          className={inputClass}
        />
      </label>
      <div className="grid grid-cols-2 items-end gap-3">
        <label className="grid min-w-0 gap-1.5 text-sm font-medium">
          {a.amount}
          <span className="bg-soft border-hair focus-within:border-accent flex min-h-11 items-center gap-2 rounded-xl border px-3">
            <span aria-hidden className="text-ink-muted">
              €
            </span>
            <input
              inputMode="decimal"
              autoComplete="off"
              value={amount}
              disabled={busy}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full min-w-0 flex-1 bg-transparent text-base font-semibold tabular-nums outline-none"
            />
          </span>
        </label>
        <label className="grid min-w-0 gap-1.5 text-sm font-medium">
          {a.day}
          <input
            type="number"
            min={1}
            max={31}
            value={day}
            disabled={busy}
            onChange={(e) => setDay(e.target.value)}
            className={inputClass}
          />
        </label>
      </div>
      <div className="grid grid-cols-1 gap-3">
        <label className="grid min-w-0 gap-1.5 text-sm font-medium">
          {a.from}
          <select
            value={from}
            disabled={busy}
            onChange={(e) => setFrom(e.target.value)}
            className={inputClass}
          >
            {plan.months.map((m) => (
              <option key={m} value={m}>
                {f.monthName(m)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid min-w-0 gap-1.5 text-sm font-medium">
          {a.until}
          <select
            value={untilValue}
            disabled={busy}
            onChange={(e) => setUntil(e.target.value)}
            className={inputClass}
          >
            <option value="">{a.noEnd}</option>
            {ends.map((m) => (
              <option key={m} value={m}>
                {f.monthName(m)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-ink-muted text-[13.5px]">{a.fromHint}</p>
      <ErrorLine message={formError ?? error} />
      <div className="flex flex-wrap items-center gap-2">
        <PrimaryButton type="submit" disabled={busy}>
          {busy ? a.saving : a.save}
        </PrimaryButton>
        <GhostButton type="button" onClick={close} disabled={busy}>
          {t.ui.common.cancel}
        </GhostButton>
      </div>
    </form>
  );
}
