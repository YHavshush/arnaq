import type { Sentence } from "../../types";

const plain = (text: string) => ({ text });
const em = (text: string) => ({ text, em: true });
/** A month name that starts a sentence: Dutch month names are lower case. */
const cap = (text: string) => {
  const s = String(text);
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** Sentences, words and labels built by the screen view models (src/lib/view). Amounts arrive formatted. */
export const view = {
  overzicht: {
    uncategorised: "Uncategorised",
    daysText: (n: number) => `${n} ${n === 1 ? "day" : "days"}`,
    headerOk: [
      (d: string): Sentence => [plain("Plenty of room, "), em(d), plain(" to go")],
      (d: string): Sentence => [
        plain("All calm: "),
        em(d),
        plain(" left, and you're in good shape"),
      ],
      (d: string): Sentence => [em(d), plain(" to go, and it looks fine")],
    ],
    headerTight: [
      (d: string): Sentence => [plain("Getting close, "), em(d), plain(" to go")],
      (d: string): Sentence => [plain("Keep an eye on it: "), em(d), plain(" left")],
    ],
    headerOver: [
      (d: string): Sentence => [
        plain("Over the line, with "),
        em(d),
        plain(" left to keep it from growing"),
      ],
      (d: string): Sentence => [em(d), plain(" to go: spend as little as you can now")],
      (d: string): Sentence => [plain("A heavy month so far, "), em(d), plain(" to go")],
    ],
    headerLastDay: [em("Last day"), plain(" of the month")] as Sentence,
    headerDone: (month: string): Sentence => [em(cap(month)), plain(" is done")],
    headerNotStarted: [plain("This month hasn't started yet")] as Sentence,
    headerTotals: (spent: string, income: string) => `${spent} spent · ${income} came in`,
    headerTotalsPlanned: (spent: string, planned: string, budget: string, income: string) =>
      `${spent} spent + ${planned} fixed still to pay, of your ${budget} budget · ${income} came in`,
    headerTotalsBudget: (spent: string, budget: string, income: string) =>
      `${spent} of your ${budget} budget spent · ${income} came in`,
    facts: {
      over: (name: string, amount: string) => `Over budget on ${name} (+${amount}).`,
      under: (name: string, amount: string) => `Under budget on ${name}, ${amount} left.`,
      income: (name: string, amount: string, date: string) =>
        `Still expecting ${name}: ${amount} on ${date}.`,
      fixed: (n: number, amount: string) =>
        `${n} fixed ${n === 1 ? "cost" : "costs"} still to pay (${amount}).`,
      unbudgeted: (amount: string) => `${amount} more went to categories without a budget.`,
    },
    ofIncome: (spent: string, income: string): Sentence => [
      plain("You've spent "),
      em(spent),
      plain(` of the ${income} that came in this month.`),
    ],
    noBudget: (spent: string): Sentence => [
      plain("You've spent "),
      em(spent),
      plain(" this month. Set a budget to see what's free."),
    ],
    notStarted: (fixed: string): Sentence => [
      plain("This month hasn't started yet. Your fixed costs are "),
      em(fixed),
      plain("."),
    ],
    pastUnder: (diff: string): Sentence => [
      plain("You stayed "),
      em(diff),
      plain(" under your budget."),
    ],
    pastOver: (diff: string): Sentence => [
      plain("You went "),
      em(diff),
      plain(" over your budget."),
    ],
    fixedTakeAll: (fixed: string): Sentence => [
      plain("Your fixed costs ("),
      em(fixed),
      plain(") take up your whole budget."),
    ],
    justStarted: (variable: string): Sentence => [
      plain("The month has just begun: "),
      em(variable),
      plain(" for everyday spending."),
    ],
    paceUnder: (spent: string, budget: string): Sentence => [
      plain("Your everyday spending is comfortably under pace: "),
      em(spent),
      plain(` of ${budget}.`),
    ],
    paceOn: (spent: string, budget: string): Sentence => [
      plain("Your everyday spending is right on pace: "),
      em(spent),
      plain(` of ${budget}.`),
    ],
    paceOver: (spent: string, budget: string): Sentence => [
      plain("Your everyday spending is running faster than your budget: "),
      em(spent),
      plain(` of ${budget}.`),
    ],
    tone: { good: "On track", warn: "Tight", bad: "Over budget", accent: "No budget" },
    tiles: {
      budget: {
        label: "Budget",
        sub: (used: string, budget: string) => `${used} of ${budget}`,
        subNone: "Not set",
      },
      vast: {
        label: "Fixed costs",
        word: (paid: number, total: number) => `${paid}/${total} paid`,
        none: "None",
        subToGo: (amount: string) => `${amount} still to come`,
        subAllPaid: "All paid",
        subNone: "Nothing set up yet",
      },
      inkomen: {
        label: "Income",
        word: (amount: string) => `${amount} in`,
        subExpected: (amount: string) => `${amount} still expected`,
        subNone: "Nothing more expected",
      },
      sparen: {
        label: "Savings",
        wordReached: "Reached",
        wordUnderway: "Under way",
        wordSaved: "Saved",
        wordNone: "Nothing yet",
        wordTaken: "Withdrawn",
        subTotalOnly: "saved in total",
        subTotal: (amount: string) => `${amount} saved in total`,
        subMonthTaken: (amount: string) => `${amount} taken out this month`,
        subOf: (amount: string, goal: string) => `${amount} of ${goal}`,
        subMonth: (amount: string) => `${amount} this month`,
        subNone: "Nothing set aside this month",
      },
    },
    attention: {
      uncategorised: (n: number) =>
        n === 1 ? "1 transaction without a category" : `${n} transactions without a category`,
      uncategorisedSub: "Sort them and arnaq remembers your choice",
      incomeMissing: (name: string) => `${name} is not in yet`,
      expenseMissing: (name: string) => `${name} has not been paid yet`,
      expectedOn: (date: string) => `Expected on ${date}, not counted`,
      foreign: (n: number) =>
        n === 1
          ? "1 row in another currency is not counted"
          : `${n} rows in another currency are not counted`,
      foreignSub: "Look at them in the list",
      sort: "Sort",
      view: "View",
    },
    detail: {
      withPerDay: (pct: number, days: number, perDay: string) =>
        `${pct}% of your budget is spent or already planned, with ${days} ${days === 1 ? "day" : "days"} to go (${perDay} per day free).`,
      withoutPerDay: (pct: number, days: number) =>
        `${pct}% of your budget is spent or already planned, with ${days} ${days === 1 ? "day" : "days"} to go.`,
      overOne: (a: string) => `${a} is over budget.`,
      overTwo: (a: string, b: string) => `${a} and ${b} are over budget.`,
      overMany: (a: string, b: string, more: number) =>
        `${a}, ${b} and ${more} more are over budget.`,
    },
  },
  prognose: {
    noIncome: [
      plain(
        "No income is planned yet, so this shows spending only. Add your salary or benefits under ",
      ),
      em("Fixed costs"),
      plain(" for a real forecast."),
    ] as Sentence,
    nothing: "There is nothing to forecast yet. Upload a statement first.",
    noHistory: "No uploaded month before this one, so everyday spending is forecast as 0.",
    shortHistory: (n: number, wanted: number) =>
      `Only ${n} of the ${wanted} months of history are uploaded.`,
    single: (month: string, net: string): Sentence => [
      plain(`${cap(month)} ends at `),
      em(net),
      plain("."),
    ],
    tightBest: (tight: string, best: string): Sentence => [
      em(cap(tight)),
      plain(" gets tight, "),
      plain(`${best} is your best month.`),
    ],
    bestTightest: (best: string, tight: string): Sentence => [
      em(cap(best)),
      plain(` is your best month, ${tight} the tightest.`),
    ],
    detailWorth: (start: string, end: string, month: string, plus: number, total: number) =>
      `Net worth goes from ${start} to about ${end} by ${month}. ${plus} of ${total} months end in the plus.`,
    detailUp: (amount: string, month: string, plus: number, total: number) =>
      `In total your money grows by ${amount} through ${month}. ${plus} of ${total} months end in the plus.`,
    detailDown: (amount: string, month: string, plus: number, total: number) =>
      `In total your money shrinks by ${amount} through ${month}. ${plus} of ${total} months end in the plus.`,
    noteBalance:
      "Net worth adds up the accounts you uploaded and your savings; money you have not uploaded is not in it. Money set aside for the BTW is not counted: it is owed.",
    noteEstimate:
      "Forecast months are an estimate: fixed costs and income as you set them up, plus your average everyday spending.",
    noteMissed: (name: string, date: string) =>
      `${name} (expected ${date}) has not been seen and is not counted.`,
    noteSetAside: (amount: string, month: string) =>
      `Your fixed savings deposits put ${amount} aside through ${month}. That lowers the balance but is not counted as spending.`,
    /** What is inside a month's Income and Expenses tiles (see src/lib/view/month-parts.ts). */
    parts: {
      expected: "expected",
      received: "received",
      paid: "paid",
      partlyPaid: (paid: string, total: string) => `${paid} of ${total} paid`,
      otherIncome: "Other income",
      fixedCosts: "Fixed costs",
      everyday: "Everyday spending",
      items: (n: number) => `${n} ${n === 1 ? "item" : "items"}`,
      more: (n: number) => `${n} more`,
      basisAverages: "your averages",
      basisActual: "actual",
      basisMixed: "so far plus averages",
      setAsideNote: (amount: string) =>
        `Not counted above: ${amount} was set aside for savings and the BTW.`,
    },
  },
  vasteLasten: {
    label: {
      paid: (date: string) => `paid ${date}`,
      missed: (date: string) => `missed, expected ${date}`,
      coming: (date: string) => `due ${date}`,
    },
    none: "No fixed items yet. Add them or accept a suggestion.",
    allPaid: (): Sentence => [plain("All fixed costs this month are "), em("paid"), plain(".")],
    next: (toCome: string, name: string, date: string): Sentence => [
      plain("Still "),
      em(toCome),
      plain(` to go; next up is ${name} on ${date}.`),
    ],
  },
};
