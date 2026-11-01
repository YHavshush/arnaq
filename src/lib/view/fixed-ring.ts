// Pure model of the Fixed page ring: the month's income as a circle, every fixed expense an arc.

/** How many items get an arc of their own; everything smaller is grouped into one "Other" arc. */
export const RING_NAMED_ITEMS = 4;

/** Colour slots of the named arcs (see `SLOT_COLOURS` in the ring component); `OTHER_SLOT` is the grouped arc. */
export const OTHER_SLOT = RING_NAMED_ITEMS;

export interface RingItem {
  id: number;
  name: string;
  /** Positive cents: the real amount when paid, otherwise the plan. */
  amount: number;
  paid: boolean;
}

/** One drawn arc. Positions are fractions of the full circle, 0 at twelve o'clock, clockwise. */
export interface RingSegment {
  /** The legend entry it belongs to. */
  key: string;
  slot: number;
  /** Solid when paid, light when still to pay. */
  paid: boolean;
  start: number;
  end: number;
  length: number;
}

export interface RingLegendEntry {
  key: string;
  slot: number;
  /** The item's name; null for the grouped "Other" entry (the caller supplies the word). */
  name: string | null;
  amount: number;
  /** True only when everything behind the entry is paid. */
  paid: boolean;
}

export type RingMode =
  /** Nothing fixed at all. */
  | "empty"
  /** Income is 0 or unknown: the arcs fill the circle on their own, the centre shows what is fixed. */
  | "noIncome"
  /** The fixed expenses are more than the income: arcs are clipped at the circle, the centre shows the shortfall. */
  | "short"
  | "normal";

export interface SplitRingModel {
  mode: RingMode;
  /** Cents of income used for the ring (0 when unknown). */
  income: number;
  /** Cents of all fixed expenses, also those clipped off the circle. */
  fixed: number;
  /** Income minus fixed expenses; negative is the shortfall. */
  leftOver: number;
  segments: RingSegment[];
  legend: RingLegendEntry[];
}

/**
 * Turn the month's fixed expenses and income into arcs.
 *
 * - The circle is the income. Without income it is the fixed total instead, so the arcs fill it.
 * - The four largest items get an arc each (largest first), the rest share one "other" arc.
 * - An arc is split in a solid (paid) and a light (still to pay) part where both exist; that only
 *   happens for "other".
 * - Arcs are clipped at the end of the circle: positions are never above 1, even when the fixed
 *   expenses are more than the income.
 */
export function splitRing(items: RingItem[], income: number): SplitRingModel {
  const sorted = items
    .filter((i) => i.amount > 0)
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name) || a.id - b.id);
  const fixed = sorted.reduce((s, i) => s + i.amount, 0);
  const knownIncome = Math.max(0, income);
  const leftOver = knownIncome - fixed;

  const mode: RingMode =
    fixed === 0 && knownIncome === 0
      ? "empty"
      : knownIncome === 0
        ? "noIncome"
        : leftOver < 0
          ? "short"
          : "normal";

  const named = sorted.slice(0, RING_NAMED_ITEMS);
  const rest = sorted.slice(RING_NAMED_ITEMS);
  type Group = { key: string; slot: number; name: string | null; parts: RingItem[] };
  const groups: Group[] = named.map((i, slot) => ({
    key: `item-${i.id}`,
    slot,
    name: i.name,
    parts: [i],
  }));
  if (rest.length > 0) groups.push({ key: "other", slot: OTHER_SLOT, name: null, parts: rest });

  const whole = knownIncome > 0 ? knownIncome : fixed;
  const segments: RingSegment[] = [];
  const legend: RingLegendEntry[] = [];
  let used = 0; // cents laid on the circle so far (never beyond `whole`)
  for (const g of groups) {
    const sum = (paid: boolean) =>
      g.parts.filter((p) => p.paid === paid).reduce((s, p) => s + p.amount, 0);
    const paidSum = sum(true);
    const openSum = sum(false);
    legend.push({
      key: g.key,
      slot: g.slot,
      name: g.name,
      amount: paidSum + openSum,
      paid: openSum === 0,
    });
    for (const [paid, cents] of [
      [true, paidSum],
      [false, openSum],
    ] as const) {
      if (cents === 0 || whole === 0) continue;
      const from = Math.min(used, whole);
      const to = Math.min(used + cents, whole);
      used += cents;
      if (to <= from) continue; // clipped away: the circle is already full
      const start = from / whole;
      const end = to / whole;
      segments.push({ key: g.key, slot: g.slot, paid, start, end, length: end - start });
    }
  }
  return { mode, income: knownIncome, fixed, leftOver, segments, legend };
}
