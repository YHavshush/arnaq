import { describe, expect, it } from "vitest";
import { euroInputToCents } from "./api";

describe("euroInputToCents", () => {
  it("reads Dutch and plain amounts as integer cents", () => {
    expect(euroInputToCents("12,50")).toBe(1250);
    expect(euroInputToCents("12.5")).toBe(1250);
    expect(euroInputToCents(" € 790 ")).toBe(79000);
    expect(euroInputToCents("0,07")).toBe(7);
  });
  it("rejects anything else", () => {
    for (const bad of ["", "abc", "-5", "1,234", "1.234,50", "12,505", "1e5"])
      expect(euroInputToCents(bad)).toBeNull();
  });
});
