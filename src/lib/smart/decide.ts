import type { HistoryResult } from "./history";

export type Decision =
  | { kind: "apply"; categoryId: number; source: "catalog" | "history" }
  | { kind: "suggest"; categoryId: number }
  | { kind: "none" };

/**
 * How the deterministic layers combine for one open transaction. The catalog answers first; a strong
 * answer from the person's own history is as good; when they disagree, nothing is applied and the
 * history's answer is offered ("Probably X?") because the person's own habits beat a general list.
 * A weak history answer is only ever offered, and so is a hint from the name ("café") when nothing else is known.
 */
export function decide(input: {
  catalog: number | null;
  /** A category the name only hints at: offered when nothing firmer is known, never applied. */
  hint?: number | null;
  history: HistoryResult;
}): Decision {
  const { catalog, hint = null, history } = input;
  if (catalog !== null && history.strong !== null && catalog !== history.strong)
    return { kind: "suggest", categoryId: history.strong };
  if (catalog !== null) return { kind: "apply", categoryId: catalog, source: "catalog" };
  if (history.strong !== null)
    return { kind: "apply", categoryId: history.strong, source: "history" };
  if (history.weak !== null) return { kind: "suggest", categoryId: history.weak };
  if (hint !== null) return { kind: "suggest", categoryId: hint };
  return { kind: "none" };
}
