import { describe, expect, it } from "vitest";
import { netWorthParts } from "./net-worth-parts";

describe("netWorthParts", () => {
  it("names the banks, adds the savings, and the shares add up to one", () => {
    const parts = netWorthParts(
      {
        accounts: [
          { accountId: 1, bank: "rabobank", name: "Rabobank NL00", balance: 150000 },
          { accountId: 2, bank: "revolut", name: "Revolut", balance: 50000 },
        ],
        savings: { saved: 20000 },
      },
      "Savings",
    );
    expect(parts.map((p) => p.name)).toEqual(["Rabobank", "Revolut", "Savings"]);
    expect(parts.reduce((s, p) => s + p.share, 0)).toBeCloseTo(1);
    expect(parts[0].share).toBeCloseTo(150 / 220);
  });

  it("an account in the red keeps its amount but has no width, and no savings means no savings part", () => {
    const parts = netWorthParts(
      {
        accounts: [
          { accountId: 1, bank: "rabobank", name: "R", balance: -5000 },
          { accountId: 2, bank: "revolut", name: "V", balance: 10000 },
        ],
        savings: { saved: 0 },
      },
      "Savings",
    );
    expect(parts.map((p) => [p.name, p.amount, p.share])).toEqual([
      ["Rabobank", -5000, 0],
      ["Revolut", 10000, 1],
    ]);
  });
});
