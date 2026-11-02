import { describe, expect, it } from "vitest";
import { messages } from "@/i18n/messages";
import { formatter } from "./format";
import type { Plan, PlanCell, PlanRow } from "./plan";
import {
  DEFAULT_SCOPE,
  addDefaults,
  isNone,
  isQuiet,
  newItemBody,
  sectionTotals,
  untilChoices,
  amountToInput,
  canEdit,
  canShowAll,
  cellAriaLabel,
  cellState,
  editorStart,
  findCell,
  monthWord,
  parseAmountInput,
  pickMonth,
  planHasRows,
  resetLabel,
  rowLabel,
  savePayload,
  savedMessage,
  showRedundant,
  showYear,
  variableRows,
  whySentence,
} from "./plan-grid";

const cell = (over: Partial<PlanCell> = {}): PlanCell => ({
  month: "2026-12",
  amount: 31200,
  source: "suggestion",
  suggestion: 31200,
  why: { type: "average", months: ["2026-08", "2026-09", "2026-10"] },
  redundant: false,
  editable: true,
  typed: null,
  ...over,
});
const row = (over: Partial<PlanRow> = {}): PlanRow => ({
  key: "category-1",
  name: "Groceries",
  kind: "category",
  id: 1,
  cells: [cell()],
  ...over,
});

const en = messages.en.ui.plan;
const nl = messages.nl.ui.plan;
const names = (locale: "en" | "nl") => {
  const f = formatter(locale);
  return { short: f.monthShort, word: (m: string) => monthWord(locale, m) };
};

describe("cellState", () => {
  it("tells the five kinds of cell apart", () => {
    expect(cellState(row(), cell())).toBe("suggestion");
    expect(cellState(row(), cell({ source: "typed", typed: 25000 }))).toBe("typed");
    const item = row({ key: "item-4", kind: "item", id: 4 });
    expect(cellState(item, cell({ source: "item" }))).toBe("fixed");
    expect(cellState(item, cell({ source: "typed", typed: 52000 }))).toBe("planned");
    expect(cellState(item, cell({ source: "item", editable: false }))).toBe("locked");
    const btw = row({ key: "btw", name: null, kind: "btw", id: null });
    expect(cellState(btw, cell({ source: "computed", editable: false }))).toBe("computed");
    // a row the app makes up is never typed, whatever the cell says
    expect(cellState(row({ kind: "other", id: null }), cell())).toBe("computed");
  });

  it("only suggestions, typed, planned and fixed cells open the editor", () => {
    expect(canEdit(row(), cell())).toBe(true);
    expect(canEdit(row(), cell({ source: "computed", editable: false }))).toBe(false);
    expect(canEdit(row({ kind: "item", id: 2 }), cell({ source: "item", editable: false }))).toBe(
      false,
    );
  });

  it("defaults to the scope 'only this month'", () => {
    expect(DEFAULT_SCOPE).toBe("month");
  });
});

