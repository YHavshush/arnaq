import { describe, expect, it } from "vitest";
import { parseAmountToCents } from "./money";

describe("parseAmountToCents", () => {
  it("parses Dutch notation", () => {
    expect(parseAmountToCents("-12,50", ",")).toBe(-1250);
    expect(parseAmountToCents("+1.234,56", ",")).toBe(123456);
    expect(parseAmountToCents("0,05", ",")).toBe(5);
    expect(parseAmountToCents("7", ",")).toBe(700);
    expect(parseAmountToCents("1,5", ",")).toBe(150);
  });
  it("parses dot-decimal notation", () => {
    expect(parseAmountToCents("-12.50", ".")).toBe(-1250);
    expect(parseAmountToCents("1,234.56", ".")).toBe(123456);
  });
  it("never goes through floats (0.07 and 19.99 stay exact)", () => {
    expect(parseAmountToCents("0.07", ".")).toBe(7);
    expect(parseAmountToCents("19.99", ".")).toBe(1999);
  });
  it("rejects garbage", () => {
    expect(() => parseAmountToCents("", ",")).toThrow();
    expect(() => parseAmountToCents("abc", ",")).toThrow();
    expect(() => parseAmountToCents("1,234", ",")).toThrow();
  });
});
