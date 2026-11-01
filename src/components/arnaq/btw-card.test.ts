import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { messages } from "@/i18n/messages";
import type { BtwSummary } from "@/lib/btw/summary";
import { BtwCard } from "./btw-card";

const quarter = { label: "2026-Q3", from: "2026-07-01", to: "2026-09-30", due: "2026-10-31" };
const base: BtwSummary = {
  quarter,
  received: 200000,
  owed: 42000,
  pocket: 30000,
  toSetAside: 12000,
  paid: null,
  fromOwnMoney: 0,
  hasData: true,
};
const html = (btw: BtwSummary, locale: "en" | "nl" = "en") =>
  renderToStaticMarkup(createElement(BtwCard, { btw, t: messages[locale], locale }));

describe("BtwCard", () => {
  it("says what is still missing and by when", () => {
    const out = html(base);
    expect(out).toContain("Set aside");
    expect(out).toContain("31 Oct");
    expect(out).toContain("€3,000 of €4,200".replace("€3,000", "€300").replace("€4,200", "€420"));
  });
  it("says the pocket covers it, and shows no 'missing' line", () => {
    const out = html({ ...base, pocket: 50000, toSetAside: 0 });
    expect(out).toContain("The pocket covers it");
    expect(out).not.toContain("Set aside €");
  });
  it("shows the payment, own money and what is left once paid", () => {
    const out = html({
      ...base,
      pocket: 5000,
      toSetAside: 0,
      paid: { amount: 42000, date: "2026-10-06" },
      fromOwnMoney: 17000,
    });
    expect(out).toContain("Paid on 6 Oct");
    expect(out).toContain("Of which your own money");
    expect(out).toContain("Left over after paying");
  });
  it("once paid, the amount paid counts and the estimate is only mentioned", () => {
    const out = html({
      ...base,
      received: 137300,
      owed: 23834,
      pocket: 0,
      toSetAside: 0,
      paid: { amount: 30000, date: "2026-10-29" },
      fromOwnMoney: 30000,
    });
    expect(out).toContain("€300 paid");
    expect(out).not.toContain("estimated");
    expect(out).not.toContain("€0 of €238");
  });
  it("speaks Dutch too", () => {
    expect(html(base, "nl")).toContain("Zet nog");
  });
});
