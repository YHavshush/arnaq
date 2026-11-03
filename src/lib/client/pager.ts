/**
 * The rules of swiping between the main tabs, the way a phone's own pagers (Instagram, Android's ViewPager, React
 * Native's tab view) decide them. The page follows the finger one to one; on release it goes on to the next tab when it
 * was dragged far enough or flicked fast enough, otherwise it springs back. At the first and last tab it resists.
 */

/** A drag of this many pixels in any direction is only a touch, not yet a swipe. */
export const SLOP = 10;
/** Sideways has to beat vertical by this much to count as a swipe (below it, the finger is scrolling). */
export const LOCK_RATIO = 1.3;
/** Dragged past this share of the screen width: go to the next tab. */
export const COMMIT_FRACTION = 0.33;
/** A flick faster than this (pixels per millisecond) goes on, over any distance beyond FLING_MIN. */
export const FLING_SPEED = 0.35;
export const FLING_MIN = 24;
/** How much of a drag shows past the first or last tab (it stretches, then springs back). */
export const RESISTANCE = 0.3;
/** Touches that start this close to a screen edge belong to the browser's back gesture. */
export const EDGE = 24;

export type Axis = "pending" | "horizontal" | "vertical";

/** Which way the finger is going once it has moved past the slop. */
export function lockAxis(dx: number, dy: number): Axis {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < SLOP && ay < SLOP) return "pending";
  return ax >= ay * LOCK_RATIO ? "horizontal" : "vertical";
}

/** Where the page sits for a drag of `dx`: one to one, except past the ends, where it resists. */
export function pagePosition(dx: number, hasNext: boolean): number {
  return hasNext ? dx : dx * RESISTANCE;
}

/** The speed (pixels per millisecond, always positive) over the last moments of the drag. */
export function flickSpeed(samples: { x: number; t: number }[], now: number, windowMs = 100) {
  const recent = samples.filter((s) => now - s.t <= windowMs);
  if (recent.length < 2) return 0;
  const first = recent[0];
  const last = recent[recent.length - 1];
  return last.t > first.t ? Math.abs(last.x - first.x) / (last.t - first.t) : 0;
}

/** Whether releasing now goes on to the next tab. */
export function shouldCommit(input: {
  dx: number;
  speed: number;
  width: number;
  hasNext: boolean;
}): boolean {
  if (!input.hasNext) return false;
  const far = Math.abs(input.dx) >= input.width * COMMIT_FRACTION;
  const flick = input.speed >= FLING_SPEED && Math.abs(input.dx) >= FLING_MIN;
  return far || flick;
}
