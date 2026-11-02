// Small pure helpers for the plan grid screens: which state a cell is in, the words for it, the typed amount.
// The components stay thin; everything that can be decided without the DOM is decided here (and tested).
import { INTL_LOCALE, type Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/messages";
import { euroInputToCents } from "@/lib/client/api";
import { daysInMonth } from "@/lib/recurring/dates";
import { categoryLabel } from "./categories";
import { displayName } from "./names";
import type { Plan, PlanCell, PlanRow, PlanWhy } from "./plan";

type PlanText = Messages["ui"]["plan"];

/**
 * How a cell looks and what it can do:
 * - typed: a category's own number (blue, with a dot);
 * - planned: a fixed item or income with a number typed over the Fixed page (lavender, with a dot);
 * - suggestion: what the basis suggests (italic grey);
 * - fixed: a fixed item as the Fixed page has it (plain, can still be typed over);
 * - computed: follows other numbers and is never typed (the BTW, "everything else");
 * - locked: a fixed item that already happened this month, nothing to plan any more;
 * - none: a fixed item that is not scheduled in this month (before it starts, after it ends): nothing.
 */
export type CellState =
  "typed" | "planned" | "suggestion" | "fixed" | "computed" | "locked" | "none";

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
  if (!cell.editable) return cell.amount === 0 && cell.typed === null ? "none" : "locked";
  if (cell.source === "typed") return row.kind === "item" ? "planned" : "typed";
  return cell.source === "item" ? "fixed" : "suggestion";
}

/** Whether tapping the cell opens the editor. */
export const canEdit = (row: PlanRow, cell: PlanCell) => {
  const s = cellState(row, cell);
  return s !== "computed" && s !== "locked" && s !== "none";
};

/**
 * The row's name as a person would write it: a fixed item's name without the bank's capitals and legal form, a
 * category in the reader's language, or the words for the rows the app makes up.
 */
export function rowLabel(row: PlanRow, rows: PlanText["rows"], locale: Locale): string {
  if (row.name !== null)
    return row.kind === "category" ? categoryLabel(row.name, locale) : displayName(row.name);
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

/**
 * A value that is the same as the month before and was not typed is quiet (muted), so the eye lands on the first month
 * and on every place where something changes. Typed and planned cells are never quiet.
 */
export function isQuiet(row: PlanRow, index: number): boolean {
  if (index === 0) return false;
  const cell = row.cells[index];
  const before = row.cells[index - 1];
  if (!cell || !before) return false;
  return cell.typed === null && before.typed === null && cell.amount === before.amount;
}

/** Nothing to show for the cell (it is shown as a dash). */
export const isNone = (cell: PlanCell) => cell.amount === 0 && cell.typed === null;

/** One total per month for the rows of a section (what the footer adds up). */
export function sectionTotals(rows: PlanRow[], months: string[]): number[] {
  return months.map((m) =>
    rows.reduce((sum, r) => sum + (r.cells.find((c) => c.month === m)?.amount ?? 0), 0),
  );
}

export type NewKind = "income" | "expense";

/** What the "add" dialog starts with: the 25th for income, the 1st for a cost, from the month after this one. */
export function addDefaults(plan: Plan, kind: NewKind): { day: number; from: string } {
  const from =
    plan.months.find((m) => m > plan.currentMonth) ?? plan.months[0] ?? plan.currentMonth;
  return { day: kind === "income" ? 25 : 1, from };
}

/** The months an "until" can be: the chosen start and the months after it, in the grid. */
export const untilChoices = (plan: Plan, from: string) => plan.months.filter((m) => m >= from);

export type NewItemResult =
  { ok: true; body: Record<string, unknown> } | { ok: false; error: "name" | "amount" | "day" };

/**
 * The body for POST /api/recurring (the Fixed page's own endpoint) from the "add" dialog. A new row starts on the first
 * day of its first month and, when asked, ends on the last day of its last month. The name is also what a payment is
 * matched on, as the Fixed page does when no other name is given.
 */
export function newItemBody(input: {
  kind: NewKind;
  name: string;
  amount: string;
  day: string;
  from: string;
  until: string | null;
}): NewItemResult {
  const name = input.name.trim();
  if (!name) return { ok: false, error: "name" };
  const parsed = parseAmountInput(input.amount);
  if (!parsed.ok || parsed.cents === 0) return { ok: false, error: "amount" };
  const day = Number(input.day);
  if (!Number.isInteger(day) || day < 1 || day > 31) return { ok: false, error: "day" };
  return {
    ok: true,
    body: {
      name,
      type: input.kind,
      expectedAmount: parsed.cents,
      dayOfMonth: day,
      frequency: "monthly",
      matchCounterparty: name,
      categoryId: null,
      startDate: `${input.from}-01`,
      endDate: input.until
        ? `${input.until}-${String(daysInMonth(input.until)).padStart(2, "0")}`
        : null,
      tolerance: Math.round(parsed.cents * 0.1),
    },
  };
}
