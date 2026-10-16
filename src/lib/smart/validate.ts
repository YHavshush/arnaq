import type { CategoryOption, ClassifyAnswer, ClassifyItem } from "./provider";

const BASES = new Set(["known_merchant", "words", "none"]);

/**
 * Trust nothing a model returns. Keep an answer only when its ref is one we asked about (once), its
 * category is one of the options we offered (or null), and its basis is one of the known words. Anything
 * else is dropped, which counts as "the model did not know": the person is asked instead. Prompt injection
 * in a shop name cannot get past this: whatever the model says, only a category from the closed list can
 * ever be applied.
 */
export function validateAnswers(
  items: ClassifyItem[],
  options: CategoryOption[],
  answers: unknown,
): Map<string, ClassifyAnswer> {
  const asked = new Set(items.map((i) => i.ref));
  const offered = new Set(options.map((o) => o.ref));
  const out = new Map<string, ClassifyAnswer>();
  if (!Array.isArray(answers)) return out;
  const seen = new Set<string>();
  for (const a of answers) {
    if (typeof a !== "object" || a === null) continue;
    const { ref, category, basis } = a as Record<string, unknown>;
    if (typeof ref !== "string" || !asked.has(ref)) continue;
    if (seen.has(ref)) {
      out.delete(ref); // answered twice: do not pick one
      continue;
    }
    seen.add(ref);
    if (category !== null && (typeof category !== "string" || !offered.has(category))) continue;
    if (typeof basis !== "string" || !BASES.has(basis)) continue;
    out.set(ref, {
      ref,
      category: category as string | null,
      basis: basis as ClassifyAnswer["basis"],
    });
  }
  return out;
}
