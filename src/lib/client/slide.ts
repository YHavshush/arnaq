/** How far across the handle has to be (0 to 1) for the slide to count as confirmed. */
export const CONFIRM_AT = 0.85;

/** The size of one keyboard step: four presses reach the end. */
const STEP = 0.25;

const clamp = (n: number) => Math.min(Math.max(n, 0), 1);

/** A drag of `dx` pixels along `room` pixels (the track less the handle) as progress between 0 and 1. */
export function slideProgress(dx: number, room: number): number {
  return room > 0 ? clamp(dx / room) : 0;
}

/** Whether the handle is far enough across to confirm. */
export function slideReached(progress: number): boolean {
  return progress >= CONFIRM_AT;
}

/**
 * The progress after a key, or null for a key the slide does not use. Arrows move in steps (so a screen reader's
 * adjust gesture works too) and End jumps across. Enter and Space do nothing here on purpose: one press must not confirm.
 */
export function slideKey(key: string, progress: number): number | null {
  switch (key) {
    case "ArrowRight":
    case "ArrowUp":
      return clamp(progress + STEP);
    case "ArrowLeft":
    case "ArrowDown":
      return clamp(progress - STEP);
    case "End":
      return 1;
    case "Home":
      return 0;
    default:
      return null;
  }
}
