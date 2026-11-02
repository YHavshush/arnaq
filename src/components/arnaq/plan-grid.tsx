"use client";

import { Plus } from "lucide-react";
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
  showsDash,
  isQuiet,
  monthWord,
  pickMonth,
  rowLabel,
  sectionTotals,
  showYear,
  variableRows,
  type CellState,
  type NewKind,
} from "@/lib/view/plan-grid";
import { PlanAddDialog, type AddTarget } from "./plan-add";
import { PlanEditor, type EditTarget } from "./plan-editor";

type Text = Messages["ui"]["plan"];

/**
 * How each kind of cell looks. Typed is bold in the blue ink and planned is bold in the lavender ink, both with a dot and a
 * short underline (no boxes: a grid full of them is too loud); a suggestion is italic.
 */
const LOOK: Record<CellState, string> = {
  typed:
    "text-[var(--chip-sky-ink)] font-bold underline decoration-[var(--ring-accent-from)] decoration-2 underline-offset-[5px]",
  planned:
    "text-[var(--chip-lavender-ink)] font-bold underline decoration-[var(--chip-lavender-ink)] decoration-2 underline-offset-[5px]",
  suggestion: "italic",
  fixed: "",
  computed: "text-ink-muted",
  locked: "",
  none: "text-ink-muted",
};

/** Ink for a value: full where the eye should land (first month, a change), muted for a repeat. */
const ink = (state: CellState, quiet: boolean) =>
  state === "typed" || state === "planned" || state === "computed" || state === "none"
    ? ""
    : quiet
      ? "text-ink-muted"
      : "text-ink";

interface Section {
  id: "income" | "fixed" | "variable";
  title: string;
  total: string;
  rows: PlanRow[];
  /** The rows that add up to the footer (the BTW to set aside counts as an expense, with the fixed costs). */
  summed: PlanRow[];
  add: NewKind | null;
}

function sectionsOf(plan: Plan, text: Text, showAll: boolean): Section[] {
  // The BTW follows the client's income, so it sits with the fixed costs, and only when there is any.
  const btw = plan.sections.btw.filter((r) => r.cells.some((c) => c.amount !== 0));
  const variable = variableRows(plan, showAll);
  const out: Section[] = [
    {
      id: "income",
      title: text.sections.income,
      total: text.totals.income,
      rows: plan.sections.income,
      summed: plan.sections.income,
      add: "income",
    },
    {
      id: "fixed",
      title: text.sections.fixed,
      total: text.totals.fixed,
      rows: [...plan.sections.fixed, ...btw],
      summed: [...plan.sections.fixed, ...btw],
      add: "expense",
    },
    {
      id: "variable",
      title: text.sections.variable,
      total: text.totals.variable,
      rows: variable,
      summed: variable,
      add: null,
    },
  ];
  return out.filter((s) => s.rows.length > 0 || s.add !== null);
}

/** The plan: a table on a laptop, one month at a time on a phone. One editor and one add dialog serve both. */
export function PlanScreen({ plan }: { plan: Plan }) {
  const { locale, t } = useI18n();
  const text = t.ui.plan;
  const f = formatter(locale);
  const [showAll, setShowAll] = useState(false);
  const [edit, setEdit] = useState<EditTarget | null>(null);
  const [adding, setAdding] = useState<AddTarget | null>(null);
  const sections = sectionsOf(plan, text, showAll);
  const open: Opener = (rowKey, month, anchor) => setEdit({ rowKey, month, anchor });
  const add = (kind: NewKind, anchor: HTMLElement) => setAdding({ kind, anchor });

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

  const view = { plan, sections, f, open, add, toggle };
  return (
    <>
      <div className="hidden @min-[900px]/app:block">
        <Table {...view} />
      </div>
      <div className="@min-[900px]/app:hidden">
        <Phone {...view} />
      </div>
      <PlanEditor plan={plan} target={edit} onClose={() => setEdit(null)} />
      <PlanAddDialog plan={plan} target={adding} onClose={() => setAdding(null)} />
    </>
  );
}

type Opener = (rowKey: string, month: string, anchor: HTMLElement) => void;

interface ViewProps {
  plan: Plan;
  sections: Section[];
  f: Formatter;
  open: Opener;
  add: (kind: NewKind, anchor: HTMLElement) => void;
  toggle: ReactNode;
}

/** The amount, with its dot (typed, planned), its "=" (follows other numbers) or a dash (nothing). */
function Amount({ state, cell, f }: { state: CellState; cell: PlanCell; f: Formatter }) {
  if (state === "none" || showsDash(cell, state)) return <>–</>;
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
      {f.euro(cell.amount)}
    </>
  );
}

