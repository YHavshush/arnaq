/** The visible line of one arc, as fractions of the circle (0 at twelve o'clock, clockwise); `full` is the whole circle. */
export interface Arc {
  start: number;
  length: number;
  full?: boolean;
}

/** A round cap is as wide as the stroke: this is that width as a fraction of the circle the arc runs along. */
export function capFraction(stroke: number, size: number): number {
  return stroke / (Math.PI * (size - stroke));
}

const MIN_LENGTH = 0.0004;

/**
 * Where to draw the line of an arc that has round caps, so that the caps stay inside the arc's share of the circle and
 * neighbouring arcs keep a gap of `gap` between their caps. Each end is pulled in by half a cap plus half a gap; the
 * caps then give back their half. A very small share becomes a dot (a line of almost no length, centred on its share).
 * `only` is a single share that fills the circle: it is drawn whole, without caps or a seam.
 */
export function arcFor(
  share: { start: number; end: number },
  cap: number,
  gap: number,
  only: boolean,
): Arc {
  if (only && share.end - share.start >= 0.999) return { start: 0, length: 1, full: true };
  const inset = (cap + gap) / 2;
  const length = share.end - share.start - 2 * inset;
  if (length < MIN_LENGTH)
    return {
      start: (share.start + share.end) / 2 - MIN_LENGTH / 2,
      length: MIN_LENGTH,
      full: false,
    };
  return { start: share.start + inset, length, full: false };
}
