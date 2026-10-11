/**
 * Design tokens: the single source of truth for colour. `npm run tokens` turns this into
 * src/app/tokens.generated.css. See DESIGN.md for the reasoning behind every choice.
 */
export const THEMES = ["light", "dark", "darkplus"] as const;
export type ThemeName = (typeof THEMES)[number];

export const MOODS = ["neutral", "good", "warn", "bad"] as const;
export type Mood = (typeof MOODS)[number];

export const TONES = ["accent", "good", "warn", "bad"] as const;
export type Tone = (typeof TONES)[number];

export const CHIPS = ["sky", "mint", "peach", "rose", "lavender", "yellow", "gray"] as const;
export type Chip = (typeof CHIPS)[number];

export interface PageTokens {
  /** Vertical gradient stops, evenly spaced. The first stop is the colour at the very top of the page. */
  stops: string[];
  /** Status wash at the top of the page, per mood: [r, g, b, alpha]. Follows the active screen's tone, never a stale month mood. */
  wash: Record<Mood, [r: number, g: number, b: number, a: number]>;
}

export interface ThemeTokens {
  /** Page base colour (solid). The visible page background is `pageBg`, a gradient. */
  canvas: string;
  /** Solid stand-in for a card sitting on the page (cards are translucent glass). Used for contrast checks. */
  surface: string;
  ink: string;
  inkMuted: string;
  hair: string;
  track: string;
  accent: string;
  accentInk: string;
  soft: string;
  good: string;
  warn: string;
  bad: string;
  chip: Record<Chip, [background: string, ink: string]>;
  /** Ring gradient per status tone. */
  ring: Record<Tone, [from: string, to: string]>;
  /** Soft tint behind/under the hero ring per tone. */
  glow: Record<Tone, string>;
  page: PageTokens;
}

const lightChips: ThemeTokens["chip"] = {
  sky: ["#dcecfa", "#1a4e86"],
  mint: ["#d9f3e1", "#14683a"],
  peach: ["#ffe8d4", "#8a4300"],
  rose: ["#fde0ec", "#9c2b63"],
  lavender: ["#e6e0f5", "#4b3a99"],
  yellow: ["#fef7d6", "#7a5e00"],
  gray: ["#efeff2", "#55555c"],
};
const darkChips: ThemeTokens["chip"] = {
  sky: ["#16314d", "#8ec3ff"],
  mint: ["#14392a", "#7fdca6"],
  peach: ["#4a2a12", "#ffbe8a"],
  rose: ["#4a1b33", "#ff9dc8"],
  lavender: ["#2d2750", "#b9a9ff"],
  yellow: ["#3e3408", "#f3d866"],
  gray: ["#2a2a30", "#b0b0ba"],
};
const darkRing: ThemeTokens["ring"] = {
  accent: ["#2ac9ff", "#7d8bff"],
  good: ["#1fc98f", "#9af2c4"],
  warn: ["#e8891a", "#ffd36b"],
  bad: ["#e5484d", "#ff9b8f"],
};
const darkGlow: ThemeTokens["glow"] = {
  accent: "rgba(125,139,255,.20)",
  good: "rgba(31,201,143,.22)",
  warn: "rgba(242,184,75,.22)",
  bad: "rgba(255,123,110,.22)",
};
// Strengths are capped so muted text keeps 4.5:1 on the strongest part of the wash (see tokens.test.ts).
const darkWash: PageTokens["wash"] = {
  neutral: [125, 139, 255, 0.26],
  good: [31, 201, 143, 0.22],
  warn: [242, 184, 75, 0.2],
  bad: [255, 123, 110, 0.26],
};
const darkplusWash: PageTokens["wash"] = {
  neutral: [125, 139, 255, 0.22],
  good: [31, 201, 143, 0.18],
  warn: [242, 184, 75, 0.16],
  bad: [255, 123, 110, 0.22],
};

