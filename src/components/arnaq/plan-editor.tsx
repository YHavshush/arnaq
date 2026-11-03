"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "@/i18n/client";
import { formatter } from "@/lib/view/format";
import { api } from "@/lib/client/api";
import type { Plan } from "@/lib/view/plan";
import {
  DEFAULT_SCOPE,
  amountToInput,
  editorStart,
  findCell,
  monthWord,
  parseAmountInput,
  resetLabel,
  rowLabel,
  savePayload,
  savedMessage,
  showRedundant,
  whySentence,
  type Scope,
} from "@/lib/view/plan-grid";
import { ErrorLine, GhostButton, PrimaryButton } from "./form";
import { useAction } from "./use-action";

export const DIALOG_CLASS =
  "sheet bg-surface text-ink border-hair backdrop:bg-ink/40 m-0 mt-auto max-h-[90dvh] w-full max-w-none overflow-y-auto rounded-t-3xl border p-0 shadow-xl @min-[900px]/app:[inset:auto] @min-[900px]/app:[top:var(--pop-top,auto)] @min-[900px]/app:[bottom:var(--pop-bottom,auto)] @min-[900px]/app:[left:var(--pop-left,1rem)] @min-[900px]/app:mt-0 @min-[900px]/app:w-[23rem] @min-[900px]/app:max-w-[calc(100vw-2rem)] @min-[900px]/app:rounded-3xl @min-[900px]/app:backdrop:bg-transparent";

/** The editor holds one number, so its popover is narrower than the "add" dialog's. */
const EDITOR_REM = 20;
const EDITOR_CLASS = DIALOG_CLASS.replace(
  "@min-[900px]/app:w-[23rem]",
  "@min-[900px]/app:w-[20rem]", // written out in full so Tailwind finds it
);

/** The cell being edited: the row's key and the month, and the element to give focus back to. */
export interface EditTarget {
  rowKey: string;
  month: string;
  anchor: HTMLElement | null;
}

/**
 * The editor for one cell: a popover next to the cell on a laptop (app width 900px or more), a sheet from the bottom
 * on a phone. A native modal <dialog> gives the focus handling and Escape; Enter in the box saves. Closing always goes
 * through the dialog's own close, and focus goes back to the cell that opened it.
 */
