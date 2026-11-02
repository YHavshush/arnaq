"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/i18n/client";
import type { Messages } from "@/i18n/messages";
import { formatter, type Formatter } from "@/lib/view/format";
import type { Plan, PlanCell, PlanRow } from "@/lib/view/plan";
import {
  canEdit,
  canShowAll,
  cellAriaLabel,
  cellState,
  hasDot,
  monthWord,
  pickMonth,
  rowLabel,
  showYear,
  variableRows,
  type CellState,
} from "@/lib/view/plan-grid";
import { PlanEditor, type EditTarget } from "./plan-editor";

type Text = Messages["ui"]["plan"];

/** How each kind of cell looks. Typed is blue, planned is lavender, both with a dot; a suggestion is italic grey. */
const LOOK: Record<CellState, string> = {
  typed:
    "bg-[var(--chip-sky)] text-[var(--chip-sky-ink)] font-bold shadow-[inset_0_0_0_1.5px_var(--ring-accent-from)]",
  planned:
    "bg-[var(--chip-lavender)] text-[var(--chip-lavender-ink)] font-bold shadow-[inset_0_0_0_1.5px_var(--chip-lavender-ink)]",
  suggestion: "text-ink-muted italic",
  fixed: "text-ink",
  computed: "text-ink-muted",
  locked: "text-ink-muted",
};

interface Section {
  id: "income" | "fixed" | "variable";
  title: string;
  rows: PlanRow[];
}

function sectionsOf(plan: Plan, text: Text, showAll: boolean): Section[] {
  // The BTW follows the client's income, so it sits with the fixed costs, and only when there is any.
  const btw = plan.sections.btw.filter((r) => r.cells.some((c) => c.amount !== 0));
  const out: Section[] = [
    { id: "income", title: text.sections.income, rows: plan.sections.income },
    { id: "fixed", title: text.sections.fixed, rows: [...plan.sections.fixed, ...btw] },
    { id: "variable", title: text.sections.variable, rows: variableRows(plan, showAll) },
  ];
  return out.filter((s) => s.rows.length > 0);
}

/** The plan: a table on a laptop, one month at a time on a phone. One editor serves both. */
export function PlanScreen({ plan }: { plan: Plan }) {
  const { locale, t } = useI18n();
  const text = t.ui.plan;
  const f = formatter(locale);
  const [showAll, setShowAll] = useState(false);
  const [edit, setEdit] = useState<EditTarget | null>(null);
  const sections = sectionsOf(plan, text, showAll);
  const open = (rowKey: string, month: string, anchor: HTMLElement) =>
    setEdit({ rowKey, month, anchor });

  const toggle = canShowAll(plan) ? (
    <button
      type="button"
      aria-expanded={showAll}
      onClick={() => setShowAll((v) => !v)}
      className="text-accent min-h-11 rounded-full px-2 text-[13.5px] font-semibold underline underline-offset-4"
    >
      {showAll ? text.showFewer : text.showAll(plan.allCategories.length)}
    </button>
  ) : null;

  return (
    <>
      <div className="hidden @min-[900px]/app:block">
        <Table plan={plan} sections={sections} f={f} open={open} toggle={toggle} />
      </div>
      <div className="@min-[900px]/app:hidden">
        <Phone plan={plan} sections={sections} f={f} open={open} toggle={toggle} />
      </div>
      <PlanEditor plan={plan} target={edit} onClose={() => setEdit(null)} />
    </>
  );
}

type Opener = (rowKey: string, month: string, anchor: HTMLElement) => void;

interface ViewProps {
  plan: Plan;
  sections: Section[];
  f: Formatter;
  open: Opener;
  toggle: ReactNode;
}

/** The amount, with its dot (typed, planned) or its "=" (follows other numbers). */
function Amount({ state, children }: { state: CellState; children: ReactNode }) {
  return (
    <>
      {hasDot(state) && (
        <i
          aria-hidden
          className="mr-1.5 inline-block size-1.5 rounded-full bg-current align-middle"
        />
      )}
      {state === "computed" && (
        <i aria-hidden className="mr-1 not-italic opacity-60">
          =
        </i>
      )}
      {children}
    </>
  );
}

