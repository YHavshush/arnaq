import type { Chip } from "@/design/tokens";

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
