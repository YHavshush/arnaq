"use client";

import { displayName } from "@/lib/view/names";
import { LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import Link from "next/link";
import { Check, ChevronDown, X } from "lucide-react";
import { useId, useState } from "react";
import { useI18n } from "@/i18n/client";
import type { FixedListRow, FixedListSection } from "@/lib/view/fixed-list";
import type { TrackerCell } from "@/lib/view/fixed-tracker";
import { formatter } from "@/lib/view/format";
import { CategoryIcon } from "./category-icon";
import { ErrorLine, GhostButton, PrimaryButton } from "./form";
import { Section } from "./page-header";
import { StatusChip } from "./status-chip";
import { useItemActions } from "./vaste-lasten-actions";

export type ListRow = FixedListRow & {
  /** The stored (Dutch) category name: it picks the icon. */
  categoryName: string | null;
};
export type ListSection = Omit<FixedListSection, "rows"> & { rows: ListRow[] };

type Actions = ReturnType<typeof useItemActions>;

/** The dot of one month in an item's history. */
const DOT: Record<TrackerCell["kind"], string> = {
  paid: "bg-good/15 text-good",
  late: "bg-warn/15 text-warn",
  missed: "bg-bad/15 text-bad",
  expected: "border-accent text-ink-muted border-2",
  none: "text-ink-muted",
};

function HistoryDots({ row, month }: { row: ListRow; month: string }) {
  const { locale, t } = useI18n();
  const h = t.ui.fixed.row.history;
  const { euroExact, monthShort, monthName } = formatter(locale);
  const statusOf = (c: TrackerCell) => {
    const amount = euroExact(c.amount);
    if (c.kind === "paid") return h.status.paid(amount);
    if (c.kind === "late") return h.status.late(amount, c.lateDays ?? 0);
    if (c.kind === "missed") return h.status.missed(amount);
    if (c.kind === "expected") return h.status.expected(amount);
    return h.status.none;
  };
  return (
    <ol aria-label={h.label(row.name)} className="grid grid-cols-6 gap-1">
      {row.history.map((c) => {
        const status = statusOf(c);
        const full = monthName(c.month);
        const href =
          (c.kind === "paid" || c.kind === "late") && row.categoryId !== null && c.transactionMonth
            ? `/category/${row.categoryId}?month=${c.transactionMonth}`
            : null;
        const face = (
          <>
            <span
              aria-hidden
              className={`mx-auto grid size-7 place-items-center rounded-full ${DOT[c.kind]}`}
            >
              {c.kind === "paid" || c.kind === "late" ? (
                <Check className="size-4" strokeWidth={3} />
              ) : c.kind === "missed" ? (
                <X className="size-4" strokeWidth={3} />
              ) : c.kind === "none" ? (
                "–"
              ) : null}
            </span>
            <span
              aria-hidden
              className={`mt-1 block text-center text-[11px] ${
                c.month === month ? "text-ink font-semibold" : "text-ink-muted"
              }`}
            >
              {monthShort(c.month)}
            </span>
          </>
        );
        return (
          <li key={c.month}>
            {href ? (
              <Link
                href={href}
                aria-label={h.open(row.name, full, status)}
                className="block rounded-xl py-1 active:bg-black/5"
              >
                {face}
              </Link>
            ) : (
              <div className="py-1">
                {face}
                <span className="sr-only">{h.cell(row.name, full, status)}</span>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Chip({ row }: { row: ListRow }) {
  const { locale, t } = useI18n();
  const { dayLabel } = formatter(locale);
  const c = t.ui.fixed.row.chip;
  const day = row.date ? dayLabel(row.date) : "";
  switch (row.state) {
    case "paid":
      return (
        <StatusChip
          status="matched"
          label={row.type === "income" ? c.received(day) : c.paid(day)}
        />
      );
    case "late":
      return <StatusChip status="late" label={c.late(row.lateDays ?? 0)} />;
    case "due":
      return <StatusChip status="expected" label={c.due(day)} />;
    case "missed":
      return <StatusChip status="missed" label={c.missed(day)} />;
    case "paused":
      return <StatusChip status="idle" label={t.ui.fixed.item.paused} />;
    case "off":
      return <StatusChip status="idle" label={c.off} />;
  }
}

function FixedRow({
  row,
  month,
  open,
  onToggle,
  actions,
}: {
  row: ListRow;
  month: string;
  open: boolean;
  onToggle: () => void;
  actions: Actions;
}) {
  const { locale, t } = useI18n();
  const f = t.ui.fixed;
  const { euroExact: euro, dayLabel } = formatter(locale);
  const panel = useId();
  const reduced = useReducedMotion();
  const quiet = row.state === "paused" || row.state === "off";
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panel}
        onClick={onToggle}
        className="grid min-h-14 w-full grid-cols-[2.5rem_minmax(0,1fr)_auto_1rem] items-center gap-3 px-4 py-3 text-left active:bg-black/5"
      >
        <CategoryIcon name={row.categoryName} />
        <span className="min-w-0">
          <span className="block truncate text-base leading-tight font-semibold">
            {displayName(row.name)}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5">
            <Chip row={row} />
            {row.missedEarlier && row.state !== "missed" && (
              <StatusChip
                status="missed"
                label={f.row.missedEarlier(dayLabel(row.missedEarlier))}
              />
            )}
          </span>
        </span>
        <span
          className={`num text-right text-base font-semibold tracking-tight ${quiet ? "text-ink-muted" : ""}`}
        >
          {euro(row.amount)}
        </span>
        <ChevronDown
          aria-hidden
          className={`text-ink-muted size-4 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
        />
      </button>
      <LazyMotion features={domAnimation}>
        <m.div
          id={panel}
          initial={false}
          animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }}
          transition={reduced ? { duration: 0 } : { duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
          style={{ overflow: "hidden" }}
          inert={!open}
        >
          <div className="grid gap-3 px-4 pb-4">
            <p className="text-ink-muted text-[13px]">
              {f.item.meta(row.dayOfMonth, f.freq[row.frequency])}
            </p>
            {row.state === "missed" && (
              <p className="text-ink-muted text-[14px] leading-snug">{f.row.missedNote}</p>
            )}
            <HistoryDots row={row} month={month} />
            <div className="flex flex-wrap gap-2">
              <GhostButton
                type="button"
                disabled={actions.busy}
                onClick={() => actions.setActive(row.itemId, !row.active)}
              >
                {row.active ? f.item.pause : f.item.resume}
              </GhostButton>
              {actions.confirming === row.itemId ? (
                <>
                  <PrimaryButton
                    type="button"
                    disabled={actions.busy}
                    onClick={() => actions.remove(row.itemId)}
                  >
                    {f.item.confirmRemove}
                  </PrimaryButton>
                  <GhostButton type="button" onClick={actions.cancelRemove}>
                    {t.ui.common.cancel}
                  </GhostButton>
                </>
              ) : (
                <GhostButton
                  type="button"
                  disabled={actions.busy}
                  onClick={() => actions.askRemove(row.itemId)}
                >
                  {f.item.remove}
                </GhostButton>
              )}
            </div>
          </div>
        </m.div>
      </LazyMotion>
    </li>
  );
}

/**
 * The fixed items of the month, one row each, in two sections (expenses, income). The header of a
 * section carries its total and progress. Tapping a row opens its history (the last 6 months as
 * dots) and its actions (pause or resume, delete).
 */
export function FixedList({ sections, month }: { sections: ListSection[]; month: string }) {
  const { locale, t } = useI18n();
  const f = t.ui.fixed;
  const { euroExact } = formatter(locale);
  const actions = useItemActions();
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const toggle = (id: number) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <>
      {sections.map(
        (s) =>
          s.rows.length > 0 && (
            <Section
              key={s.type}
              title={s.type === "expense" ? f.expenses : f.income}
              aside={
                s.count > 0
                  ? (s.type === "expense" ? f.row.progressExpenses : f.row.progressIncome)(
                      euroExact(s.total),
                      s.done,
                      s.count,
                    )
                  : undefined
              }
            >
              <div className="glass overflow-hidden">
                <ul className="divide-hair divide-y">
                  {s.rows.map((row) => (
                    <FixedRow
                      key={row.itemId}
                      row={row}
                      month={month}
                      open={open.has(row.itemId)}
                      onToggle={() => toggle(row.itemId)}
                      actions={actions}
                    />
                  ))}
                </ul>
              </div>
            </Section>
          ),
      )}
      {actions.error && (
        <div className="mt-3 px-1">
          <ErrorLine message={actions.error} />
        </div>
      )}
    </>
  );
}
