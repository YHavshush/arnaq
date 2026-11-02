import { describe, expect, it } from "vitest";
import { CONFIRM_AT, slideKey, slideProgress, slideReached } from "./slide";

describe("slide to confirm", () => {
  it("turns a drag into progress between 0 and 1 of the room the handle has", () => {
    expect(slideProgress(0, 200)).toBe(0);
    expect(slideProgress(100, 200)).toBe(0.5);
    expect(slideProgress(200, 200)).toBe(1);
    expect(slideProgress(-30, 200)).toBe(0); // dragged backwards: stays at the start
    expect(slideProgress(500, 200)).toBe(1); // dragged past the end: stops at the end
    expect(slideProgress(50, 0)).toBe(0); // no room (not laid out yet): nothing happens
  });

  it("confirms only when the handle is (nearly) all the way across, never half way", () => {
    expect(slideReached(0)).toBe(false);
    expect(slideReached(0.5)).toBe(false);
    expect(slideReached(CONFIRM_AT - 0.01)).toBe(false);
    expect(slideReached(CONFIRM_AT)).toBe(true);
    expect(slideReached(1)).toBe(true);
  });

  it("can be operated from the keyboard and by a screen reader's adjust gesture, in steps", () => {
    expect(slideKey("ArrowRight", 0)).toBe(0.25);
    expect(slideKey("ArrowUp", 0.5)).toBe(0.75);
    expect(slideKey("ArrowRight", 0.9)).toBe(1);
    expect(slideKey("ArrowLeft", 0.5)).toBe(0.25);
    expect(slideKey("ArrowDown", 0)).toBe(0);
    expect(slideKey("End", 0)).toBe(1);
    expect(slideKey("Home", 0.75)).toBe(0);
    expect(slideKey("a", 0.5)).toBeNull();
    expect(slideKey("Enter", 0.5)).toBeNull(); // a single key press must not confirm by itself
  });
});