export const themes: Record<ThemeName, ThemeTokens> = {
  light: {
    canvas: "#e9eaf3",
    surface: "#f6f1ea",
    ink: "#17202e",
    inkMuted: "#4a5568", // darkened from #566275: on the washed page top that only reached 3.9:1
    hair: "rgba(23,32,46,.10)",
    track: "rgba(23,32,46,.10)",
    accent: "#243b73",
    accentInk: "#ffffff",
    soft: "rgba(36,59,115,.08)",
    good: "#17714a",
    warn: "#8f5200",
    bad: "#b3362c",
    chip: lightChips,
    ring: {
      accent: ["#33c6ff", "#7f8cff"],
      good: ["#8fe0bd", "#23a371"],
      warn: ["#f9d39e", "#e98859"],
      bad: ["#f4aaa2", "#d6493f"],
    },
    glow: {
      accent: "rgba(120,170,255,.55)",
      good: "rgba(60,200,150,.5)",
      warn: "rgba(255,170,110,.55)",
      bad: "rgba(255,130,120,.5)",
    },
    page: {
      stops: ["#d9e5f5", "#f1e6dd", "#f6e8d8"], // the soft blue-to-peach dawn the owner approved in the prototypes
      wash: {
        neutral: [110, 160, 255, 0.36],
        good: [60, 200, 150, 0.36],
        warn: [255, 170, 110, 0.38],
        bad: [255, 130, 120, 0.34],
      },
    },
  },
  dark: {
    canvas: "#141b28",
    surface: "#242b37",
    ink: "#eef1f5",
    inkMuted: "#a8b1bf", // lifted from #8e97a5 so it survives the top glow
    hair: "rgba(255,255,255,.10)",
    track: "rgba(255,255,255,.075)",
    accent: "#8fd0ff",
    accentInk: "#06121c",
    soft: "rgba(143,208,255,.10)",
    good: "#5ee0a0",
    warn: "#f2b84b",
    bad: "#ff7b6e",
    chip: darkChips,
    ring: darkRing,
    glow: darkGlow,
    page: { stops: ["#1b2434", "#141b28", "#0f141d"], wash: darkWash },
  },
  /** "Donker +": a lighter, bluer slate. Same tokens as dark except the surface family. */
  darkplus: {
    canvas: "#1f2a40",
    surface: "#343e52",
    ink: "#eef1f5",
    inkMuted: "#b8c1d1", // lifted from #a3afc4 for the same reason
    hair: "rgba(255,255,255,.14)",
    track: "rgba(255,255,255,.11)",
    accent: "#8fd0ff",
    accentInk: "#06121c",
    soft: "rgba(143,208,255,.12)",
    good: "#5ee0a0",
    warn: "#f2b84b",
    bad: "#ff8a7e", // lightened: #ff7b6e only reached 4.26:1 on this surface
    chip: darkChips,
    ring: darkRing,
    glow: darkGlow,
    page: { stops: ["#2b3a56", "#1f2a40", "#172033"], wash: darkplusWash },
  },
};

/**
 * Which hero treatment each theme uses (see DESIGN.md "Glow"). Light uses a tinted shadow
 * underneath the ring (F); dark uses the lit conic ring (D). Changing this is a one-line decision.
 */
export const glowStyle: Record<ThemeName, "shadow" | "lit-ring" | "none"> = {
  light: "shadow",
  dark: "lit-ring",
  darkplus: "lit-ring",
};

/** Text pairs that must reach WCAG AA (4.5:1) in every theme. */
export const textPairs: [fg: keyof ThemeTokens, bg: keyof ThemeTokens][] = [
  ["ink", "canvas"],
  ["ink", "surface"],
  ["inkMuted", "canvas"],
  ["inkMuted", "surface"],
  ["accent", "surface"],
  ["good", "surface"],
  ["warn", "surface"],
  ["bad", "surface"],
  ["good", "canvas"],
  ["warn", "canvas"],
  ["bad", "canvas"],
];

/**
 * Whether the page background carries a status wash (a soft tint at the top that follows the screen's tone).
 * Light: off, decided by the owner (the wash was tested and judged not worth a third status signal next to ring colour and glow).
 * Dark and Dark +: on, it is part of the dark look the owner approved. Flip a value and run `npm run tokens`.
 */
export const statusWash: Record<ThemeName, boolean> = {
  light: false,
  dark: true,
  darkplus: true,
};