describe("words", () => {
  it("names a cell like 'Groceries, December, €312, suggestion'", () => {
    const f = formatter("en");
    const name = cellAriaLabel(en, "Groceries", "December", f.euro(31200), "suggestion");
    expect(name).toBe("Groceries, December, €312, suggestion");
    expect(cellAriaLabel(nl, "Boodschappen", "december", "€ 312", "planned")).toBe(
      "Boodschappen, december, € 312, geplande wijziging",
    );
  });

  it("labels the rows the app makes up", () => {
    expect(rowLabel(row(), en.rows, "en")).toBe("Groceries");
    expect(rowLabel(row({ key: "btw", name: null, kind: "btw", id: null }), en.rows, "en")).toBe(
      "BTW set aside",
    );
    expect(
      rowLabel(row({ key: "other", name: null, kind: "other", id: null }), nl.rows, "nl"),
    ).toBe("Alles overig");
    expect(rowLabel(row({ key: "uncategorised", name: null, kind: "other" }), en.rows, "en")).toBe(
      "Uncategorised",
    );
    expect(rowLabel(row({ key: "income-other", name: null, kind: "other" }), nl.rows, "nl")).toBe(
      "Overig inkomen",
    );
  });

  it("gives one whole sentence per kind of reason, in both languages", () => {
    const n = names("en");
    const avg = { type: "average" as const, months: ["2026-08", "2026-09", "2026-10"] };
    expect(whySentence(en, avg, "€96", n)).toBe("Suggestion €96: your average over Aug to Oct.");
    expect(whySentence(en, { type: "average", months: ["2026-10"] }, "€96", n)).toBe(
      "Suggestion €96: your average over Oct.",
    );
    expect(whySentence(en, { type: "budget", from: "2026-11" }, "€300", n)).toBe(
      "Suggestion €300: your November budget.",
    );
    expect(whySentence(en, { type: "carried", from: "2026-10" }, "€300", n)).toBe(
      "Suggestion €300: carried over from your October budget.",
    );
    expect(whySentence(en, { type: "fixed" }, "€481", n)).toBe(
      "Suggestion €481: from the Fixed page.",
    );
    expect(whySentence(en, { type: "own" }, "€1,500", n)).toContain("€1,500");
    const d = names("nl");
    expect(whySentence(nl, avg, "€ 96", d)).toBe("Suggestie € 96: je gemiddelde over aug tot okt.");
    expect(whySentence(nl, { type: "budget", from: "2026-11" }, "€ 300", d)).toBe(
      "Suggestie € 300: je budget voor november.",
    );
  });

  it("has no sentence when there is no reason to tell", () => {
    expect(whySentence(en, null, "€1", names("en"))).toBeNull();
    expect(whySentence(en, { type: "average", months: [] }, "€1", names("en"))).toBeNull();
  });

  it("resets a fixed item to the Fixed page and a category to the suggestion", () => {
    expect(resetLabel(en, row(), "€96")).toBe("Reset to suggestion €96");
    expect(resetLabel(en, row({ kind: "item", id: 3 }), "€481")).toBe(
      "Reset to the Fixed page, €481",
    );
  });

  it("toasts say what happened", () => {
    expect(savedMessage(en, "month", false)).toBe("Saved");
    expect(savedMessage(en, "after", false)).toBe("Saved, and the months after");
    expect(savedMessage(en, "after", true)).toBe("Back to the suggestion");
  });
});

describe("the typed amount", () => {
  it.each([
    ["250", 25000],
    ["250,50", 25050],
    ["250.5", 25050],
    ["€ 12,5", 1250],
    [" 0 ", 0],
    ["1 250", 125000],
  ])("reads %s as %i cents", (raw, cents) => {
    expect(parseAmountInput(raw)).toEqual({ ok: true, cents });
  });

  it.each(["", "  ", "abc", "-5", "12,345", "1.250,50", "12,"])("refuses %j", (raw) => {
    expect(parseAmountInput(raw)).toEqual({ ok: false });
  });

  it("writes cents back in the box with the language's decimal sign", () => {
    expect(amountToInput(31200, "en")).toBe("312");
    expect(amountToInput(31250, "en")).toBe("312.50");
    expect(amountToInput(31250, "nl")).toBe("312,50");
    expect(amountToInput(5, "nl")).toBe("0,05");
  });

  it("starts the box with what was typed, or else what the cell shows", () => {
    expect(editorStart(cell({ typed: 25000 }))).toBe(25000);
    expect(editorStart(cell())).toBe(31200);
  });

  it("builds the PUT body", () => {
    expect(savePayload(row(), "2026-12", 25000, "after")).toEqual({
      kind: "category",
      id: 1,
      month: "2026-12",
      amount: 25000,
      scope: "after",
    });
    expect(savePayload(row({ kind: "item", id: 9 }), "2026-12", null, "month").amount).toBeNull();
  });
});

