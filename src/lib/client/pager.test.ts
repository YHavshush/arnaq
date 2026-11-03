import { describe, expect, it } from "vitest";
import {
  COMMIT_FRACTION,
  FLING_MIN,
  FLING_SPEED,
  RESISTANCE,
  flickSpeed,
  lockAxis,
  pagePosition,
  shouldCommit,
} from "./pager";

describe("lockAxis", () => {
  it("waits until the finger has moved", () => {
    expect(lockAxis(4, 3)).toBe("pending");
  });
  it("calls a clearly sideways move a swipe, and a clearly vertical one a scroll", () => {
    expect(lockAxis(30, 5)).toBe("horizontal");
    expect(lockAxis(-30, 5)).toBe("horizontal");
    expect(lockAxis(5, 30)).toBe("vertical");
  });
  it("calls a diagonal move a scroll, so reading is never hijacked", () => {
    expect(lockAxis(20, 20)).toBe("vertical");
  });
});

describe("pagePosition", () => {
  it("follows the finger one to one", () => {
    expect(pagePosition(120, true)).toBe(120);
    expect(pagePosition(-80, true)).toBe(-80);
  });
  it("resists past the first or last tab", () => {
    expect(pagePosition(100, false)).toBe(100 * RESISTANCE);
  });
});

describe("flickSpeed", () => {
  it("is the speed over the last moments only", () => {
    const samples = [
      { x: 0, t: 0 },
      { x: 10, t: 380 },
      { x: 60, t: 460 },
      { x: 120, t: 500 },
    ];
    expect(flickSpeed(samples, 500)).toBeCloseTo((120 - 60) / 40, 5);
  });
  it("is zero with fewer than two recent samples", () => {
    expect(flickSpeed([{ x: 5, t: 0 }], 10)).toBe(0);
    expect(flickSpeed([], 10)).toBe(0);
  });
});

describe("shouldCommit", () => {
  const width = 390;
  it("goes on after a long slow drag, and springs back after a short slow one", () => {
    expect(
      shouldCommit({ dx: -(width * COMMIT_FRACTION + 1), speed: 0, width, hasNext: true }),
    ).toBe(true);
    expect(shouldCommit({ dx: -60, speed: 0.05, width, hasNext: true })).toBe(false);
  });
  it("goes on after a short quick flick", () => {
    expect(
      shouldCommit({ dx: -(FLING_MIN + 5), speed: FLING_SPEED + 0.1, width, hasNext: true }),
    ).toBe(true);
  });
  it("ignores a fast twitch that barely moved", () => {
    expect(shouldCommit({ dx: -(FLING_MIN - 5), speed: 2, width, hasNext: true })).toBe(false);
  });
  it("never goes on when there is no next tab", () => {
    expect(shouldCommit({ dx: -300, speed: 2, width, hasNext: false })).toBe(false);
  });
});