export function PlanEditor({
  plan,
  target,
  onClose,
}: {
  plan: Plan;
  target: EditTarget | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const open = target !== null;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (target && !dialog.open) {
      place(dialog, target.anchor, EDITOR_REM);
      dialog.showModal();
      fit(dialog, target.anchor);
      const input = dialog.querySelector<HTMLInputElement>("input[inputmode=decimal]");
      input?.focus();
      input?.select();
    }
    if (!open && dialog.open) dialog.close();
    // Only when it opens or closes: moving to another cell goes through a close first.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const found = target ? findCell(plan, target.rowKey, target.month) : null;

  return (
    <dialog
      ref={ref}
      aria-labelledby={target ? "plan-editor-title" : undefined}
      onClose={() => {
        target?.anchor?.focus({ preventScroll: true });
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close(); // a tap on the dimmed area
      }}
      className={EDITOR_CLASS}
    >
      {open && found && (
        <EditorBody
          key={`${target.rowKey}:${target.month}`}
          plan={plan}
          rowKey={target.rowKey}
          month={target.month}
          close={() => ref.current?.close()}
        />
      )}
    </dialog>
  );
}

/** Put the popover under (or, near the bottom of the screen, over) the cell. A phone's sheet ignores this. */
export function place(dialog: HTMLDialogElement, anchor: HTMLElement | null, rem = 23) {
  const style = dialog.style;
  style.removeProperty("--pop-top");
  style.removeProperty("--pop-bottom");
  style.removeProperty("--pop-left");
  if (!anchor) return;
  const r = anchor.getBoundingClientRect();
  const width = rem * 16;
  const left = Math.max(
    16,
    Math.min(r.left + r.width / 2 - width / 2, window.innerWidth - width - 16),
  );
  style.setProperty("--pop-left", `${left}px`);
  style.setProperty("--pop-top", `${r.bottom + 8}px`);
}

/** Once it is open and its height is known: under the cell if it fits, else over it, else as high as it must be. */
export function fit(dialog: HTMLDialogElement, anchor: HTMLElement | null) {
  if (!anchor) return;
  const r = anchor.getBoundingClientRect();
  const h = dialog.getBoundingClientRect().height;
  const below = r.bottom + 8;
  let top = below;
  if (below + h > window.innerHeight - 16)
    top = r.top - 8 - h >= 16 ? r.top - 8 - h : Math.max(16, window.innerHeight - h - 16);
  dialog.style.setProperty("--pop-top", `${top}px`);
}

function EditorBody({
  plan,
  rowKey,
  month,
  close,
}: {
  plan: Plan;
  rowKey: string;
  month: string;
  close: () => void;
}) {
  const { locale, t } = useI18n();
  const text = t.ui.plan;
  const e = text.editor;
  const f = formatter(locale);
  const found = findCell(plan, rowKey, month)!;
  const { row, cell } = found;
  const [value, setValue] = useState(amountToInput(editorStart(cell), locale));
  const [scope, setScope] = useState<Scope>(DEFAULT_SCOPE);
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const { run, pending, error } = useAction();
  const scopeName = useId();

  // Close once the grid behind has the new numbers, so the cell never flashes its old value.
  useEffect(() => {
    if (done && !pending) close();
  }, [done, pending, close]);

  const busy = pending || done;
  const names = { short: f.monthShort, word: (m: string) => monthWord(locale, m) };
  const why = whySentence(text, cell.why, f.euro(cell.suggestion), names);

  async function send(amount: number | null) {
    const ok = await run(() => api("PUT", "/api/plan", savePayload(row, month, amount, scope)), {
      success: savedMessage(text, scope, amount === null),
    });
    if (ok) setDone(true);
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setFormError(null);
    const parsed = parseAmountInput(value);
    if (!parsed.ok) return setFormError(e.errAmount);
    await send(parsed.cents);
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-[minmax(0,1fr)] gap-3 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="plan-editor-title" className="font-display text-lg font-medium">
          {e.title(rowLabel(row, text.rows, locale), monthWord(locale, month))}
        </h2>
      </div>

      <label className="grid grid-cols-[minmax(0,1fr)] gap-1.5 text-sm font-medium">
        {e.amountLabel}
        <span className="bg-soft border-hair focus-within:border-accent flex min-h-11 items-center gap-2 rounded-2xl border px-3">
          <span aria-hidden className="text-ink-muted text-lg">
            €
          </span>
          <input
            inputMode="decimal"
            enterKeyHint="done"
            autoComplete="off"
            value={value}
            disabled={busy}
            onChange={(ev) => setValue(ev.target.value)}
            aria-invalid={formError ? true : undefined}
            className="w-full min-w-0 flex-1 bg-transparent text-xl font-semibold tabular-nums outline-none"
          />
        </span>
      </label>

      <fieldset className="grid min-w-0 gap-1.5">
        <legend className="mb-1 text-sm font-medium">{e.scopeLabel}</legend>
        <div className="bg-soft grid grid-cols-2 gap-0.5 rounded-2xl p-[3px]">
          {(
            [
              ["month", e.scopeMonth],
              ["after", e.scopeAfter],
            ] as const
          ).map(([id, label]) => (
            <label
              key={id}
              className="has-[:checked]:bg-surface has-[:focus-visible]:outline-accent grid min-h-10 cursor-pointer place-items-center rounded-[13px] px-2 py-1.5 text-center text-[13.5px] leading-tight font-semibold has-[:checked]:shadow-sm has-[:focus-visible]:outline-2"
            >
              <input
                type="radio"
                name={scopeName}
                checked={scope === id}
                disabled={busy}
                onChange={() => setScope(id)}
                className="sr-only"
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      {why && <p className="text-ink-muted text-[13.5px]">{why}</p>}
      {showRedundant(row, cell) && <p className="text-[13.5px] font-medium">{e.redundant}</p>}

      <ErrorLine message={formError ?? error} />

      <div className="flex flex-wrap items-center gap-2">
        <PrimaryButton type="submit" disabled={busy}>
          {busy ? e.saving : e.save}
        </PrimaryButton>
        <GhostButton type="button" onClick={close} disabled={busy}>
          {t.ui.common.cancel}
        </GhostButton>
        {cell.typed !== null && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void send(null)}
            className="text-accent min-h-11 rounded-full px-2 text-[13.5px] font-semibold underline underline-offset-4 disabled:opacity-50"
          >
            {resetLabel(text, row, f.euro(cell.suggestion))}
          </button>
        )}
      </div>
    </form>
  );
}
