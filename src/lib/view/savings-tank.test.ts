import { describe, expect, it } from "vitest";
import { tankLevel } from "./savings-tank";

describe("tankLevel: how full the savings tank is", () => {
  it("is the share saved of the goal, as a whole per cent and a fraction for the drawing", () => {
    expect(tankLevel(210000, 500000)).toEqual({ pct: 42, level: 0.42, reached: false });
    expect(tankLevel(0, 500000)).toEqual({ pct: 0, level: 0, reached: false });
  });

  it("never goes below empty or above full, and is reached from the goal on", () => {
    expect(tankLevel(-5000, 500000)).toMatchObject({ pct: 0, level: 0, reached: false });
    expect(tankLevel(500000, 500000)).toEqual({ pct: 100, level: 1, reached: true });
    expect(tankLevel(750000, 500000)).toEqual({ pct: 100, level: 1, reached: true });
  });

  it("has nothing to fill without a goal", () => {
    expect(tankLevel(1000, 0)).toEqual({ pct: 0, level: 0, reached: false });
  });

  it("rounds the per cent like the card always did", () => {
    expect(tankLevel(333, 1000).pct).toBe(33);
    expect(tankLevel(3335, 10000).pct).toBe(33);
    expect(tankLevel(996, 1000).pct).toBe(100);
    // 99.6% is shown as 100%, but the goal is not reached yet.
    expect(tankLevel(996, 1000).reached).toBe(false);
  });
});
