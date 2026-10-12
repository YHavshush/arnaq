import type { Mood, Tone } from "@/design/tokens";

/** Ring tone for budget use (share 0..): good under 85%, warn from 85% to 100%, bad above. */
export function toneForUsage(used: number): Tone {
  if (used > 1) return "bad";
  if (used >= 0.85) return "warn";
  return "good";
}

/** Page mood for a tone: neutral progress (accent) keeps the neutral page. */
export function moodForTone(tone: Tone): Mood {
  return tone === "accent" ? "neutral" : tone;
}

/** Row status for a bar: how full is this category against its budget? */
export function barState(actual: number, budget: number | null): "none" | "ok" | "warn" | "bad" {
  if (budget === null || budget <= 0) return "none";
  const used = actual / budget;
  return used > 1 ? "bad" : used >= 0.85 ? "warn" : "ok";
}
