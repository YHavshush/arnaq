import { describe, expect, it } from "vitest";
import { worthRing } from "./worth-ring";

const part = (key: string, name: string, amount: number, positive = 76300) => ({
  key,
  name,
  amount,
  share: amount > 0 ? amount / positive : 0,
});

describe("worthRing: net worth as arcs, one per account", () => {
  const parts = [
    part("a1", "Rabobank", 35700),
    part("a2", "Revolut", 20500),
    part("savings", "Savings", 20100),
  ];

  it("gives each part with money an arc as long as its share, in order from twelve o'clock, filling the circle", () => {
    const { segments } = worthRing(parts);
    expect(segments.map((s) => [s.key, s.slot])).toEqual([
      ["a1", 0],
      ["a2", 1],
      ["savings", 2],
    ]);
    expect(segments[0].start).toBe(0);
    expect(segments[0].length).toBeCloseTo(357 / 763);
    for (let i = 1; i < segments.length; i++)
      expect(segments[i].start).toBeCloseTo(segments[i - 1].end);
    expect(segments.at(-1)!.end).toBeCloseTo(1);
    expect(segments.every((s) => s.paid)).toBe(true);
  });

  it("lists every part in the legend, and a part without money (an account in the red, the BTW owed) has no arc", () => {
    const withMinus = [
      ...parts,
      { key: "btw", name: "BTW still owed", amount: -16800, share: 0 },
      part("a3", "Old", -500),
    ];
    const { segments, legend } = worthRing(withMinus);
    expect(segments).toHaveLength(3);
    expect(legend.map((l) => [l.key, l.amount])).toEqual([
      ["a1", 35700],
      ["a2", 20500],
      ["savings", 20100],
      ["btw", -16800],
      ["a3", -500],
    ]);
    // The legend dot of a part with no arc is the colour of its slot all the same.
    expect(legend.find((l) => l.key === "btw")!.slot).toBe(3);
  });

  it("has nothing to draw without parts, or with no money in any of them", () => {
    expect(worthRing([]).segments).toEqual([]);
    expect(worthRing([part("a1", "Rabobank", -100)]).segments).toEqual([]);
  });
});
