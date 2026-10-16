import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, LOCALES, toLocale } from "./config";
import { messages } from "./messages";
import { categoryLabel } from "@/lib/view/categories";
import { formatter } from "@/lib/view/format";

type Tree = { [k: string]: unknown };

/** Every path in a catalog, with whether it is a function (and how many arguments it takes). */
function shape(node: unknown, prefix = ""): string[] {
  if (typeof node === "function") return [`${prefix}()${node.length}`];
  if (node && typeof node === "object")
    return Object.entries(node as Tree).flatMap(([k, v]) =>
      shape(v, prefix ? `${prefix}.${k}` : k),
    );
  return [prefix];
}

describe("catalogs", () => {
  it("English is the default and Dutch the second language", () => {
    expect(DEFAULT_LOCALE).toBe("en");
    expect(LOCALES).toEqual(["en", "nl"]);
    expect(toLocale(undefined)).toBe("en");
    expect(toLocale("fr")).toBe("en");
    expect(toLocale("nl")).toBe("nl");
  });

  it("Dutch has exactly the keys and the function arguments English has", () => {
    expect(shape(messages.nl).sort()).toEqual(shape(messages.en).sort());
  });

  it("no text is empty and every function returns text for sample arguments", () => {
    const sample = (n: number) => Array.from({ length: n }, (_, i) => (i === 0 ? 3 : "x"));
    function walk(node: unknown, path: string) {
      if (typeof node === "string") expect(node.trim(), path).not.toBe("");
      else if (typeof node === "function") {
        const out = (node as (...a: unknown[]) => unknown)(...sample(node.length));
        if (typeof out === "string") expect(out.trim(), path).not.toBe("");
        else expect(Array.isArray(out) && out.length > 0, path).toBe(true);
      } else if (node && typeof node === "object")
        for (const [k, v] of Object.entries(node as Tree)) walk(v, `${path}.${k}`);
    }
    for (const locale of LOCALES) walk(messages[locale], locale);
  });
});

describe("formatting follows the language", () => {
  const en = formatter("en");
  const nl = formatter("nl");

  it("euros: English 1,234 and Dutch 1.234; cents round half away from zero", () => {
    expect(en.euro(123456)).toBe("€1,235");
    expect(nl.euro(123456)).toBe("€ 1.235");
    expect(en.euro(-50)).toBe("−€1"); // a real minus sign, like everywhere else
    expect(en.euro(49)).toBe("€0");
    expect(en.euroExact(123456)).toBe("€1,234.56");
    expect(nl.euroExact(123456)).toBe("€ 1.234,56");
  });

  it("signed amounts and zero", () => {
    expect(en.euroSigned(5000)).toBe("+ €50");
    expect(en.euroSigned(-5000)).toBe("− €50");
    expect(en.euroSigned(0)).toBe("€0");
  });

  it("months and days", () => {
    expect(en.monthName("2026-10")).toBe("October 2026");
    expect(nl.monthName("2026-10")).toBe("oktober 2026");
    expect(en.monthShort("2026-10")).toBe("Oct");
    expect(nl.monthShort("2026-10")).toBe("okt");
    expect(en.dayLabel("2026-10-25")).toBe("25 Oct");
    expect(nl.dayLabel("2026-03-05")).toBe("5 mrt");
  });
});

describe("categoryLabel", () => {
  it("shows English names for the default categories, Dutch as stored, and user categories as typed", () => {
    expect(categoryLabel("Boodschappen", "en")).toBe("Groceries");
    expect(categoryLabel("Boodschappen", "nl")).toBe("Boodschappen");
    expect(categoryLabel("Mijn eigen potje", "en")).toBe("Mijn eigen potje");
  });
});
