import { describe, expect, it } from "vitest";
import { goalSaved } from "@/lib/btw/pot";
import { potByYear, taxPots } from "./pot";

describe("taxPots: both pots inside the savings account", () => {
  it("covers the BTW first, then the income tax from what is left", () => {
    // Invented: 201.00 saved, 168.00 BTW and 80.00 income tax still to set aside.
    expect(
      taxPots({
        saved: 20100,
        btw: { on: true, toSetAside: 16800 },
        incomeTax: { on: true, toSetAside: 8000 },
      }),
    ).toEqual({
      btw: { pot: 16800, savingsLeft: 3300, short: 0 },
      incomeTax: { pot: 3300, savingsLeft: 0, short: 4700 },
    });
  });

  it("with only the income tax pot on, it takes from all the savings", () => {
    expect(
      taxPots({
        saved: 20100,
        btw: { on: false, toSetAside: 16800 },
        incomeTax: { on: true, toSetAside: 8000 },
      }).incomeTax,
    ).toEqual({ pot: 8000, savingsLeft: 12100, short: 0 });
  });

  it("the goal counts the savings without both pots", () => {
    expect(goalSaved({ saved: 20100, btwPot: 16800, incomeTaxPot: 3300 })).toBe(0);
    expect(goalSaved({ saved: 20100, btwPot: 16800 })).toBe(3300);
  });

  it("shares the pot over the open years, the oldest first", () => {
    const years = [
      { year: 2025, toSetAside: 4000 },
      { year: 2026, toSetAside: 9800 },
    ];
    expect([...potByYear(6000, years)]).toEqual([
      [2025, 4000],
      [2026, 2000],
    ]);
    expect([...potByYear(0, years)]).toEqual([
      [2025, 0],
      [2026, 0],
    ]);
  });
});
