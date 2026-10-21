import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "./contrast";
import { buildTokensCss } from "./css";
import { CHIPS, THEMES, TONES, glowStyle, mixOklab, textPairs, themes } from "./tokens";

const AA = 4.5;

describe.each(THEMES)("theme %s", (name) => {
  const t = themes[name];

  it.each(textPairs)("%s on %s reaches WCAG AA", (fg, bg) => {
    expect(contrastRatio(t[fg] as string, t[bg] as string)).toBeGreaterThanOrEqual(AA);
  });

  it("ink and muted text stay readable on every stop of the page gradient", () => {
    for (const stop of t.page.stops) {
      expect(contrastRatio(t.ink, stop)).toBeGreaterThanOrEqual(AA);
      expect(contrastRatio(t.inkMuted, stop)).toBeGreaterThanOrEqual(AA);
    }
    expect(t.page.stops).toHaveLength(t.page.at.length);
  });

  it("button text reaches AA on the accent colour", () => {
    expect(contrastRatio(t.accentInk, t.accent)).toBeGreaterThanOrEqual(AA);
  });

  it.each(CHIPS)("chip %s: icon colour reaches AA on its tint", (chip) => {
    const [bg, ink] = t.chip[chip];
    expect(contrastRatio(ink, bg)).toBeGreaterThanOrEqual(AA);
  });

  it("defines every tone", () => {
    expect(Object.keys(t.ring).sort()).toEqual([...TONES].sort());
    expect(Object.keys(t.glow).sort()).toEqual([...TONES].sort());
    expect(glowStyle[name]).toBeDefined();
  });
});

describe("generated css", () => {
  it("is up to date with the tokens (run `npm run tokens`)", () => {
    const file = readFileSync(path.join(process.cwd(), "src/app/tokens.generated.css"), "utf8");
    expect(file).toBe(buildTokensCss());
  });

  it("has one page background per theme, the same on every screen (no per-screen glow)", () => {
    const css = buildTokensCss();
    expect(css).not.toContain("radial-gradient");
    expect(css).not.toContain("--page-bg-good");
    expect(css.match(/--page-bg:/g)).toHaveLength(THEMES.length + 2); // :root (light), the system dark, and one per explicit theme
    expect(css.match(/--page-end:/g)).toHaveLength(THEMES.length + 2);
  });

  it("builds the dark gradient from the onboarding recipe: logo tints mixed into the canvas", () => {
    const dark = themes.dark;
    expect(dark.page.stops[2]).toBe(dark.canvas);
    // OKLab mixing is what color-mix(in oklab, ...) does: 0 per cent is the base, 100 the colour.
    expect(mixOklab("#2ac9ff", 0, "#141b28")).toBe("#141b28");
    expect(mixOklab("#2ac9ff", 100, "#141b28")).toBe("#2ac9ff");
    expect(dark.page.stops[0]).toBe(mixOklab(dark.ring.accent[0], 26, dark.canvas));
  });

  it("covers light and dark (system and explicit), and no Dark +", () => {
    const css = buildTokensCss();
    expect(css).toContain(":root {");
    expect(css).toContain(":root:not([data-theme])");
    for (const n of THEMES) expect(css).toContain(`:root[data-theme="${n}"]`);
  });
});