describe("redundant", () => {
  it("only a typed fixed item equal to the Fixed page counts", () => {
    const item = row({ kind: "item", id: 2 });
    expect(showRedundant(item, cell({ redundant: true, typed: 48100, source: "typed" }))).toBe(
      true,
    );
    expect(showRedundant(item, cell({ redundant: false, typed: 48100 }))).toBe(false);
    expect(showRedundant(row(), cell({ redundant: true, typed: 1 }))).toBe(false);
  });
});

function plan(): Plan {
  const other = row({ key: "other", name: null, kind: "other", id: null });
  const a = row({ key: "category-1", name: "A", cells: [cell({ amount: 100 })] });
  const b = row({ key: "category-2", name: "B", id: 2, cells: [cell({ amount: 900 })] });
  const u = row({
    key: "uncategorised",
    name: null,
    kind: "other",
    cells: [cell({ amount: 5000 })],
  });
  return {
    currentMonth: "2026-11",
    months: ["2026-11", "2026-12"],
    basis: "budget",
    horizon: 24,
    sections: { income: [], fixed: [], btw: [], variable: [a, other] },
    allCategories: [a, b, u],
    footer: [],
  };
}

describe("the grid rows", () => {
  it("shows the default rows, or every category (biggest first, uncategorised last)", () => {
    const p = plan();
    expect(variableRows(p, false).map((r) => r.key)).toEqual(["category-1", "other"]);
    expect(variableRows(p, true).map((r) => r.key)).toEqual([
      "category-2",
      "category-1",
      "uncategorised",
    ]);
  });

  it("offers 'show all' only when 'everything else' hides something", () => {
    const p = plan();
    expect(canShowAll(p)).toBe(true);
    p.sections.variable = p.sections.variable.filter((r) => r.key !== "other");
    expect(canShowAll(p)).toBe(false);
  });

  it("knows an empty plan", () => {
    const p = plan();
    expect(planHasRows(p)).toBe(true);
    expect(
      planHasRows({
        ...p,
        sections: { income: [], fixed: [], btw: [], variable: [] },
        allCategories: [],
      }),
    ).toBe(false);
  });

  it("finds a cell by row and month, also among all categories", () => {
    const p = plan();
    expect(findCell(p, "category-2", "2026-12")?.row.name).toBe("B");
    expect(findCell(p, "nope", "2026-12")).toBeNull();
    expect(findCell(p, "category-1", "2030-01")).toBeNull();
  });

  it("falls back to the current month when the wanted month is not in the plan", () => {
    const p = plan();
    expect(pickMonth(p, "2026-12")).toBe("2026-12");
    expect(pickMonth(p, "2027-05")).toBe("2026-11");
    expect(pickMonth(p, null)).toBe("2026-11");
  });

  it("shows the year on the first chip and every January", () => {
    expect(showYear("2026-11", 0)).toBe(true);
    expect(showYear("2026-12", 1)).toBe(false);
    expect(showYear("2027-01", 2)).toBe(true);
  });
});

describe("tidy names", () => {
  it("writes a fixed item's name the way a person would, and a category in the reader's language", () => {
    const item = (name: string) => row({ key: "item-1", name, kind: "item", id: 1 });
    expect(rowLabel(item("FBTO ZORGVERZEKERINGEN NV"), en.rows, "en")).toBe(
      "FBTO Zorgverzekeringen",
    );
    expect(rowLabel(item("NETFLIX INTERNATIONAL B.V."), en.rows, "nl")).toBe(
      "Netflix International",
    );
    expect(rowLabel(item("featurn B.V."), en.rows, "en")).toBe("featurn");
    expect(rowLabel(row({ name: "Boodschappen" }), en.rows, "en")).toBe("Groceries");
    expect(rowLabel(row({ name: "Boodschappen" }), nl.rows, "nl")).toBe("Boodschappen");
  });
});

