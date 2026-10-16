import type { HistoryResult } from "./history";

export type Decision =
  | { kind: "apply"; categoryId: number; source: "catalog" | "history" }
  | { kind: "suggest"; categoryId: number }
  | { kind: "none" };

/**
 * How the deterministic layers combine for one open transaction. The catalog answers first; a strong
 * answer from the person's own history is as good; when they disagree, nothing is applied and the
 * history's answer is offered ("Probably X?") because the person's own habits beat a general list.
 * A weak history answer is only ever offered.
 */
export function decide(input: { catalog: number | null; history: HistoryResult }): Decision {
  const { catalog, history } = input;
  if (catalog !== null && history.strong !== null && catalog !== history.strong)
    return { kind: "suggest", categoryId: history.strong };
  if (catalog !== null) return { kind: "apply", categoryId: catalog, source: "catalog" };
  if (history.strong !== null)
    return { kind: "apply", categoryId: history.strong, source: "history" };
  if (history.weak !== null) return { kind: "suggest", categoryId: history.weak };
  return { kind: "none" };
}