function AddButton({ kind, text, add }: { kind: NewKind; text: Text; add: ViewProps["add"] }) {
  return (
    <button
      type="button"
      onClick={(e) => add(kind, e.currentTarget)}
      className="text-ink-muted hover:text-ink focus-visible:outline-accent inline-flex min-h-10 items-center gap-1.5 rounded-full px-2 text-[13.5px] font-semibold focus-visible:outline-2"
    >
      <Plus className="size-3.5" aria-hidden />
      {kind === "income" ? text.add.income : text.add.cost}
    </button>
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
        <i className={`${swatch} !size-2 bg-[var(--chip-sky-ink)]`} />
        {text.legend.typed}
      </span>
      <span>
        <i className={`${swatch} !size-2 bg-[var(--chip-lavender-ink)]`} />
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

function Table({ plan, sections, f, open, add, toggle }: ViewProps) {
  const { locale, t } = useI18n();
  const text = t.ui.plan;
  const cols = plan.months.length;
  const name = "bg-surface sticky left-0 z-[1] w-56 min-w-56 max-w-56 px-4 text-left";
  const corner = "bg-surface sticky top-0 left-0 z-[3] w-56 min-w-56 max-w-56 px-4 pt-3 pb-2";
  const head = "bg-surface sticky top-0 z-[2] px-2 pt-3 pb-2 text-right align-bottom";

  return (
    <div className="glass bg-surface overflow-hidden">
      {/* Scrolls inside the card, so the month header stays in view and a long plan scrolls sideways. */}
      <div className="max-h-[calc(100dvh-8rem)] overflow-auto overscroll-x-contain">
        <table className="w-full border-separate border-spacing-0 text-[14px] tabular-nums">
          <caption className="sr-only">{text.tableCaption}</caption>
          <thead>
            <tr>
              <th scope="col" className={corner}>
                <span className="sr-only">{text.rowHeader}</span>
              </th>
              {plan.months.map((m, i) => (
                <th
                  key={m}
                  scope="col"
                  className={`${head} text-ink-muted min-w-[5.75rem] text-[13px] font-semibold ${m === plan.currentMonth ? "!text-ink" : ""}`}
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
                  className={`${name} font-display text-ink-muted pt-4 pb-0.5 text-[15px] font-medium`}
                >
                  {s.title}
                </th>
                <td colSpan={cols} />
              </tr>
              {s.rows.map((row) => (
                <tr key={row.key}>
                  <th scope="row" className={`${name} py-0.5 text-[14px] font-semibold`}>
                    <span
                      className="line-clamp-2 break-words"
                      title={rowLabel(row, text.rows, locale)}
                    >
                      {rowLabel(row, text.rows, locale)}
                    </span>
                  </th>
                  {row.cells.map((cell, i) => (
                    <GridCell
                      key={cell.month}
                      row={row}
                      cell={cell}
                      quiet={isQuiet(row, i)}
                      f={f}
                      open={open}
                    />
                  ))}
                </tr>
              ))}
              {s.add && (
                <tr>
                  <th scope="row" className={`${name} py-0`}>
                    <AddButton kind={s.add} text={text} add={add} />
                  </th>
                  <td colSpan={cols} />
                </tr>
              )}
              {s.summed.length > 0 && (
                <tr>
                  <th
                    scope="row"
                    className={`${name} text-ink border-hair border-b py-1.5 text-[14px] font-semibold`}
                  >
                    {s.total}
                  </th>
                  {sectionTotals(s.summed, plan.months).map((v, i) => (
                    <td
                      key={plan.months[i]}
                      className="text-ink border-hair border-b px-3 py-1.5 text-right text-[14px] font-semibold"
                    >
                      {f.euro(v)}
                    </td>
                  ))}
                </tr>
              )}
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
  const edge = strong || first ? "border-t-2 border-ink/25" : "";
  return (
    <tr>
      <th
        scope="row"
        className={`bg-surface sticky left-0 z-[1] ${edge} px-4 py-1.5 text-left font-semibold ${strong ? "text-[15px]" : ""}`}
      >
        {label}
      </th>
      {values.map((v, i) => (
        <td
          key={i}
          className={`${edge} px-4 py-1.5 text-right font-semibold ${strong ? "text-[15px]" : ""} ${tones?.[i] ?? ""}`}
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
  quiet,
  f,
  open,
}: {
  row: PlanRow;
  cell: PlanCell;
  quiet: boolean;
  f: Formatter;
  open: Opener;
}) {
  const { locale, t } = useI18n();
  const text = t.ui.plan;
  const state = cellState(row, cell);
  const label = cellAriaLabel(
    text,
    rowLabel(row, text.rows, locale),
    monthWord(locale, cell.month),
    f.euro(cell.amount),
    state,
  );
  const look = `${LOOK[state]} ${showsDash(cell, state) ? "not-italic text-ink-muted" : ink(state, quiet)}`;
  return (
    <td className="p-0.5 text-right">
      {canEdit(row, cell) ? (
        <button
          type="button"
          aria-label={label}
          onClick={(e) => open(row.key, cell.month, e.currentTarget)}
          className={`hover:bg-soft focus-visible:outline-accent block min-h-9 w-full rounded-xl px-3 py-1 text-right whitespace-nowrap focus-visible:outline-2 ${look}`}
        >
          <Amount state={state} cell={cell} f={f} />
        </button>
      ) : (
        <span className={`block px-3 py-1.5 whitespace-nowrap ${look}`}>
          <span className="sr-only">{label}</span>
          <span aria-hidden>
            <Amount state={state} cell={cell} f={f} />
          </span>
        </span>
      )}
    </td>
  );
}

/* ----------------------------------------------------------------- phone */

function Phone({ plan, sections, f, open, add, toggle }: ViewProps) {
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

  const pill =
    "bg-soft flex flex-col items-center justify-between gap-1.5 rounded-xl px-2 py-2.5 text-center";

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
          <section key={s.id} aria-label={s.title} className="border-hair border-b last:border-b-0">
            <h3 className="font-display text-ink-muted px-4 pt-3 pb-0.5 text-[15px] font-medium">
              {s.title}
            </h3>
            {s.rows.map((row) => {
              const cell = row.cells[index];
              return cell ? (
                <PhoneRow
                  key={row.key}
                  row={row}
                  cell={cell}
                  quiet={isQuiet(row, index)}
                  f={f}
                  open={open}
                />
              ) : null;
            })}
            {s.add && (
              <div className="px-2">
                <AddButton kind={s.add} text={text} add={add} />
              </div>
            )}
            {s.summed.length > 0 && (
              <p className="text-ink flex items-baseline justify-between gap-3 px-4 pb-2 text-[14px] font-semibold">
                <span>{s.total}</span>
                <span className="tabular-nums">{f.euro(sectionTotals(s.summed, [month])[0])}</span>
              </p>
            )}
          </section>
        ))}
        <div className="border-hair border-t px-3 py-1">{toggle}</div>
      </div>

      {foot && (
        <div className="glass grid gap-3 p-4">
          <h3 className="font-display text-[19px] font-medium">{f.monthName(month)}</h3>
          <div className="grid grid-cols-3 gap-2">
            <div className={pill}>
              <span className="text-ink-muted text-[11.5px] leading-tight text-balance">
                {text.footer.income}
              </span>
              <b className="text-[14.5px] tabular-nums">{f.euro(foot.income)}</b>
            </div>
            <div className={pill}>
              <span className="text-ink-muted text-[11.5px] leading-tight text-balance">
                {text.footer.expenses}
              </span>
              <b className="text-[14.5px] tabular-nums">{f.euro(foot.expenses)}</b>
            </div>
            <div className={pill}>
              <span className="text-ink-muted text-[11.5px] leading-tight text-balance">
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
  quiet,
  f,
  open,
}: {
  row: PlanRow;
  cell: PlanCell;
  quiet: boolean;
  f: Formatter;
  open: Opener;
}) {
  const { locale, t } = useI18n();
  const text = t.ui.plan;
  const state = cellState(row, cell);
  const name = rowLabel(row, text.rows, locale);
  const label = cellAriaLabel(
    text,
    name,
    monthWord(locale, cell.month),
    f.euro(cell.amount),
    state,
  );
  const tint =
    state === "typed"
      ? "text-[var(--chip-sky-ink)]"
      : state === "planned"
        ? "text-[var(--chip-lavender-ink)]"
        : "";
  const dash = showsDash(cell, state);
  const amountLook = `${state === "typed" || state === "planned" ? "font-bold" : ""} ${
    state === "suggestion" && !dash ? "italic" : ""
  } ${state === "computed" || state === "none" || dash ? "text-ink-muted" : ink(state, quiet)}`;
  const body = (
    <>
      <span className="line-clamp-2 min-w-0 text-[14.5px] font-medium break-words">{name}</span>
      <span className={`shrink-0 tabular-nums ${amountLook}`}>
        <Amount state={state} cell={cell} f={f} />
      </span>
    </>
  );
  const base = `flex min-h-11 w-full items-center justify-between gap-3 px-4 py-1.5 text-left text-[15px] ${tint}`;
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
