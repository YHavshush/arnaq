"use client";

import { Check, Search, X } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useI18n } from "@/i18n/client";
import { categoryLabel } from "@/lib/view/categories";
import { CategoryIcon } from "./category-icon";

export interface PickerCategory {
  id: number;
  name: string;
  type: string;
}

interface SheetProps {
  open: boolean;
  /** What is being sorted, for the title ("Category for Albert Heijn"). */
  title: string;
  categories: PickerCategory[];
  /** Neither income nor spending: "between my own accounts" and "savings". Offered first. */
  special: PickerCategory[];
  /** Money coming in lists income first, money going out lists expenses first. */
  direction: "in" | "out";
  currentId?: number | null;
  onPick: (categoryId: number) => void;
  onClose: () => void;
}

/**
 * Every category in a sheet (bottom on a phone, centred on a laptop) instead of the browser's own
 * dropdown: icons, large touch targets, search. A native <dialog> gives focus handling, Escape and
 * the backdrop.
 */
export function CategorySheet(props: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const { open, onClose } = props;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={props.title}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose(); // a tap on the dimmed area
      }}
      className="sheet bg-surface text-ink border-hair backdrop:bg-ink/40 m-0 mt-auto max-h-[85dvh] w-full max-w-none overflow-hidden rounded-t-[24px] border p-0 shadow-xl md:m-auto md:max-w-md md:rounded-[24px]"
    >
      {open && <SheetBody {...props} />}
    </dialog>
  );
}

/**
 * Swipe the sheet's top (the grab handle and the title) down to close it: the sheet follows the finger, and
 * either flies off (a long or quick pull) or springs back. Touch and pen only; a mouse has the close button,
 * Escape and the backdrop. Taps on the close button are left alone.
 */
function useSheetDrag(onClose: () => void) {
  const drag = useRef<{ y: number; t: number; sheet: HTMLElement } | null>(null);
  const finish = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    const dy = Math.max(0, e.clientY - d.y);
    const speed = dy / Math.max(1, performance.now() - d.t); // px per ms
    d.sheet.style.transition = "transform 220ms cubic-bezier(.2,.8,.2,1)";
    if (e.type !== "pointercancel" && (dy > 110 || speed > 0.6)) {
      d.sheet.style.transform = "translateY(100%)";
      window.setTimeout(() => {
        onClose();
        d.sheet.style.transform = "";
        d.sheet.style.transition = "";
      }, 200);
    } else {
      d.sheet.style.transform = "";
      window.setTimeout(() => {
        d.sheet.style.transition = "";
      }, 230);
    }
  };
  return {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      if (e.pointerType === "mouse" || (e.target as HTMLElement).closest("button")) return;
      const sheet = e.currentTarget.closest("dialog");
      if (!sheet) return;
      drag.current = { y: e.clientY, t: performance.now(), sheet };
      sheet.style.transition = "none";
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (d) d.sheet.style.transform = `translateY(${Math.max(0, e.clientY - d.y)}px)`;
    },
    onPointerUp: finish,
    onPointerCancel: finish,
  };
}

// Mounted fresh on every open, so the search always starts empty.
function SheetBody({
  title,
  categories,
  special,
  direction,
  currentId,
  onPick,
  onClose,
}: SheetProps) {
  const { locale, t } = useI18n();
  const m = t.ui.upload.review;
  const dragHandlers = useSheetDrag(onClose);
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const matches = (c: PickerCategory) =>
    needle === "" || categoryLabel(c.name, locale).toLowerCase().includes(needle);

  const expenses = categories.filter((c) => c.type === "expense" && matches(c));
  const income = categories.filter((c) => c.type === "income" && matches(c));
  const groups = (
    direction === "in"
      ? [
          [m.income, income],
          [m.expenses, expenses],
        ]
      : [
          [m.expenses, expenses],
          [m.income, income],
        ]
  ) as [string, PickerCategory[]][];
  const shownSpecial = special.filter(matches);
  const empty = shownSpecial.length === 0 && expenses.length === 0 && income.length === 0;

  const row = (c: PickerCategory, hint?: string) => (
    <li key={c.id}>
      <button
        type="button"
        onClick={() => onPick(c.id)}
        aria-current={c.id === currentId ? "true" : undefined}
        className="hover:bg-soft grid min-h-14 w-full grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2 text-left"
      >
        <CategoryIcon name={c.name} />
        <span className="min-w-0">
          <span className="block truncate font-semibold">{categoryLabel(c.name, locale)}</span>
          {hint && <span className="text-ink-muted block text-[13px]">{hint}</span>}
        </span>
        {c.id === currentId && (
          <span className="text-accent flex items-center gap-1 text-[13px] font-semibold">
            <Check aria-hidden className="size-4" />
            {m.current}
          </span>
        )}
      </button>
    </li>
  );

  return (
    <div className="flex max-h-[85dvh] flex-col">
      <div {...dragHandlers} className="border-hair touch-none border-b md:touch-auto">
        <div aria-hidden className="bg-hair mx-auto mt-2 h-1 w-9 rounded-full md:hidden" />
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <h2 className="min-w-0 truncate text-lg font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={m.close}
            className="bg-soft grid size-11 shrink-0 place-items-center rounded-full"
          >
            <X aria-hidden className="size-5" />
          </button>
        </div>
      </div>
      <div className="px-4 pt-3 pb-2">
        <label className="bg-soft border-hair flex min-h-11 items-center gap-2 rounded-xl border px-3">
          <Search aria-hidden className="text-ink-muted size-4 shrink-0" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={m.search}
            aria-label={m.search}
            className="min-h-11 w-full bg-transparent text-base outline-none"
          />
        </label>
      </div>
      <div className="overflow-y-auto pb-4">
        {shownSpecial.length > 0 && (
          <ul className="border-hair border-b py-1">
            {shownSpecial.map((c) =>
              row(c, c.type === "savings" ? m.savingsHint : m.ownAccountsHint),
            )}
          </ul>
        )}
        {groups.map(
          ([label, list]) =>
            list.length > 0 && (
              <section key={label}>
                <h3 className="text-ink-muted px-4 pt-3 pb-1 text-[13px] font-semibold tracking-wide uppercase">
                  {label}
                </h3>
                <ul>{list.map((c) => row(c))}</ul>
              </section>
            ),
        )}
        {empty && <p className="text-ink-muted px-4 py-6 text-center text-[15px]">{m.noMatch}</p>}
      </div>
    </div>
  );
}
