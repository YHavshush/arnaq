/**
 * Design tokens: the single source of truth for colour. `npm run tokens` turns this into
 * src/app/tokens.generated.css. See DESIGN.md for the reasoning behind every choice.
 */
export const THEMES = ["light", "dark"] as const;
export type ThemeName = (typeof THEMES)[number];

export const MOODS = ["neutral", "good", "warn", "bad"] as const;
export type Mood = (typeof MOODS)[number];

export const TONES = ["accent", "good", "warn", "bad"] as const;
export type Tone = (typeof TONES)[number];

export const CHIPS = ["sky", "mint", "peach", "rose", "lavender", "yellow", "gray"] as const;
export type Chip = (typeof CHIPS)[number];

export interface PageTokens {
  /** Gradient direction in degrees (180 is straight down). */
  angle: number;
  /** Gradient stops, top to bottom. The first is the colour at the very top of the page, the last at the bottom. */
  stops: string[];
  /** Where each stop sits, in per cent. */
  at: number[];
}

/** sRGB hex -> OKLab (https://bottosson.github.io/posts/oklab/), the space CSS `color-mix(in oklab, ...)` blends in. */
function toOklab(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const lin = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  const [r, g, b] = lin;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
function fromOklab([L, a, b]: [number, number, number]): string {
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const hex = lin.map((c) => {
    const v = Math.min(1, Math.max(0, c));
    const e = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    return Math.round(e * 255)
      .toString(16)
      .padStart(2, "0");
  });
  return `#${hex.join("")}`;
}
/** `fg` at `pct` per cent over `base`, blended in OKLab: the same result as `color-mix(in oklab, fg pct%, base)`. */
export function mixOklab(fg: string, pct: number, base: string): string {
  const a = toOklab(fg);
  const b = toOklab(base);
  return fromOklab(
    [0, 1, 2].map((i) => b[i] + (a[i] - b[i]) * (pct / 100)) as [number, number, number],
  );
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
  /** Fill of primary buttons and the text on it. Own tokens so buttons can differ from the text accent. */
  action: string;
  actionInk: string;
  /** Graphic marks: chart lines, dots, areas and bars. The same as `accent` today (ink-blue in light, pale sky in dark); its own token so marks can change apart from text links. */
  mark: string;
  /** Selected state of radio buttons and toggles (the dot). Needs 3:1 against the card, unlike a button fill. */
  select: string;
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
  /** Frosted card and floating navigation: translucent fill, edge, shadow (any CSS value). */
  glass: { bg: string; border: string; shadow: string; nav: string };
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
    action: "#243b73", // light keeps the original ink-blue; dark uses the pale sky
    actionInk: "#ffffff",
    select: "#243b73",
    mark: "#243b73",
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
    glass: {
      bg: "rgba(255,255,255,.58)",
      border: "rgba(255,255,255,.8)",
      shadow: "0 14px 40px -22px rgba(30,45,80,.45)",
      nav: "rgba(255,255,255,.76)",
    },
    // The soft blue-to-peach dawn the owner approved in the prototypes.
    page: { angle: 180, stops: ["#d9e5f5", "#f1e6dd", "#f6e8d8"], at: [0, 50, 100] },
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
    action: "#8fd0ff",
    actionInk: "#06121c",
    select: "#8fd0ff",
    mark: "#8fd0ff",
    soft: "rgba(143,208,255,.10)",
    good: "#5ee0a0",
    warn: "#f2b84b",
    bad: "#ff7b6e",
    chip: darkChips,
    ring: darkRing,
    glow: darkGlow,
    glass: {
      bg: "rgba(255,255,255,.055)",
      border: "rgba(255,255,255,.10)",
      shadow: "inset 0 1px 0 rgba(255,255,255,.08), 0 18px 44px -24px rgba(0,0,0,.8)",
      nav: "rgba(18,22,30,.80)",
    },
    // The onboarding's recipe, the same on every screen: a blue tint at the top and a violet one in the middle,
    // both mixed into the deep navy canvas, ending in the canvas (owner, 2026-10-22).
    page: {
      angle: 165,
      stops: [
        mixOklab(darkRing.accent[0], 26, "#141b28"),
        mixOklab(darkRing.accent[1], 22, "#141b28"),
        "#141b28",
      ],
      at: [0, 55, 100],
    },
  },
};

/**
 * Which hero treatment each theme uses (see DESIGN.md "Glow"). Light has no glow (A, decided
 * 2026-10-16); dark uses the lit conic ring (D). Changing this is a one-line decision.
 */
export const glowStyle: Record<ThemeName, "shadow" | "lit-ring" | "none"> = {
  light: "none",
  dark: "lit-ring",
};

/** Text pairs that must reach WCAG AA (4.5:1) in every theme. */
export const textPairs: [fg: keyof ThemeTokens, bg: keyof ThemeTokens][] = [
  ["ink", "canvas"],
  ["ink", "surface"],
  ["inkMuted", "canvas"],
  ["inkMuted", "surface"],
  ["actionInk", "action"],
  ["accent", "surface"],
  ["good", "surface"],
  ["warn", "surface"],
  ["bad", "surface"],
  ["good", "canvas"],
  ["warn", "canvas"],
  ["bad", "canvas"],
];
