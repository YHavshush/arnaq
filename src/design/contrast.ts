/** WCAG 2.x contrast helpers for solid #rrggbb colours. */
const channel = (v: number) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`Not a solid hex colour: ${hex}`);
  const n = parseInt(m[1], 16);
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Composite [r,g,b,a] over a solid #rrggbb and return the resulting solid #rrggbb. */
export function blendOver([r, g, b, a]: [number, number, number, number], baseHex: string): string {
  const n = parseInt(baseHex.slice(1), 16);
  const mix = (top: number, bottom: number) => Math.round(top * a + bottom * (1 - a));
  const out = [mix(r, (n >> 16) & 255), mix(g, (n >> 8) & 255), mix(b, n & 255)];
  return `#${out.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
