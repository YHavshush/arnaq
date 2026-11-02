import { describe, expect, it } from "vitest";
import { formatter } from "./format";
import { countText, parseCount } from "./count-up";

const NBSP = " ";

describe("counting a formatted amount up", () => {
  it("finds the number inside the text, whatever surrounds it", () => {
    expect(parseCount("€13,751", "en")).toMatchObject({
      before: "€",
      after: "",
      target: 13751,
      decimals: 0,
    });
    expect(parseCount("−€1,177", "en")).toMatchObject({ before: "−€", target: 1177 });
    expect(parseCount("+ €801", "en")).toMatchObject({ before: "+ €", target: 801 });
    expect(parseCount("€481.45", "en")).toMatchObject({ target: 481.45, decimals: 2 });
    expect(parseCount(`€${NBSP}13.751`, "nl")).toMatchObject({ before: `€${NBSP}`, target: 13751 });
    expect(parseCount(`€${NBSP}481,45`, "nl")).toMatchObject({ target: 481.45, decimals: 2 });
  });

  it("has nothing to count in text without a number", () => {
    expect(parseCount("nothing yet", "en")).toBeNull();
    expect(parseCount("", "en")).toBeNull();
  });

  it("ends on exactly the text the app printed, in both languages, for every kind of amount", () => {
    for (const locale of ["en", "nl"] as const) {
      const f = formatter(locale);
      for (const cents of [0, 5, 99, 80100, -706400, 137510000, 4814500, -12345]) {
        for (const text of [
          f.euro(cents),
          f.euroSigned(cents),
          f.euroExact(cents),
          f.plain(cents),
        ]) {
          const t = parseCount(text, locale);
          expect(t, text).not.toBeNull();
          expect(countText(t!, 1, locale), text).toBe(text);
        }
      }
    }
  });

  it("starts at zero, keeps the sign and symbol, and climbs", () => {
    const t = parseCount("−€7,074", "en")!;
    expect(countText(t, 0, "en")).toBe("−€0");
    expect(countText(t, 0.5, "en")).toBe("−€3,537");
    const e = parseCount(`€${NBSP}1.234,50`, "nl")!;
    expect(countText(e, 0, "nl")).toBe(`€${NBSP}0,00`);
    expect(countText(e, 0.5, "nl")).toBe(`€${NBSP}617,25`);
  });
});
