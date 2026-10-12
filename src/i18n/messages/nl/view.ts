import type { Sentence } from "../../types";
import type { view as en } from "../en/view";

const plain = (text: string) => ({ text });
const em = (text: string) => ({ text, em: true });

export const view: typeof en = {
  overzicht: {
    uncategorised: "Zonder categorie",
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
      sorteren: {
        label: "Te sorteren",
        word: (n: number) => `${n} open`,
        wordNone: "Alles gesorteerd",
        sub: "transacties zonder categorie",
        subNone: "Geen losse transacties deze maand",
      },
    },
  },
  prognose: {
    nothing: "Er is nog niets om te voorspellen. Upload eerst een afschrift.",
    noHistory: "Er is geen eerdere maand geüpload, dus gewone uitgaven worden als 0 voorspeld.",
    shortHistory: (n: number, wanted: number) =>
      `Maar ${n} van de ${wanted} maanden geschiedenis zijn geüpload.`,
    single: (month: string, net: string): Sentence => [
      plain(`${month} sluit op `),
      em(net),
      plain("."),
    ],
    range: (tight: string, tightNet: string, best: string, bestNet: string): Sentence => [
      plain("De krapste maand is "),
      em(tight),
      plain(` (${tightNet}), de beste `),
      em(best),
      plain(` (${bestNet}).`),
    ],
  },
  vasteLasten: {
    label: {
      paid: (date: string) => `betaald ${date}`,
      missed: (date: string) => `gemist, verwacht ${date}`,
      coming: (date: string) => `komt ${date}`,
    },
    none: "Nog geen vaste lasten. Voeg ze toe of accepteer een suggestie.",
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
