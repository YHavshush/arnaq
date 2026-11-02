// Small pure helpers for the plan grid screens: which state a cell is in, the words for it, the typed amount.
// The components stay thin; everything that can be decided without the DOM is decided here (and tested).
import { INTL_LOCALE, type Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/messages";
import { euroInputToCents } from "@/lib/client/api";
import type { Plan, PlanCell, PlanRow, PlanWhy } from "./plan";

type PlanText = Messages["ui"]["plan"];

/**
 * How a cell looks and what it can do:
 * - typed: a category's own number (blue, with a dot);
 * - planned: a fixed item or income with a number typed over the Fixed page (lavender, with a dot);
 * - suggestion: what the basis suggests (italic grey);
 * - fixed: a fixed item as the Fixed page has it (plain, can still be typed over);
 * - computed: follows other numbers and is never typed (the BTW, "everything else");
 * - locked: a fixed item that already happened this month, nothing to plan any more.
 */
export type CellState = "typed" | "planned" | "suggestion" | "fixed" | "computed" | "locked";

/** The scope "Only this month" is the default; "after" is the second choice. */
export type Scope = "month" | "after";
export const DEFAULT_SCOPE: Scope = "month";

/** Rows the person can type in: a category or a fixed item with an id. */
export const isTypable = (
  row: PlanRow,
): row is PlanRow & { kind: "category" | "item"; id: number } =>
  (row.kind === "category" || row.kind === "item") && row.id !== null;

export function cellState(row: PlanRow, cell: PlanCell): CellState {
  if (cell.source === "computed" || !isTypable(row)) return "computed";
  if (!cell.editable) return "locked";
  if (cell.source === "typed") return row.kind === "item" ? "planned" : "typed";
  return cell.source === "item" ? "fixed" : "suggestion";
}

/** Whether tapping the cell opens the editor. */
export const canEdit = (row: PlanRow, cell: PlanCell) => {
  const s = cellState(row, cell);
  return s !== "computed" && s !== "locked";
};

/** The row's name: the person's own name, or the words for the rows the app makes up. */
export function rowLabel(row: PlanRow, rows: PlanText["rows"]): string {
  if (row.name !== null) return row.name;
  switch (row.key) {
    case "btw":
      return rows.btw;
    case "uncategorised":
      return rows.uncategorised;
    case "income-other":
      return rows.incomeOther;
    default:
      return rows.other;
  }
}

/** "Groceries, December, €312, suggestion": what a screen reader says for a cell. */
export function cellAriaLabel(
  text: PlanText,
  name: string,
  month: string,
  amount: string,
  state: CellState,
): string {
  return text.cell(name, month, amount, text.state[state]);
}

/** Which kinds of cell have a dot (so a typed or planned cell is not told apart by colour alone). */
export const hasDot = (state: CellState) => state === "typed" || state === "planned";

/** A typed fixed item amount equal to the Fixed page's own: the editor says so and offers the reset. */
export const showRedundant = (row: PlanRow, cell: PlanCell) =>
  row.kind === "item" && cell.redundant && cell.typed !== null;

/** The first and last of the months an average was taken over, as short names. */
function averageSpan(months: string[], short: (m: string) => string): [string, string] | null {
  if (months.length === 0) return null;
  return [short(months[0]), short(months[months.length - 1])];
}

/** "November" without the year, for "your November budget". */
export function monthWord(locale: Locale, month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], { month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, 1)),
  );
}

/**
 * Where the suggestion comes from, as one whole sentence from the catalog (one function per kind of `why`).
 * `amount` is the suggestion already formatted; null when the cell has no reason to tell (computed cells).
 */
