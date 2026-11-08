import type { RingSegment } from "./fixed-ring";
import type { WorthPart } from "./net-worth-parts";

/** One line under the ring: a part of net worth with its amount; a part with no money has a line but no arc. */
export interface WorthLegendEntry {
  key: string;
  /** The colour slot (see `slotColour` in the ring component); the same for the arc and its dot. */
  slot: number;
  name: string;
  /** Cents; negative for an account in the red or the BTW still owed. */
  amount: number;
  /** Words shown instead of the amount ("covered by your pot"). */
}

/** The last colour slot: parts beyond it share the grey. */
const LAST_SLOT = 4;

/**
 * Net worth as a ring: each part with money (an account, the savings) is an arc as long as its share of the money
 * there is, clockwise from twelve o'clock, and the arcs fill the circle. A part with no money (an account in the red,
 * the BTW still owed) has no arc, only a line in the legend. Pure model; the drawing is the SplitRing.
 */
export function worthRing(parts: WorthPart[]): {
  segments: RingSegment[];
  legend: WorthLegendEntry[];
} {
  // A part's slot is its place in the list, unless it takes the colour of another part (`slotOf`).
  const own = new Map(parts.map((p, i) => [p.key, Math.min(i, LAST_SLOT)]));
  const slotOf = (p: WorthPart, i: number) =>
    (p.slotOf !== undefined ? own.get(p.slotOf) : undefined) ?? Math.min(i, LAST_SLOT);
  const segments: RingSegment[] = [];
  let at = 0;
  parts.forEach((p, i) => {
    if (p.share <= 0) return;
    segments.push({
      key: p.key,
      slot: slotOf(p, i),
      paid: true,
      start: at,
      end: at + p.share,
      length: p.share,
    });
    at += p.share;
  });
  const legend = parts.map((p, i) => ({
    key: p.key,
    slot: slotOf(p, i),
    name: p.name,
    amount: p.amount,
  }));
  return { segments, legend };
}
