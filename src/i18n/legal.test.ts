import { describe, expect, it } from "vitest";
import { messages } from "./messages";

/** Every piece of text in a document, one string each (not the JSON around it). */
function strings(node: unknown): string[] {
  if (typeof node === "string") return [node];
  if (Array.isArray(node)) return node.flatMap(strings);
  if (node && typeof node === "object") return Object.values(node).flatMap(strings);
  return [];
}

describe("the privacy notice and the terms", () => {
  for (const locale of ["en", "nl"] as const) {
    const { privacy, terms } = messages[locale].legal;
    const text = strings([privacy, terms]).join("\n");

    it(`${locale}: has no blanks or brackets left to fill in`, () => {
      expect(text).not.toMatch(/\[[^\]]*\]|TODO|\.\.\.|lorem/i);
    });
    it(`${locale}: names who is responsible and how to reach them`, () => {
      expect(text).toContain("Yonathan Havshush");
      expect(text).toContain("Uilenstede 207");
      expect(text).toContain("yonathanhav@gmail.com");
    });
    it(`${locale}: every table row has a cell for every column`, () => {
      for (const sec of privacy.sections)
        if (sec.table)
          for (const row of sec.table.rows) expect(row).toHaveLength(sec.table.head.length);
    });
    it(`${locale}: says arnaq in lower case, never Arnaq`, () => {
      expect(text).not.toMatch(/\bArnaq\b|\bARNAQ\b/);
    });
  }

  it("names Enable Banking as the bank connection provider", () => {
    for (const locale of ["en", "nl"] as const)
      expect(strings(messages[locale].legal.privacy).join("\n")).toContain("Enable Banking");
  });
});
