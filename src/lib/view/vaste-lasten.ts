import type { OccurrenceView } from "@/lib/recurring/occurrences";
import { dayLabel, euro } from "./format";
import type { Sentence } from "./overzicht";

export interface VasteLastRow {
  occurrenceId: number;
  itemId: number;
  name: string;
  categoryId: number | null;
  type: "expense" | "income";
  status: "expected" | "matched" | "missed";
  /** Positive cents: the real amount when paid, otherwise the plan. */
  amount: number;
  date: string;
  /** Short status text: "betaald 1 okt", "komt 25 okt", "gemist". */
  label: string;
}

export interface VasteLasten {
  paid: number;
  total: number;
  /** Ring fill, 0..1. */
  share: number;
  toCome: number;
  sentence: Sentence;
  expenses: VasteLastRow[];
  income: VasteLastRow[];
}

const plain = (text: string) => ({ text });
const em = (text: string) => ({ text, em: true });

function labelFor(o: OccurrenceView): string {
  if (o.status === "matched") return `betaald ${dayLabel(o.actualDate ?? o.expectedDate)}`;
  if (o.status === "missed") return `gemist, verwacht ${dayLabel(o.expectedDate)}`;
  return `komt ${dayLabel(o.expectedDate)}`;
}

/** Pure view model for the Vaste lasten screen: one month of occurrences. */
export function buildVasteLasten(occurrences: OccurrenceView[]): VasteLasten {
  const rows = occurrences
    .map<VasteLastRow>((o) => ({
      occurrenceId: o.id,
      itemId: o.recurringItemId,
      name: o.itemName,
      categoryId: o.categoryId,
      type: o.type,
      status: o.status,
      amount: o.amount,
      date: o.status === "matched" ? (o.actualDate ?? o.expectedDate) : o.expectedDate,
      label: labelFor(o),
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  const expenses = rows.filter((r) => r.type === "expense");
  const income = rows.filter((r) => r.type === "income");
  const paid = expenses.filter((r) => r.status === "matched").length;
  const open = expenses.filter((r) => r.status !== "matched");
  const toCome = open.reduce((s, r) => s + r.amount, 0);

  let sentence: Sentence;
  if (expenses.length === 0)
    sentence = [plain("Nog geen vaste lasten. Voeg ze toe of accepteer een suggestie.")];
  else if (open.length === 0)
    sentence = [plain("Alle vaste lasten van deze maand zijn "), em("betaald"), plain(".")];
  else {
    const next = open[0];
    sentence = [
      plain("Nog "),
      em(euro(toCome)),
      plain(` te gaan; eerstvolgende is ${next.name} op ${dayLabel(next.date)}.`),
    ];
  }

  return {
    paid,
    total: expenses.length,
    share: expenses.length === 0 ? 0 : paid / expenses.length,
    toCome,
    sentence,
    expenses,
    income,
  };
}
