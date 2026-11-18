import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { messages } from "@/i18n/messages";
import type { IncomeTaxYearSummary } from "@/lib/income-tax/summary";
import { IncomeTaxCard } from "./income-tax-card";

// Invented numbers.
const estimate: IncomeTaxYearSummary = {
  year: 2027,
  rate: 650,
  mode: "estimate",
  base: { received: 400000, expected: 900000 },
  soFar: 26000,
  expected: 84500,
  known: null,
  paid: 0,
  payments: [],
  owed: 26000,
  pocket: 10000,
  toSetAside: 16000,
};
const known: IncomeTaxYearSummary = {
  ...estimate,
  year: 2026,
  rate: 490,
  mode: "known",
  soFar: 33500,
  expected: 33500,
  known: 33500,
  paid: 10000,
  owed: 23500,
  pocket: 23500,
  toSetAside: 0,
};
const html = (year: IncomeTaxYearSummary, locale: "en" | "nl" = "en", pot = 0) =>
  renderToStaticMarkup(createElement(IncomeTaxCard, { year, pot, t: messages[locale], locale }));

describe("IncomeTaxCard", () => {
  it("estimate mode: set aside so far of what the year is expected to come to, the pocket and what is missing", () => {
    const out = html(estimate);
    expect(out).toContain("Set aside so far €260 of €845 expected for 2027");
    expect(out).toContain("Set aside €160 more to keep up.");
    expect(out).toContain("6.5% of client income without BTW");
    expect(out).toContain("In the income tax pocket");
    expect(out).toContain("Still to set aside");
  });

  it("known mode: the tax bill, what was paid and what is still to pay", () => {
    const out = html(known);
    expect(out).toContain("Tax bill for 2026: €335");
    expect(out).toContain("The pocket covers the rest of the tax bill.");
    expect(out).toContain("Paid to the tax office");
    expect(out).toContain("Still to pay");
    expect(out).not.toContain("expected for");
  });

  it("counts the part of the savings that is the income tax pot as set aside", () => {
    const out = html(estimate, "en", 16000);
    expect(out).toContain("Of which in your savings");
    expect(out).toContain("The pocket covers what is owed so far.");
    // The pot never fills more than the gap.
    expect(html(estimate, "en", 99999)).toBe(out);
  });

  it("speaks Dutch with a comma in the rate", () => {
    const out = html(estimate, "nl");
    expect(out).toContain("Tot nu toe opzij gezet");
    expect(out).toContain("6,5%");
    expect(html(known, "nl")).toContain("Aanslag over 2026");
  });
});
