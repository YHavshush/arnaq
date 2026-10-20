import type { Chip } from "@/design/tokens";
import type { Locale } from "@/i18n/config";

export type IconKey =
  | "home"
  | "zap"
  | "wifi"
  | "heart-pulse"
  | "shopping-basket"
  | "utensils"
  | "party-popper"
  | "bike"
  | "dumbbell"
  | "repeat"
  | "graduation-cap"
  | "shirt"
  | "stethoscope"
  | "plane"
  | "gift"
  | "piggy-bank"
  | "circle-ellipsis"
  | "wallet"
  | "landmark"
  | "hand-coins"
  | "users"
  | "arrow-left-right";

const MAP: Record<string, { chip: Chip; icon: IconKey }> = {
  Huur: { chip: "sky", icon: "home" },
  "Gas, water, licht": { chip: "yellow", icon: "zap" },
  "Internet & telefoon": { chip: "lavender", icon: "wifi" },
  Zorgverzekering: { chip: "rose", icon: "heart-pulse" },
  Boodschappen: { chip: "mint", icon: "shopping-basket" },
  "Eten & drinken": { chip: "peach", icon: "utensils" },
  "Uitgaan & social": { chip: "rose", icon: "party-popper" },
  Vervoer: { chip: "sky", icon: "bike" },
  Sport: { chip: "mint", icon: "dumbbell" },
  Abonnementen: { chip: "lavender", icon: "repeat" },
  Studie: { chip: "sky", icon: "graduation-cap" },
  "Kleding & verzorging": { chip: "peach", icon: "shirt" },
  Gezondheid: { chip: "rose", icon: "stethoscope" },
  "Reizen & vakantie": { chip: "sky", icon: "plane" },
  "Cadeaus & donaties": { chip: "rose", icon: "gift" },
  "Sparen & beleggen": { chip: "mint", icon: "piggy-bank" },
  Overig: { chip: "gray", icon: "circle-ellipsis" },
  "Salaris / bijbaan": { chip: "mint", icon: "wallet" },
  "Studiefinanciering (DUO)": { chip: "sky", icon: "landmark" },
  Zorgtoeslag: { chip: "mint", icon: "hand-coins" },
  Huurtoeslag: { chip: "mint", icon: "hand-coins" },
  "Familie / gift": { chip: "rose", icon: "users" },
  "Overig inkomen": { chip: "gray", icon: "wallet" },
  "Interne overboeking": { chip: "gray", icon: "arrow-left-right" },
};

/** Tint and icon for a category; unknown (user-added) categories get a neutral gray. */
export function categoryLook(name: string | null): { chip: Chip; icon: IconKey } {
  return (name !== null ? MAP[name] : undefined) ?? { chip: "gray", icon: "circle-ellipsis" };
}

/**
 * The default categories are stored under their Dutch names (rules and icons match on them), so
 * English is a display label only. Categories the user made themselves are shown as typed.
 */
const ENGLISH: Record<string, string> = {
  Huur: "Rent",
  "Gas, water, licht": "Gas, water & electricity",
  "Internet & telefoon": "Internet & phone",
  Zorgverzekering: "Health insurance",
  Boodschappen: "Groceries",
  "Eten & drinken": "Food & drink",
  "Uitgaan & social": "Going out & social",
  Vervoer: "Transport",
  Sport: "Sports",
  Abonnementen: "Subscriptions",
  Studie: "Study",
  "Kleding & verzorging": "Clothing & personal care",
  Gezondheid: "Health",
  "Reizen & vakantie": "Travel & holidays",
  "Cadeaus & donaties": "Gifts & donations",
  "Sparen & beleggen": "Savings & investing",
  Overig: "Other",
  "Salaris / bijbaan": "Salary / side job",
  "Studiefinanciering (DUO)": "Student finance (DUO)",
  Zorgtoeslag: "Healthcare allowance",
  Huurtoeslag: "Rent allowance",
  "Familie / gift": "Family / gift",
  "Overig inkomen": "Other income",
  "Interne overboeking": "Between my accounts",
};

const DUTCH: Record<string, string> = { "Interne overboeking": "Tussen mijn rekeningen" };

export function categoryLabel(name: string, locale: Locale): string {
  return locale === "nl" ? (DUTCH[name] ?? name) : (ENGLISH[name] ?? name);
}
