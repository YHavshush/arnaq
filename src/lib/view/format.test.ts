import { describe, expect, it } from "vitest";
import { formatter } from "./format";

describe("formatter.plain", () => {
  it("whole euros, no currency sign, real minus", () => {
    expect(formatter("nl").plain(315_700)).toBe("3.157");
    expect(formatter("en").plain(-1_234_00)).toBe("−1,234");
    expect(formatter("en").plain(0)).toBe("0");
  });
});

describe("formatter.delta", () => {
  it("whole euros with a real minus sign and no currency sign", () => {
    const f = formatter("en");
    expect(f.delta(4400)).toBe("+44");
    expect(f.delta(-5400)).toBe("−54");
    expect(f.delta(0)).toBe("0");
    expect(f.delta(40)).toBe("0"); // rounds to nothing: no "+0"
    expect(f.delta(-149)).toBe("−1");
  });

  it("uses the locale's thousands separator", () => {
    expect(formatter("nl").delta(123_456_00)).toBe("+123.456");
    expect(formatter("en").delta(-123_456_00)).toBe("−123,456");
  });
});