export function whySentence(
  text: PlanText,
  why: PlanWhy | null,
  amount: string,
  names: { short: (month: string) => string; word: (month: string) => string },
): string | null {
  if (why === null) return null;
  switch (why.type) {
    case "average": {
      const span = averageSpan(why.months, names.short);
      return span === null ? null : text.why.average(amount, span[0], span[1]);
    }
    case "own":
      return text.why.own(amount);
    case "budget":
      return text.why.budget(amount, names.word(why.from));
    case "carried":
      return text.why.carried(amount, names.word(why.from));
    case "fixed":
      return text.why.fixed(amount);
  }
}

/** What the reset button says: back to the suggestion, or (fixed items) back to the Fixed page. */
export function resetLabel(text: PlanText, row: PlanRow, amount: string): string {
  return row.kind === "item" ? text.editor.resetFixed(amount) : text.editor.resetSuggestion(amount);
}

export type AmountInput = { ok: true; cents: number } | { ok: false };

/** What was typed in the editor: euros with a Dutch comma or an English point; zero is allowed, empty is not. */
export function parseAmountInput(raw: string): AmountInput {
  const cents = euroInputToCents(raw.replace(/[\s ]/g, ""));
  return cents === null ? { ok: false } : { ok: true, cents };
}

/** Cents in the box: whole euros without decimals ("312"), otherwise two ("312,50" in Dutch, "312.50" in English). */
export function amountToInput(cents: number, locale: Locale): string {
  if (cents % 100 === 0) return String(cents / 100);
  return (cents / 100).toFixed(2).replace(".", locale === "nl" ? "," : ".");
}

/** What the box starts with: the typed amount when there is one, otherwise what the cell shows now. */
export const editorStart = (cell: PlanCell) => cell.typed ?? cell.amount;

/** The body of PUT /api/plan for a row, month and amount (null clears). */
export function savePayload(row: PlanRow, month: string, amount: number | null, scope: Scope) {
  return { kind: row.kind, id: row.id, month, amount, scope };
}

/** The toast after saving or resetting. */
export function savedMessage(text: PlanText, scope: Scope, reset: boolean): string {
  if (reset) return text.editor.resetDone;
  return scope === "after" ? text.editor.savedAfter : text.editor.saved;
}

const total = (r: PlanRow) => r.cells.reduce((a, c) => a + c.amount, 0);

/** Whether the "everything else" row is hiding categories, so "show all" has something to show. */
export const canShowAll = (plan: Plan) => plan.sections.variable.some((r) => r.key === "other");

/** Everyday spending rows: the default few and "everything else", or every category, biggest first. */
export function variableRows(plan: Plan, showAll: boolean): PlanRow[] {
  if (!showAll) return plan.sections.variable;
  const all = [...plan.allCategories];
  const rank = (r: PlanRow) => (r.key === "uncategorised" ? -Infinity : total(r));
  return all.sort((a, b) => rank(b) - rank(a));
}

/** Whether the plan has anything to show at all. */
export const planHasRows = (plan: Plan) =>
  plan.sections.income.length +
    plan.sections.fixed.length +
    plan.sections.variable.length +
    plan.allCategories.length >
  0;

/** The chosen month if the plan has it, otherwise the current month (or the first). */
export function pickMonth(plan: Plan, wanted: string | null): string {
  if (wanted !== null && plan.months.includes(wanted)) return wanted;
  return plan.months.includes(plan.currentMonth) ? plan.currentMonth : (plan.months[0] ?? "");
}

/** Find the cell of a row (by key) in a month, in the freshest plan. */
export function findCell(
  plan: Plan,
  rowKey: string,
  month: string,
): { row: PlanRow; cell: PlanCell } | null {
  const sections = [
    ...plan.sections.income,
    ...plan.sections.fixed,
    ...plan.sections.btw,
    ...plan.sections.variable,
    ...plan.allCategories,
  ];
  const row = sections.find((r) => r.key === rowKey);
  const cell = row?.cells.find((c) => c.month === month);
  return row && cell ? { row, cell } : null;
}

/** Month chips on a phone: the year is shown with the first chip and with every January. */
export const showYear = (month: string, index: number) => index === 0 || month.endsWith("-01");
