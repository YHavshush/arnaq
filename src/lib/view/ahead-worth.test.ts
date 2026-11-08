import { describe, expect, it } from "vitest";
import { messages } from "@/i18n/messages";
import { btwPot } from "@/lib/btw/pot";
import { aheadWorthParts } from "./net-worth-parts";
import { worthRing } from "./worth-ring";

/** Invented numbers: two accounts, savings, and 168.00 BTW still owed with nothing in a BTW pocket. */
const OWED = 16800;
const world = (saved: number, on: boolean) => ({
  accounts: [
    { accountId: 1, bank: "rabobank", name: "Rabobank NL00", balance: 35700 },
    { accountId: 2, bank: "revolut", name: "Revolut", balance: 20500 },
  ],
  savings: { saved },
  btw: { net: -OWED },
  btwPot: btwPot({ on, saved, toSetAside: OWED }),
});
const en = messages.en.ui.netWorth;
const legend = (saved: number, on: boolean) =>
  worthRing(aheadWorthParts(world(saved, on), en)).legend.map((e) => [
    e.key,
    e.name,
    e.amount,
    e.slot,
    e.text ?? null,
  ]);
const arcs = (saved: number, on: boolean) =>
  worthRing(aheadWorthParts(world(saved, on), en)).segments.map((s) => [s.key, s.slot, s.length]);

describe("aheadWorthParts: the legend and ring on Ahead", () => {
  it("setting off: today's lines, the BTW still owed in its own slot without an arc", () => {
    expect(legend(20100, false)).toEqual([
      ["a1", "Rabobank", 35700, 0, null],
      ["a2", "Revolut", 20500, 1, null],
      ["savings", "Savings", 20100, 2, null],
      ["btw", "BTW still owed", -16800, 3, null],
    ]);
    const total = 35700 + 20500 + 20100;
    expect(arcs(20100, false)).toEqual([
      ["a1", 0, 35700 / total],
      ["a2", 1, 20500 / total],
      ["savings", 2, 20100 / total],
    ]);
  });

  it("pot covers it: savings shows what is left, the pot is a line and an arc in the BTW colour, the BTW is covered", () => {
    expect(legend(20100, true)).toEqual([
      ["a1", "Rabobank", 35700, 0, null],
      ["a2", "Revolut", 20500, 1, null],
      ["savings", "Savings", 3300, 2, null],
      ["btwPot", "BTW pot", 16800, 3, null],
      ["btw", "BTW still owed", 0, 3, "covered by your pot"],
    ]);
    const total = 35700 + 20500 + 20100;
    const ring = arcs(20100, true);
    expect(ring.map(([key, slot]) => [key, slot])).toEqual([
      ["a1", 0],
      ["a2", 1],
      ["savings", 2],
      ["btwPot", 3],
    ]);
    expect(ring[2][2]).toBeCloseTo(3300 / total);
    expect(ring[3][2]).toBeCloseTo(16800 / total);
    // The savings arc shrinks by exactly the pot's arc: the ring adds up to the same gross total.
    expect((ring[2][2] as number) + (ring[3][2] as number)).toBeCloseTo(
      arcs(20100, false)[2][2] as number,
    );
    expect(ring.reduce((s, [, , l]) => s + (l as number), 0)).toBeCloseTo(1);
  });

  it("pot smaller than the BTW: all the savings are the pot, and the line says how much is still short", () => {
    expect(legend(10000, true)).toEqual([
      ["a1", "Rabobank", 35700, 0, null],
      ["a2", "Revolut", 20500, 1, null],
      ["savings", "Savings", 0, 2, null],
      ["btwPot", "BTW pot", 10000, 3, null],
      ["btw", "BTW still short", -6800, 3, null],
    ]);
    expect(arcs(10000, true).map(([key]) => key)).toEqual(["a1", "a2", "btwPot"]);
  });

  it("without savings there is no pot, and everything is as with the setting off", () => {
    expect(legend(0, true)).toEqual(legend(0, false));
    expect(arcs(0, true)).toEqual(arcs(0, false));
    expect(legend(0, true).at(-1)).toEqual(["btw", "BTW still owed", -16800, 2, null]);
  });

  it("the lines that are the person's own money add up to net worth, with the setting on or off", () => {
    // The pot is BTW money: it is shown, but it is owed, so it is not in the sum (the centre of the ring).
    const own = (saved: number, on: boolean) =>
      aheadWorthParts(world(saved, on), en)
        .filter((p) => p.key !== "btwPot")
        .reduce((s, p) => s + p.amount, 0);
    for (const saved of [0, 10000, 20100]) {
      const total = 35700 + 20500 + saved - OWED;
      expect(own(saved, false)).toBe(total);
      expect(own(saved, true)).toBe(total);
    }
  });

  it("has the Dutch words too", () => {
    const nl = messages.nl.ui.netWorth;
    const names = aheadWorthParts(world(20100, true), nl).map((p) => [p.name, p.text ?? null]);
    expect(names.slice(2)).toEqual([
      [nl.savingsName, null],
      ["Btw-pot", null],
      [nl.btwOwed, "gedekt door je pot"],
    ]);
    expect(aheadWorthParts(world(10000, true), nl).at(-1)!.name).toBe("Btw nog tekort");
  });
});
