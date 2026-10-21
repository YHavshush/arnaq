import { describe, expect, it } from "vitest";
import { numberSize } from "./hero";

describe("numberSize", () => {
  it("keeps the full size for short numbers", () => {
    expect(numberSize(1)).toBe(52);
    expect(numberSize(5)).toBe(52);
  });

  it("shrinks long numbers so they stay inside the ring", () => {
    const widest = (chars: number) => numberSize(chars) * 0.5 * chars;
    for (const chars of [6, 7, 9, 10, 12, 14]) expect(widest(chars)).toBeLessThanOrEqual(168);
    expect(numberSize(9)).toBeLessThan(52);
    expect(numberSize(14)).toBeGreaterThanOrEqual(20);
  });
});