function Legend({ text, toggle }: { text: Text; toggle: ReactNode }) {
  const swatch = "mr-1.5 inline-block size-3.5 rounded-[5px] align-[-3px]";
  return (
    <div className="border-hair text-ink-muted flex flex-wrap items-center gap-x-5 gap-y-1 border-t px-5 py-2 text-xs">
      <span>
        <i className={`${swatch} bg-soft`} />
        <em>{text.legend.suggestion}</em>
      </span>
      <span>
        <i
          className={`${swatch} bg-[var(--chip-sky)] shadow-[inset_0_0_0_1.5px_var(--ring-accent-from)]`}
        />
        {text.legend.typed}
      </span>
      <span>
        <i
          className={`${swatch} bg-[var(--chip-lavender)] shadow-[inset_0_0_0_1.5px_var(--chip-lavender-ink)]`}
        />
        {text.legend.planned}
      </span>
      <span>
        <i aria-hidden className="mr-1.5 not-italic opacity-70">
          =
        </i>
        {text.legend.computed}
      </span>
      <span className="ml-auto">{toggle}</span>
    </div>
  );
}

/* ---------------------------------------------------------------- laptop */

function Table({ plan, sections, f, open, toggle }: ViewProps) {
  const { t } = useI18n();
  const text = t.ui.plan;
  const cols = plan.months.length;
  const stick = "bg-surface sticky left-0 z-[1]";
  const th = "text-ink-muted px-2 pt-3 pb-2 text-right text-[13px] font-semibold align-bottom";

  return (
    <div className="glass bg-surface overflow-hidden">
      <div className="overflow-x-auto overscroll-x-contain">
        <table className="w-full border-separate border-spacing-0 text-[14px] tabular-nums">
          <caption className="sr-only">{text.tableCaption}</caption>
          <thead>
            <tr>
              <th scope="col" className={`${stick} w-44 min-w-44 px-4 pt-3 pb-2 text-left`}>
                <span className="sr-only">{text.rowHeader}</span>
              </th>
              {plan.months.map((m, i) => (
                <th
                  key={m}
                  scope="col"
                  className={`${th} min-w-[5.75rem] ${m === plan.currentMonth ? "!text-ink" : ""}`}
                >
                  {f.monthShort(m)}
                  <small className="block min-h-3.5 text-[11px] leading-tight font-normal">
                    {m === plan.currentMonth ? text.thisMonth : showYear(m, i) ? m.slice(0, 4) : ""}
                  </small>
                </th>
              ))}
            </tr>
          </thead>
          {sections.map((s) => (
            <tbody key={s.id}>
              <tr>
                <th
                  scope="rowgroup"
                  className={`${stick} font-display px-4 pt-5 pb-1 text-left text-[17px] font-medium`}
                >
                  {s.title}
                </th>
                <td colSpan={cols} />
              </tr>
              {s.rows.map((row) => (
                <tr key={row.key}>
                  <th
                    scope="row"
                    className={`${stick} border-hair border-t px-4 py-1 text-left text-[14px] font-semibold`}
                  >
                    {rowLabel(row, text.rows)}
                  </th>
                  {row.cells.map((cell) => (
                    <GridCell key={cell.month} row={row} cell={cell} f={f} open={open} />
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
          <tfoot>
            <FootRow
              first
              label={text.footer.income}
              values={plan.footer.map((x) => f.euro(x.income))}
            />
            <FootRow
              label={text.footer.expenses}
              values={plan.footer.map((x) => f.euro(x.expenses))}
            />
            <FootRow
              label={text.footer.growth}
              values={plan.footer.map((x) => f.euroSigned(x.growth))}
              tones={plan.footer.map((x) => (x.growth < 0 ? "text-bad" : "text-good"))}
            />
            <FootRow
              strong
              label={text.footer.netWorth}
              values={plan.footer.map((x) => f.euro(x.netWorth))}
              tones={plan.footer.map((x) => (x.netWorth < 0 ? "text-bad" : ""))}
            />
          </tfoot>
        </table>
      </div>
      <Legend text={text} toggle={toggle} />
    </div>
  );
}

function FootRow({
  label,
  values,
  tones,
  strong,
  first,
}: {
  label: string;
  values: string[];
  tones?: string[];
  strong?: boolean;
  first?: boolean;
}) {
  const edge = strong || first ? "border-t-2 border-ink/25" : "border-t border-hair";
  return (
    <tr>
      <th
        scope="row"
        className={`bg-surface sticky left-0 z-[1] ${edge} px-4 py-2 text-left font-semibold ${strong ? "text-[15px]" : ""}`}
      >
        {label}
      </th>
      {values.map((v, i) => (
        <td
          key={i}
          className={`${edge} px-4 py-2 text-right font-semibold ${strong ? "text-[15px]" : ""} ${tones?.[i] ?? ""}`}
        >
          {v}
        </td>
      ))}
    </tr>
  );
}

function GridCell({
  row,
  cell,
  f,
  open,
}: {
  row: PlanRow;
  cell: PlanCell;
  f: Formatter;
  open: Opener;
}) {
  const { locale, t } = useI18n();
  const text = t.ui.plan;
  const state = cellState(row, cell);
  const amount = f.euro(cell.amount);
  const label = cellAriaLabel(
    text,
    rowLabel(row, text.rows),
    monthWord(locale, cell.month),
    amount,
    state,
  );
  return (
    <td className="border-hair border-t p-0.5 text-right">
      {canEdit(row, cell) ? (
        <button
          type="button"
          aria-label={label}
          onClick={(e) => open(row.key, cell.month, e.currentTarget)}
          className={`hover:bg-soft focus-visible:outline-accent block min-h-10 w-full rounded-xl px-3 py-1.5 text-right whitespace-nowrap focus-visible:outline-2 ${LOOK[state]}`}
        >
          <Amount state={state}>{amount}</Amount>
        </button>
      ) : (
        <span className={`block px-3 py-2 whitespace-nowrap ${LOOK[state]}`}>
          <span className="sr-only">{label}</span>
          <span aria-hidden>
            <Amount state={state}>{amount}</Amount>
          </span>
        </span>
      )}
    </td>
  );
}

/* ----------------------------------------------------------------- phone */

function Phone({ plan, sections, f, open, toggle }: ViewProps) {
  const { t } = useI18n();
  const text = t.ui.plan;
  const [wanted, setWanted] = useState<string | null>(null);
  const month = pickMonth(plan, wanted);
  const index = plan.months.indexOf(month);
  const foot = plan.footer[index];
  const chips = useRef<HTMLDivElement>(null);

  // Keep the chosen chip in view inside its own row (the page itself never scrolls sideways).
  useEffect(() => {
    const row = chips.current;
    const chip = row?.querySelector<HTMLElement>("[aria-pressed=true]");
    if (!row || !chip) return;
    row.scrollLeft = chip.offsetLeft - (row.clientWidth - chip.clientWidth) / 2;
  }, [month]);

  const pill = "bg-soft grid content-start gap-0.5 rounded-2xl px-2 py-2 text-center";

  return (
    <div className="grid gap-4">
      <div
        ref={chips}
        role="group"
        aria-label={text.monthGroup}
        className="-mx-4 flex [scrollbar-width:none] gap-1.5 overflow-x-auto px-4 pb-1"
      >
        {plan.months.map((m, i) => (
          <button
            key={m}
            type="button"
            aria-pressed={m === month}
            aria-label={f.monthName(m)}
            onClick={() => setWanted(m)}
            className={`focus-visible:outline-accent grid min-h-11 min-w-14 shrink-0 place-content-center rounded-full px-3 text-center text-sm leading-tight font-semibold focus-visible:outline-2 ${
              m === month ? "bg-action text-action-ink" : "bg-soft"
            }`}
          >
            {f.monthShort(m)}
            {showYear(m, i) && (
              <small className="text-[10.5px] font-normal opacity-75">{m.slice(0, 4)}</small>
            )}
          </button>
        ))}
      </div>

      <div className="glass overflow-hidden">
        {sections.map((s) => (
          <section key={s.id} aria-label={s.title}>
            <h3 className="font-display px-4 pt-4 pb-1 text-[17px] font-medium">{s.title}</h3>
            {s.rows.map((row) => {
              const cell = row.cells.find((c) => c.month === month);
              return cell ? (
                <PhoneRow key={row.key} row={row} cell={cell} f={f} open={open} />
              ) : null;
            })}
          </section>
        ))}
        <div className="border-hair border-t px-3 py-1">{toggle}</div>
      </div>

      {foot && (
        <div className="glass grid gap-3 p-4">
          <h3 className="font-display text-[19px] font-medium">{f.monthName(month)}</h3>
          <div className="grid grid-cols-3 gap-2">
            <div className={pill}>
              <span className="text-ink-muted text-[11.5px] leading-tight">
                {text.footer.income}
              </span>
              <b className="text-[14.5px] tabular-nums">{f.euro(foot.income)}</b>
            </div>
            <div className={pill}>
              <span className="text-ink-muted text-[11.5px] leading-tight">
                {text.footer.expenses}
              </span>
              <b className="text-[14.5px] tabular-nums">{f.euro(foot.expenses)}</b>
            </div>
            <div className={pill}>
              <span className="text-ink-muted text-[11.5px] leading-tight">
                {text.footer.growth}
              </span>
              <b
                className={`text-[14.5px] tabular-nums ${foot.growth < 0 ? "text-bad" : "text-good"}`}
              >
                {f.euroSigned(foot.growth)}
              </b>
            </div>
          </div>
          <p className="border-hair flex items-baseline justify-between gap-3 border-t pt-3 font-semibold">
            <span>{text.footer.netWorth}</span>
            <span className={`text-lg tabular-nums ${foot.netWorth < 0 ? "text-bad" : ""}`}>
              {f.euro(foot.netWorth)}
            </span>
          </p>
        </div>
      )}
    </div>
  );
}

function PhoneRow({
  row,
  cell,
  f,
  open,
}: {
  row: PlanRow;
  cell: PlanCell;
  f: Formatter;
  open: Opener;
}) {
  const { locale, t } = useI18n();
  const text = t.ui.plan;
  const state = cellState(row, cell);
  const name = rowLabel(row, text.rows);
  const amount = f.euro(cell.amount);
  const label = cellAriaLabel(text, name, monthWord(locale, cell.month), amount, state);
  const tint =
    state === "typed"
      ? "bg-[var(--chip-sky)] text-[var(--chip-sky-ink)]"
      : state === "planned"
        ? "bg-[var(--chip-lavender)] text-[var(--chip-lavender-ink)]"
        : "";
  const body = (
    <>
      <span className="min-w-0 font-medium">{name}</span>
      <span
        className={`shrink-0 tabular-nums ${state === "typed" || state === "planned" ? "font-bold" : ""} ${
          state === "suggestion"
            ? "text-ink-muted italic"
            : state === "computed" || state === "locked"
              ? "text-ink-muted"
              : ""
        }`}
      >
        <Amount state={state}>{amount}</Amount>
      </span>
    </>
  );
  const base = `border-hair flex min-h-12 w-full items-center justify-between gap-3 border-t px-4 py-2.5 text-left text-[15px] ${tint}`;
  return canEdit(row, cell) ? (
    <button
      type="button"
      aria-label={label}
      onClick={(e) => open(row.key, cell.month, e.currentTarget)}
      className={`${base} focus-visible:outline-accent focus-visible:outline-2 focus-visible:-outline-offset-2`}
    >
      {body}
    </button>
  ) : (
    <div className={base}>
      <span className="sr-only">{label}</span>
      <span aria-hidden className="flex w-full items-center justify-between gap-3">
        {body}
      </span>
    </div>
  );
}
