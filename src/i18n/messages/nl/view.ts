import type { Sentence } from "../../types";
import type { view as en } from "../en/view";

const plain = (text: string) => ({ text });
const em = (text: string) => ({ text, em: true });
/** A month name that starts a sentence: Dutch month names are lower case. */
const cap = (text: string) => {
  const s = String(text);
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export const view: typeof en = {
  overzicht: {
    uncategorised: "Zonder categorie",
    daysText: (n: number) => `${n} ${n === 1 ? "dag" : "dagen"}`,
    headerOk: [
      (d: string): Sentence => [plain("Ruim genoeg, nog "), em(d), plain(" te gaan")],
      (d: string): Sentence => [plain("Rustig: nog "), em(d), plain(", en het ziet er goed uit")],
      (d: string): Sentence => [em(d), plain(" te gaan, en het ziet er prima uit")],
    ],
    headerTight: [
      (d: string): Sentence => [plain("Het wordt krap, nog "), em(d), plain(" te gaan")],
      (d: string): Sentence => [plain("Houd het in de gaten: nog "), em(d)],
    ],
    headerOver: [
      (d: string): Sentence => [
        plain("Over de streep, nog "),
        em(d),
        plain(" om het niet erger te maken"),
      ],
      (d: string): Sentence => [em(d), plain(" te gaan: geef nu zo weinig mogelijk uit")],
      (d: string): Sentence => [
        plain("Een zware maand tot nu toe, nog "),
        em(d),
        plain(" te gaan"),
      ],
    ],
    headerLastDay: [em("Laatste dag"), plain(" van de maand")] as Sentence,
    headerDone: (month: string): Sentence => [em(cap(month)), plain(" is klaar")],
    headerNotStarted: [plain("Deze maand is nog niet begonnen")] as Sentence,
    headerTotals: (spent: string, income: string) =>
      `${spent} uitgegeven · ${income} binnengekomen`,
    headerTotalsBudget: (spent: string, budget: string, income: string) =>
      `${spent} van je budget van ${budget} uitgegeven · ${income} binnengekomen`,
    facts: {
      over: (name: string, amount: string) => `Over budget bij ${name} (+${amount}).`,
      under: (name: string, amount: string) => `Onder budget bij ${name}, nog ${amount} over.`,
      income: (name: string, amount: string, date: string) =>
        `Nog te verwachten: ${name}, ${amount} op ${date}.`,
      fixed: (n: number, amount: string) =>
        `Nog ${n} ${n === 1 ? "vaste last" : "vaste lasten"} te betalen (${amount}).`,
      unbudgeted: (amount: string) => `Nog ${amount} ging naar categorieën zonder budget.`,
    },
    ofIncome: (spent: string, income: string): Sentence => [
      plain("Je hebt "),
      em(spent),
      plain(` uitgegeven van de ${income} die deze maand binnenkwam.`),
    ],
    noBudget: (spent: string): Sentence => [
      plain("Je hebt deze maand "),
      em(spent),
      plain(" uitgegeven. Stel een budget in om te zien wat er vrij is."),
    ],
    notStarted: (fixed: string): Sentence => [
      plain("Deze maand is nog niet begonnen. Je vaste lasten zijn "),
      em(fixed),
      plain("."),
    ],
    pastUnder: (diff: string): Sentence => [
      plain("Je bleef "),
      em(diff),
      plain(" onder je budget."),
    ],
    pastOver: (diff: string): Sentence => [plain("Je ging "), em(diff), plain(" over je budget.")],
    fixedTakeAll: (fixed: string): Sentence => [
      plain("Je vaste lasten ("),
      em(fixed),
      plain(") nemen je hele budget in beslag."),
    ],
    justStarted: (variable: string): Sentence => [
      plain("De maand is net begonnen: "),
      em(variable),
      plain(" voor gewone uitgaven."),
    ],
    paceUnder: (spent: string, budget: string): Sentence => [
      plain("Je gewone uitgaven blijven ruim binnen schema: "),
      em(spent),
      plain(` van ${budget}.`),
    ],
    paceOn: (spent: string, budget: string): Sentence => [
      plain("Je gewone uitgaven lopen precies op schema: "),
      em(spent),
      plain(` van ${budget}.`),
    ],
    paceOver: (spent: string, budget: string): Sentence => [
      plain("Je gewone uitgaven lopen sneller dan je budget: "),
      em(spent),
      plain(` van ${budget}.`),
    ],
    tone: { good: "Op schema", warn: "Krap", bad: "Over budget", accent: "Geen budget" },
    tiles: {
      budget: {
        label: "Budget",
        sub: (used: string, budget: string) => `${used} van ${budget}`,
        subNone: "Nog niet ingesteld",
      },
      vast: {
        label: "Vaste lasten",
        word: (paid: number, total: number) => `${paid}/${total} betaald`,
        none: "Geen",
        subToGo: (amount: string) => `nog ${amount} te gaan`,
        subAllPaid: "Alles betaald",
        subNone: "Nog niets ingesteld",
      },
      inkomen: {
        label: "Inkomen",
        word: (amount: string) => `${amount} binnen`,
        subExpected: (amount: string) => `nog ${amount} verwacht`,
        subNone: "Niets meer verwacht",
      },
      sparen: {
        label: "Sparen",
        wordReached: "Gehaald",
        wordUnderway: "Onderweg",
        wordSaved: "Gespaard",
        wordNone: "Nog niets",
        wordTaken: "Opgenomen",
        subTotalOnly: "in totaal gespaard",
        subTotal: (amount: string) => `${amount} in totaal gespaard`,
        subMonthTaken: (amount: string) => `${amount} deze maand opgenomen`,
        subOf: (amount: string, goal: string) => `${amount} van ${goal}`,
        subMonth: (amount: string) => `${amount} deze maand`,
        subNone: "Deze maand niets opzijgezet",
      },
    },
    attention: {
      uncategorised: (n: number) =>
        n === 1 ? "1 transactie zonder categorie" : `${n} transacties zonder categorie`,
      uncategorisedSub: "Sorteer ze en arnaq onthoudt je keuze",
      incomeMissing: (name: string) => `${name} nog niet binnen`,
      expenseMissing: (name: string) => `${name} nog niet betaald`,
      expectedOn: (date: string) => `Verwacht op ${date}, wordt niet meegeteld`,
      foreign: (n: number) =>
        n === 1
          ? "1 regel in een andere munt telt niet mee"
          : `${n} regels in een andere munt tellen niet mee`,
      foreignSub: "Bekijk ze in de lijst",
      sort: "Sorteren",
      view: "Bekijk",
    },
    detail: {
      withPerDay: (pct: number, days: number, perDay: string) =>
        `${pct}% van je budget is besteed of al gepland, met ${days} ${days === 1 ? "dag" : "dagen"} te gaan (${perDay} per dag vrij).`,
      withoutPerDay: (pct: number, days: number) =>
        `${pct}% van je budget is besteed of al gepland, met ${days} ${days === 1 ? "dag" : "dagen"} te gaan.`,
      overOne: (a: string) => `${a} zit boven budget.`,
      overTwo: (a: string, b: string) => `${a} en ${b} zitten boven budget.`,
      overMany: (a: string, b: string, more: number) =>
        `${a}, ${b} en ${more} andere zitten boven budget.`,
    },
  },
  prognose: {
    noIncome: [
      plain(
        "Er is nog geen inkomen gepland, dus dit toont alleen uitgaven. Voeg je salaris of toeslagen toe onder ",
      ),
      em("Vaste lasten"),
      plain(" voor een echte prognose."),
    ] as Sentence,
    nothing: "Er is nog niets om te voorspellen. Upload eerst een afschrift.",
    noHistory: "Er is geen eerdere maand geüpload, dus gewone uitgaven worden als 0 voorspeld.",
    shortHistory: (n: number, wanted: number) =>
      `Maar ${n} van de ${wanted} maanden geschiedenis zijn geüpload.`,
    single: (month: string, net: string): Sentence => [
      plain(`${cap(month)} sluit op `),
      em(net),
      plain("."),
    ],
    tightBest: (tight: string, best: string): Sentence => [
      em(cap(tight)),
      plain(" wordt krap, "),
      plain(`${best} is je beste maand.`),
    ],
    bestTightest: (best: string, tight: string): Sentence => [
      em(cap(best)),
      plain(` is je beste maand, ${tight} de krapste.`),
    ],
    detailWorth: (start: string, end: string, month: string, plus: number, total: number) =>
      `Je vermogen gaat van ${start} naar ongeveer ${end} in ${month}. ${plus} van ${total} maanden sluit je in de plus.`,
    detailUp: (amount: string, month: string, plus: number, total: number) =>
      `Je geld groeit in totaal met ${amount} tot en met ${month}. ${plus} van ${total} maanden sluit je in de plus.`,
    detailDown: (amount: string, month: string, plus: number, total: number) =>
      `Je geld krimpt in totaal met ${amount} tot en met ${month}. ${plus} van ${total} maanden sluit je in de plus.`,
    noteBalance:
      "Je vermogen telt de rekeningen die je hebt geüpload en je spaargeld op; geld dat je niet hebt geüpload zit er niet in. Geld dat voor de BTW opzij staat telt niet mee: dat ben je verschuldigd.",
    noteEstimate:
      "Voorspelde maanden zijn een schatting: vaste lasten en inkomen zoals je ze hebt ingesteld, plus je gemiddelde gewone uitgaven.",
    noteMissed: (name: string, date: string) =>
      `${name} (verwacht ${date}) is niet gezien en telt niet mee.`,
    noteSetAside: (amount: string, month: string) =>
      `Je vaste spaarstortingen zetten tot en met ${month} ${amount} opzij. Dat verlaagt het saldo maar telt niet als uitgaven.`,
    parts: {
      expected: "verwacht",
      received: "ontvangen",
      paid: "betaald",
      partlyPaid: (paid: string, total: string) => `${paid} van ${total} betaald`,
      otherIncome: "Overig inkomen",
      fixedCosts: "Vaste lasten",
      everyday: "Gewone uitgaven",
      items: (n: number) => `${n} ${n === 1 ? "post" : "posten"}`,
      more: (n: number) => `${n} meer`,
      basisAverages: "je gemiddelden",
      basisActual: "werkelijk",
      basisMixed: "tot nu toe plus gemiddelden",
      setAsideNote: (amount: string) =>
        `Telt hierboven niet mee: ${amount} is opzij gezet voor sparen en de BTW.`,
    },
  },
  vasteLasten: {
    label: {
      paid: (date: string) => `betaald ${date}`,
      missed: (date: string) => `gemist, verwacht ${date}`,
      coming: (date: string) => `komt ${date}`,
    },
    none: "Nog geen vaste posten. Voeg ze toe of accepteer een suggestie.",
    allPaid: (): Sentence => [
      plain("Alle vaste lasten van deze maand zijn "),
      em("betaald"),
      plain("."),
    ],
    next: (toCome: string, name: string, date: string): Sentence => [
      plain("Nog "),
      em(toCome),
      plain(` te gaan; eerstvolgende is ${name} op ${date}.`),
    ],
  },
};
