import { describe, expect, it } from "vitest";
import { arcFor, capFraction } from "./ring-arcs";

const CAP = 0.02; // a round cap is 2% of the circle wide
const GAP = 0.006;

describe("arcFor: where a round-capped arc is drawn inside its share of the circle", () => {
  it("leaves the gap between neighbours: caps included, two arcs never touch", () => {
    const a = arcFor({ start: 0, end: 0.5 }, CAP, GAP, false);
    const b = arcFor({ start: 0.5, end: 1 }, CAP, GAP, false);
    const aEnd = a.start + a.length + CAP / 2; // where the cap of the first arc ends
    const bStart = b.start - CAP / 2; // where the cap of the second begins
    expect(bStart - aEnd).toBeCloseTo(GAP);
  });

  it("keeps an arc inside its own share, caps included", () => {
    const a = arcFor({ start: 0.25, end: 0.75 }, CAP, GAP, false);
    expect(a.start - CAP / 2).toBeGreaterThanOrEqual(0.25);
    expect(a.start + a.length + CAP / 2).toBeLessThanOrEqual(0.75);
  });

  it("makes a very small share a dot, centred on its share, never nothing and never negative", () => {
    const tiny = arcFor({ start: 0.5, end: 0.51 }, CAP, GAP, false);
    expect(tiny.length).toBeGreaterThan(0);
    expect(tiny.length).toBeLessThan(0.001);
    expect(tiny.start + tiny.length / 2).toBeCloseTo(0.505);
  });

  it("draws a single share that fills the circle as the whole circle, without a seam", () => {
    expect(arcFor({ start: 0, end: 1 }, CAP, GAP, true)).toEqual({
      start: 0,
      length: 1,
      full: true,
    });
    // Two arcs, one of them whole, is not "only".
    expect(arcFor({ start: 0, end: 1 }, CAP, GAP, false).full).toBe(false);
  });
});

describe("capFraction", () => {
  it("is a stroke's width as a share of the circle it runs along", () => {
    // A ring of 224px with a 14px stroke: the circle is 210px across to the middle of the stroke.
    expect(capFraction(14, 224)).toBeCloseTo(14 / (Math.PI * 210));
  });
});
