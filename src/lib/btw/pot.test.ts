import { describe, expect, it } from "vitest";
import { btwPot } from "./pot";

describe("btwPot: the BTW pot inside the savings account", () => {
  it("covers all that is still to set aside when the savings are enough", () => {
    expect(btwPot({ on: true, saved: 20100, toSetAside: 16800 })).toEqual({
      pot: 16800,
      savingsLeft: 3300,
      short: 0,
    });
  });

  it("takes all the savings and says how much is still short when they are not enough", () => {
    expect(btwPot({ on: true, saved: 10000, toSetAside: 16800 })).toEqual({
      pot: 10000,
      savingsLeft: 0,
      short: 6800,
    });
  });

  it("is empty without savings, and never negative when the savings are below zero", () => {
    expect(btwPot({ on: true, saved: 0, toSetAside: 16800 })).toEqual({
      pot: 0,
      savingsLeft: 0,
      short: 16800,
    });
    expect(btwPot({ on: true, saved: -500, toSetAside: 16800 })).toEqual({
      pot: 0,
      savingsLeft: -500,
      short: 16800,
    });
  });

  it("is empty when nothing is left to set aside (the pocket covers it, or the quarter is paid)", () => {
    expect(btwPot({ on: true, saved: 20100, toSetAside: 0 })).toEqual({
      pot: 0,
      savingsLeft: 20100,
      short: 0,
    });
  });

  it("is empty with the setting off: the savings stay whole", () => {
    expect(btwPot({ on: false, saved: 20100, toSetAside: 16800 })).toEqual({
      pot: 0,
      savingsLeft: 20100,
      short: 16800,
    });
  });

  it("never takes more than the savings nor more than what is to set aside", () => {
    for (const saved of [-100, 0, 1, 5000, 16800, 16801, 99999])
      for (const toSetAside of [0, 1, 16800, 50000]) {
        const { pot, savingsLeft, short } = btwPot({ on: true, saved, toSetAside });
        expect(pot).toBeGreaterThanOrEqual(0);
        expect(pot).toBeLessThanOrEqual(Math.max(saved, 0));
        expect(pot).toBeLessThanOrEqual(toSetAside);
        expect(savingsLeft + pot).toBe(saved);
        expect(short + pot).toBe(toSetAside);
      }
  });
});
