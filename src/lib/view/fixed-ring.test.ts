import { describe, expect, it } from "vitest";
import { OTHER_SLOT, splitRing, type RingItem } from "./fixed-ring";

let nextId = 1;
const item = (name: string, amount: number, paid = false): RingItem => ({
  id: nextId++,
  name,
  amount,
  paid,
});

const covered = (m: ReturnType<typeof splitRing>) => m.segments.reduce((s, x) => s + x.length, 0);

describe("splitRing", () => {
  it("draws the largest item first and shows paid solid and to-pay light", () => {
    const m = splitRing(
      [item("Health", 15100), item("Rent", 48145, true), item("Claude", 2178)],
      146800,
    );
    expect(m.mode).toBe("normal");
    expect(m.legend.map((l) => l.name)).toEqual(["Rent", "Health", "Claude"]);
    expect(m.segments.map((s) => [s.slot, s.paid])).toEqual([
      [0, true],
      [1, false],
      [2, false],
    ]);
    // The circle is the income: the rent takes its share of 1468.
    expect(m.segments[0].start).toBe(0);
    expect(m.segments[0].length).toBeCloseTo(48145 / 146800, 10);
    // Arcs touch end to start, nothing overlaps.
    expect(m.segments[1].start).toBeCloseTo(m.segments[0].end, 12);
    expect(m.fixed).toBe(65423);
    expect(m.leftOver).toBe(146800 - 65423);
    expect(covered(m)).toBeCloseTo(65423 / 146800, 10);
  });

  it("marks a legend entry paid only when everything behind it is paid", () => {
    const m = splitRing([item("Rent", 1000, true), item("Gym", 500)], 5000);
    expect(m.legend.map((l) => [l.name, l.paid])).toEqual([
      ["Rent", true],
      ["Gym", false],
    ]);
  });

  it("groups everything beyond the four largest items into one Other arc", () => {
    const items = [
      item("A", 5000),
      item("B", 4000),
      item("C", 3000),
      item("D", 2000),
      item("E", 1000, true),
      item("F", 500),
      item("G", 250, true),
    ];
    const m = splitRing(items, 40000);
    expect(m.legend.map((l) => l.name)).toEqual(["A", "B", "C", "D", null]);
    const other = m.legend[4];
    expect(other.slot).toBe(OTHER_SLOT);
    expect(other.amount).toBe(1750);
    expect(other.paid).toBe(false); // F is still to pay
    // Other is drawn as its paid part (solid) and its to-pay part (light), in that order.
    const parts = m.segments.filter((s) => s.key === "other");
    expect(parts.map((s) => s.paid)).toEqual([true, false]);
    expect(parts[0].length).toBeCloseTo(1250 / 40000, 12);
    expect(parts[1].length).toBeCloseTo(500 / 40000, 12);
    expect(m.fixed).toBe(15750);
  });

  it("does not group when there are four items or fewer", () => {
    const m = splitRing([item("A", 100), item("B", 200), item("C", 300), item("D", 400)], 10000);
    expect(m.legend.every((l) => l.name !== null)).toBe(true);
    expect(m.segments).toHaveLength(4);
  });

  it("clips items beyond the income: never more than a full circle, the shortfall is the centre", () => {
    const m = splitRing([item("Rent", 90000), item("Health", 40000), item("Gym", 30000)], 100000);
    expect(m.mode).toBe("short");
    expect(m.leftOver).toBe(-60000);
    expect(m.fixed).toBe(160000);
    // Rent fills 90%, Health is cut at the end of the circle, Gym is clipped away completely.
    expect(m.segments.map((s) => s.key)).toHaveLength(2);
    expect(m.segments[1].end).toBe(1);
    expect(m.segments[1].length).toBeCloseTo(0.1, 12);
    for (const s of m.segments) {
      expect(s.start).toBeGreaterThanOrEqual(0);
      expect(s.end).toBeLessThanOrEqual(1);
    }
    expect(covered(m)).toBeLessThanOrEqual(1 + 1e-12);
    // The legend still lists every item, so nothing disappears from the explanation.
    expect(m.legend.map((l) => l.name)).toEqual(["Rent", "Health", "Gym"]);
  });

  it("an exact fit is normal, not short, and fills the circle", () => {
    const m = splitRing([item("Rent", 60000), item("Gym", 40000)], 100000);
    expect(m.mode).toBe("normal");
    expect(m.leftOver).toBe(0);
    expect(m.segments[m.segments.length - 1].end).toBe(1);
  });

  it("with no income the arcs fill the circle on their own", () => {
    const m = splitRing([item("Rent", 75000, true), item("Gym", 25000)], 0);
    expect(m.mode).toBe("noIncome");
    expect(m.income).toBe(0);
    expect(m.fixed).toBe(100000);
    expect(m.segments.map((s) => s.length)).toEqual([0.75, 0.25]);
    expect(m.segments[1].end).toBe(1);
  });

  it("treats a negative income as unknown", () => {
    expect(splitRing([item("Rent", 1000)], -5).mode).toBe("noIncome");
  });

  it("income but nothing fixed leaves the whole circle empty", () => {
    const m = splitRing([], 50000);
    expect(m.mode).toBe("normal");
    expect(m.segments).toEqual([]);
    expect(m.leftOver).toBe(50000);
  });

  it("nothing at all is empty, and zero amounts are ignored", () => {
    expect(splitRing([], 0).mode).toBe("empty");
    const m = splitRing([item("Free", 0)], 0);
    expect(m.mode).toBe("empty");
    expect(m.legend).toEqual([]);
  });

  it("is stable for equal amounts (by name)", () => {
    const m = splitRing([item("Zeta", 100), item("Alpha", 100)], 1000);
    expect(m.legend.map((l) => l.name)).toEqual(["Alpha", "Zeta"]);
  });

  it("never covers more than one in total, whatever the numbers", () => {
    for (let n = 1; n <= 9; n++) {
      const items = Array.from({ length: n }, (_, i) => item(`I${i}`, 333 + i * 41, i % 2 === 0));
      for (const income of [0, 1, 500, 2000, 10_000_000]) {
        const m = splitRing(items, income);
        expect(Math.max(0, ...m.segments.map((s) => s.end))).toBeLessThanOrEqual(1);
        expect(covered(m)).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });
});
