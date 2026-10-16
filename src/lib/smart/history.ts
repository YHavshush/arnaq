/** One shop the person has categorised before: how many transactions went to which category. */
export interface HistoryEntry {
  key: string;
  categoryId: number;
  count: number;
}

export interface HistoryResult {
  /** A category the history is sure about (the person's own earlier choices agree). */
  strong: number | null;
  /** A category worth offering ("Probably X?") but not sure enough to apply. */
  weak: number | null;
}

/** Thresholds, set from the owner's own data by `npm run smart:eval` (see the plan, slice 8). */
export const HISTORY_THRESHOLDS = {
  /** Neighbours below this are unrelated. */
  related: 0.6,
  /** The best neighbour must be at least this close to apply on its own. */
  strong: 0.85,
  /** Transactions that must back the category. */
  support: 2,
  /** Share of the nearby shops' transactions that must agree. */
  agreement: 0.8,
  /** Only the closest few shops are asked. */
  neighbours: 5,
} as const;

const trigrams = (s: string): Set<string> => {
  const padded = `  ${s} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3));
  return out;
};

/** Dice coefficient on trigrams, 0..1: 1 for the same text, 0 for nothing in common. */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const x = trigrams(a);
  const y = trigrams(b);
  let shared = 0;
  for (const g of x) if (y.has(g)) shared++;
  return (2 * shared) / (x.size + y.size);
}

/**
 * What the person's own history says about a shop. Looks at the closest few shops they have
 * categorised (by name similarity): strong when the closest one is nearly the same name, enough
 * transactions back it and nearly all of them agree; weak when there is a related shop but not that
 * much certainty; nothing when no shop is related.
 */
export function historyLookup(
  key: string,
  history: HistoryEntry[],
  allowed?: (categoryId: number) => boolean,
): HistoryResult {
  const t = HISTORY_THRESHOLDS;
  const none: HistoryResult = { strong: null, weak: null };
  if (!key) return none;
  const near = history
    .filter((h) => !allowed || allowed(h.categoryId))
    .map((h) => ({ ...h, sim: similarity(key, h.key) }))
    .filter((h) => h.sim >= t.related)
    .sort((a, b) => b.sim - a.sim || b.count - a.count);
  if (near.length === 0) return none;

  // The closest few distinct shops; a shop can appear under more than one category.
  const keys: string[] = [];
  for (const h of near) {
    if (!keys.includes(h.key)) keys.push(h.key);
    if (keys.length === t.neighbours) break;
  }
  const top = near.filter((h) => keys.includes(h.key));
  const weight = new Map<number, number>();
  let total = 0;
  for (const h of top) {
    weight.set(h.categoryId, (weight.get(h.categoryId) ?? 0) + h.count);
    total += h.count;
  }
  const [best, bestCount] = [...weight.entries()].sort((a, b) => b[1] - a[1])[0];
  const strong =
    near[0].sim >= t.strong && bestCount >= t.support && bestCount / total >= t.agreement;
  return strong ? { strong: best, weak: null } : { strong: null, weak: best };
}
