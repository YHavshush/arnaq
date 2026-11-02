/** The visible line of one arc, as fractions of the circle (0 at twelve o'clock, clockwise); `full` is the whole circle. */
export interface Arc {
  start: number;
  length: number;
  full?: boolean;
  /** Round caps. A share too small for two caps is a flat sliver (square ends) at its true size instead. */
  round: boolean;
}

/** A round cap is as wide as the stroke: this is that width as a fraction of the circle the arc runs along. */
export function capFraction(stroke: number, size: number): number {
  return stroke / (Math.PI * (size - stroke));
}

const MIN_LENGTH = 0.0004;

/**
 * Where to draw the line of an arc that has round caps, so that the caps stay inside the arc's share of the circle and
 * neighbouring arcs keep a gap of `gap` between their caps. Each end is pulled in by half a cap plus half a gap; the
 * caps then give back their half. A share too small for two caps is drawn flat at its true size. `only` is a single
 * share that fills the circle: it is drawn whole, without caps or a seam.
 */
export function arcFor(
  share: { start: number; end: number },
  cap: number,
  gap: number,
  only: boolean,
): Arc {
  if (only && share.end - share.start >= 0.999)
    return { start: 0, length: 1, full: true, round: false };
  const size = share.end - share.start;
  // Too small to hold two round caps: they would stick out of the share and overlap its neighbours. Draw it flat,
  // at the size it really is (less the gap), so every share stays where and as big as it is.
  if (size < 2 * cap)
    return {
      start: share.start + gap / 2,
      length: Math.max(size - gap, MIN_LENGTH),
      round: false,
    };
  const inset = (cap + gap) / 2;
  return { start: share.start + inset, length: size - 2 * inset, round: true };
}
