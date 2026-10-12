import type { OccurrenceView } from "@/lib/recurring/occurrences";
import type { Locale } from "@/i18n/config";
import { messages } from "@/i18n/messages";
import type { Sentence } from "@/i18n/types";
import { formatter } from "./format";

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

function labelFor(o: OccurrenceView, locale: Locale): string {
  const t = messages[locale].view.vasteLasten.label;
  const { dayLabel } = formatter(locale);
  if (o.status === "matched") return t.paid(dayLabel(o.actualDate ?? o.expectedDate));
  if (o.status === "missed") return t.missed(dayLabel(o.expectedDate));
  return t.coming(dayLabel(o.expectedDate));
}

/** Pure view model for the Vaste lasten screen: one month of occurrences. */
export function buildVasteLasten(occurrences: OccurrenceView[], locale: Locale): VasteLasten {
  const t = messages[locale].view.vasteLasten;
  const { euro, dayLabel } = formatter(locale);
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
      label: labelFor(o, locale),
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  const expenses = rows.filter((r) => r.type === "expense");
  const income = rows.filter((r) => r.type === "income");
  const paid = expenses.filter((r) => r.status === "matched").length;
  const open = expenses.filter((r) => r.status !== "matched");
  const toCome = open.reduce((s, r) => s + r.amount, 0);

  let sentence: Sentence;
  if (expenses.length === 0) sentence = [{ text: t.none }];
  else if (open.length === 0) sentence = t.allPaid();
  else sentence = t.next(euro(toCome), open[0].name, dayLabel(open[0].date));

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