describe("quiet repetition", () => {
  const amounts = (...xs: (number | [number, number])[]) =>
    row({
      cells: xs.map((x, i) =>
        Array.isArray(x)
          ? cell({ month: `m${i}`, amount: x[0], typed: x[1], source: "typed" })
          : cell({ month: `m${i}`, amount: x }),
      ),
    });

  it("the first month and every change are in full ink, a repeat is quiet", () => {
    const r = amounts(100, 100, 100, 150, 150, 100);
    expect(r.cells.map((_, i) => isQuiet(r, i))).toEqual([false, true, true, false, true, false]);
  });

  it("a typed cell is never quiet, and neither is the cell right after it", () => {
    const r = amounts(100, [100, 100], 100);
    expect(r.cells.map((_, i) => isQuiet(r, i))).toEqual([false, false, false]);
  });

  it("knows a cell with nothing in it", () => {
    expect(isNone(cell({ amount: 0 }))).toBe(true);
    expect(isNone(cell({ amount: 0, typed: 0 }))).toBe(false);
    expect(isNone(cell())).toBe(false);
  });
});

describe("section totals", () => {
  it("adds the rows month by month, counting a month a row has no cell for as nothing", () => {
    const a = row({
      cells: [cell({ month: "2026-11", amount: 100 }), cell({ month: "2026-12", amount: 5 })],
    });
    const b = row({ cells: [cell({ month: "2026-11", amount: 20 })] });
    expect(sectionTotals([a, b], ["2026-11", "2026-12"])).toEqual([120, 5]);
    expect(sectionTotals([], ["2026-11"])).toEqual([0]);
  });
});

describe("adding a row", () => {
  it("starts on the 25th for income and the 1st for a cost, from the month after this one", () => {
    const p = plan();
    expect(addDefaults(p, "income")).toEqual({ day: 25, from: "2026-12" });
    expect(addDefaults(p, "expense")).toEqual({ day: 1, from: "2026-12" });
    expect(addDefaults({ ...p, months: ["2026-11"] }, "expense").from).toBe("2026-11");
  });

  it("offers 'until' from the start month on", () => {
    const p = { ...plan(), months: ["2026-11", "2026-12", "2027-01"] };
    expect(untilChoices(p, "2026-12")).toEqual(["2026-12", "2027-01"]);
  });

  const base = {
    kind: "income" as const,
    name: " featurn ",
    amount: "1.100",
    day: "25",
    from: "2027-03",
    until: null,
  };

  it("builds the body of POST /api/recurring: first day of the month, last day of the until month", () => {
    const r = newItemBody({ ...base, amount: "1100,50", until: "2027-04" });
    expect(r).toEqual({
      ok: true,
      body: {
        name: "featurn",
        type: "income",
        expectedAmount: 110050,
        dayOfMonth: 25,
        frequency: "monthly",
        matchCounterparty: "featurn",
        categoryId: null,
        startDate: "2027-03-01",
        endDate: "2027-04-30",
        tolerance: 11005,
      },
    });
    const open = newItemBody({ ...base, amount: "1100", kind: "expense" });
    expect(open).toMatchObject({ ok: true, body: { type: "expense", endDate: null } });
    expect(newItemBody({ ...base, amount: "1100", until: "2028-02" })).toMatchObject({
      body: { endDate: "2028-02-29" },
    });
  });

  it("refuses an empty name, an amount that is not above zero and a day outside 1 to 31", () => {
    expect(newItemBody({ ...base, name: "  ", amount: "5" })).toEqual({ ok: false, error: "name" });
    expect(newItemBody({ ...base, amount: "0" })).toEqual({ ok: false, error: "amount" });
    expect(newItemBody({ ...base, amount: "abc" })).toEqual({ ok: false, error: "amount" });
    expect(newItemBody({ ...base, amount: "5", day: "32" })).toEqual({ ok: false, error: "day" });
    expect(newItemBody({ ...base, amount: "5", day: "1.5" })).toEqual({ ok: false, error: "day" });
  });
});
