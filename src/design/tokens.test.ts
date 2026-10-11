import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { blendOver, contrastRatio } from "./contrast";
import { buildTokensCss } from "./css";
import { CHIPS, MOODS, THEMES, TONES, glowStyle, statusWash, textPairs, themes } from "./tokens";

const AA = 4.5;

describe.each(THEMES)("theme %s", (name) => {
  const t = themes[name];

  it.each(textPairs)("%s on %s reaches WCAG AA", (fg, bg) => {
    expect(contrastRatio(t[fg] as string, t[bg] as string)).toBeGreaterThanOrEqual(AA);
  });

  it.each(MOODS)("ink and muted text stay readable on the washed page top (%s)", (mood) => {
    const top = blendOver(t.page.wash[mood], t.page.stops[0]);
    expect(contrastRatio(t.ink, top)).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio(t.inkMuted, top)).toBeGreaterThanOrEqual(AA);
  });

  it("button text reaches AA on the accent colour", () => {
    expect(contrastRatio(t.accentInk, t.accent)).toBeGreaterThanOrEqual(AA);
  });

  it.each(CHIPS)("chip %s: icon colour reaches AA on its tint", (chip) => {
    const [bg, ink] = t.chip[chip];
    expect(contrastRatio(ink, bg)).toBeGreaterThanOrEqual(AA);
  });

  it("defines every tone and mood", () => {
    expect(Object.keys(t.ring).sort()).toEqual([...TONES].sort());
    expect(Object.keys(t.glow).sort()).toEqual([...TONES].sort());
    expect(Object.keys(t.page.wash).sort()).toEqual([...MOODS].sort());
    expect(glowStyle[name]).toBeDefined();
  });
});

describe("generated css", () => {
  it("is up to date with the tokens (run `npm run tokens`)", () => {
    const file = readFileSync(path.join(process.cwd(), "src/app/tokens.generated.css"), "utf8");
    expect(file).toBe(buildTokensCss());
  });

  it("only emits a wash where the theme has statusWash on", () => {
    const css = buildTokensCss();
    const lightBlock = css.slice(css.indexOf(":root {"), css.indexOf("@media"));
    expect(statusWash.light).toBe(false);
    expect(lightBlock).not.toContain("radial-gradient");
    expect(css.slice(css.indexOf('[data-theme="dark"]'))).toContain("radial-gradient");
  });

  it("covers light, dark (system and explicit) and darkplus", () => {
    const css = buildTokensCss();
    expect(css).toContain(":root {");
    expect(css).toContain(":root:not([data-theme])");
    for (const n of THEMES) expect(css).toContain(`:root[data-theme="${n}"]`);
  });
});
