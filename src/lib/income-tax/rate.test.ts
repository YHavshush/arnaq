import { describe, expect, it } from "vitest";
import { formatRatePercent, incomeTaxOf, isIncomeTaxRate, parseRatePercent } from "./rate";

describe("the income tax rate", () => {
  it("reads a percent typed with a comma or a point, in basis points", () => {
    expect(parseRatePercent("4,9")).toBe(490);
    expect(parseRatePercent("4.9")).toBe(490);
    expect(parseRatePercent(" 6,5 ")).toBe(650);
    expect(parseRatePercent("6")).toBe(600);
    expect(parseRatePercent("4,25")).toBe(425);
    expect(parseRatePercent("0")).toBe(0);
    for (const bad of ["", "abc", "4,9%", "-1", "4,999", "4,", "1.000,5"])
      expect(parseRatePercent(bad), bad).toBeNull();
  });

  it("shows a rate with the locale's decimal sign and no trailing zeros", () => {
    expect(formatRatePercent(490, "en")).toBe("4.9");
    expect(formatRatePercent(490, "nl")).toBe("4,9");
    expect(formatRatePercent(425, "nl")).toBe("4,25");
    expect(formatRatePercent(600, "en")).toBe("6");
    expect(formatRatePercent(0, "en")).toBe("0");
  });

  it("accepts 0 to 60% only, as whole basis points", () => {
    expect(isIncomeTaxRate(0)).toBe(true);
    expect(isIncomeTaxRate(6000)).toBe(true);
    for (const bad of [-1, 6001, 4.9, "490", null]) expect(isIncomeTaxRate(bad)).toBe(false);
  });

  it("applies the rate in whole cents", () => {
    // Invented: 123.45 at 4.9% is 6.04905, so 6.05.
    expect(incomeTaxOf(12345, 490)).toBe(605);
    expect(incomeTaxOf(100000, 490)).toBe(4900);
    expect(incomeTaxOf(100000, 0)).toBe(0);
    expect(incomeTaxOf(0, 490)).toBe(0);
    expect(incomeTaxOf(-5000, 490)).toBe(0);
  });
});
