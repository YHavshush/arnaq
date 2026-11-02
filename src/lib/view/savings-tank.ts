/** How full the savings tank is: whole per cent for the words, a fraction for the drawing, and whether the goal is reached. */
export function tankLevel(
  saved: number,
  target: number,
): { pct: number; level: number; reached: boolean } {
  if (target <= 0) return { pct: 0, level: 0, reached: false };
  const share = Math.max(0, Math.min(saved / target, 1));
  const pct = Math.round(share * 100);
  return { pct, level: share, reached: saved >= target };
}
