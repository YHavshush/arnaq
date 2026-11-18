import type { Bank } from "@/lib/import/types";

/**
 * Which of the banks arnaq knows (BANKS in src/db/schema.ts) an Enable Banking bank ("ASPSP") is, by its name. Only
 * these can be linked: an arnaq account needs a bank from that list, and a bank outside it would also have no file
 * importer to fall back on. Adding a bank means adding it to BANKS first.
 */
const PATTERNS: [RegExp, Bank][] = [
  [/^rabobank\b/, "rabobank"],
  [/^revolut\b/, "revolut"],
  [/^abn ?amro\b/, "abnamro"],
  [/^ing\b/, "ing"],
  [/^knab\b/, "knab"],
];

export function aspspBank(name: string): Bank | null {
  const n = name
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return PATTERNS.find(([re]) => re.test(n))?.[1] ?? null;
}
