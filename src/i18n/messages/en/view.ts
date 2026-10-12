import type { Sentence } from "../../types";

const plain = (text: string) => ({ text });
const em = (text: string) => ({ text, em: true });

/** Sentences, words and labels built by the screen view models (src/lib/view). Amounts arrive formatted. */
export const view = {
  overzicht: {
    uncategorised: "Uncategorised",
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
      sorteren: {
        label: "To sort",
        word: (n: number) => `${n} open`,
        wordNone: "All sorted",
        sub: "transactions without a category",
        subNone: "No loose transactions this month",
      },
    },
  },
  prognose: {
    nothing: "There is nothing to forecast yet. Upload a statement first.",
    noHistory: "No uploaded month before this one, so everyday spending is forecast as 0.",
    shortHistory: (n: number, wanted: number) =>
      `Only ${n} of the ${wanted} months of history are uploaded.`,
    single: (month: string, net: string): Sentence => [
      plain(`${month} ends at `),
      em(net),
      plain("."),
    ],
    range: (tight: string, tightNet: string, best: string, bestNet: string): Sentence => [
      plain("The tightest month is "),
      em(tight),
      plain(` (${tightNet}), the best `),
      em(best),
      plain(` (${bestNet}).`),
    ],
  },
  vasteLasten: {
    label: {
      paid: (date: string) => `paid ${date}`,
      missed: (date: string) => `missed, expected ${date}`,
      coming: (date: string) => `due ${date}`,
    },
    none: "No fixed costs yet. Add them or accept a suggestion.",
    allPaid: (): Sentence => [plain("All fixed costs this month are "), em("paid"), plain(".")],
    next: (toCome: string, name: string, date: string): Sentence => [
      plain("Still "),
      em(toCome),
      plain(` to go; next up is ${name} on ${date}.`),
    ],
  },
};
