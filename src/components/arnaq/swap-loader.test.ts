import { describe, expect, it } from "vitest";
import { swapAngle, swapPose } from "./motion";

describe("the swap loader's orbit", () => {
  it("starts at home, is swapped half way through the loop, and is back home at the end", () => {
    expect(swapAngle(0)).toBe(0);
    expect(swapAngle(3600 * 0.52)).toBeCloseTo(Math.PI);
    expect(swapAngle(3600 * 0.99)).toBeCloseTo(2 * Math.PI);
    // And it loops: the next loop starts at home again.
    expect(swapAngle(3600)).toBe(0);
    const home = swapPose(0);
    expect(home.a).toEqual({ x: 0, y: 0 });
    const swapped = swapPose(Math.PI);
    expect(swapped.a.x).toBeCloseTo(64);
    expect(swapped.q.x).toBeCloseTo(-64);
    expect(swapped.a.y).toBeCloseTo(0);
  });

  it("passes each letter under the other: the lower one is in front, and they overlap in the middle", () => {
    const mid = swapPose(Math.PI / 2);
    expect(mid.a.x).toBeCloseTo(32);
    expect(mid.q.x).toBeCloseTo(-32);
    expect(mid.a.y).toBeGreaterThan(0); // the a dips below ...
    expect(mid.q.y).toBeLessThan(0); // ... the q rises
    expect(mid.aInFront).toBe(true);
    expect(swapPose((3 * Math.PI) / 2).aInFront).toBe(false);
  });

  it("never leaves the logo's box (x from -6 to 127, y from -24 to 102), and stays centred", () => {
    for (let ms = 0; ms < 3600; ms += 20) {
      const { a, q } = swapPose(swapAngle(ms));
      // The a's ring is 0..57 wide at home, the q's ring 64..121; the q's stem reaches 78 down from the top.
      expect(0 + a.x).toBeGreaterThanOrEqual(-6);
      expect(57 + a.x).toBeLessThanOrEqual(127);
      expect(64 + q.x).toBeGreaterThanOrEqual(-6);
      expect(121 + q.x).toBeLessThanOrEqual(127);
      expect(a.y).toBeGreaterThanOrEqual(-24);
      expect(78 + a.y).toBeLessThanOrEqual(102);
      expect(q.y).toBeGreaterThanOrEqual(-24);
      expect(78 + q.y).toBeLessThanOrEqual(102);
      // The pair's middle never drifts sideways: the two offsets mirror each other.
      expect(a.x + q.x).toBeCloseTo(0);
    }
  });
});
