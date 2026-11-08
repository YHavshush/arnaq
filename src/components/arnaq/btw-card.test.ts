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
  receipts: { from: "2026-07-01", to: "2026-09-30" },
  complete: true,
};
/** The fourth quarter with a one-month payment lag, on 20 November: money arriving until 31 January still counts. */
const soFar: BtwSummary = {
  ...base,
  quarter: { label: "2026-Q4", from: "2026-10-01", to: "2026-12-31", due: "2027-01-31" },
  receipts: { from: "2026-11-01", to: "2027-01-31" },
  complete: false,
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
  it("while the quarter's money is still arriving, says it is what is set aside so far, not the whole quarter", () => {
    const out = html(soFar);
    expect(out).toContain("Set aside €120 more for what has arrived so far.");
    expect(out).toContain("Money arriving until 31 Jan still counts; pay by 31 Jan.");
    expect(out).toContain("€300 of €420 so far");
    const covered = html({ ...soFar, pocket: 50000, toSetAside: 0 });
    expect(covered).toContain("The pocket covers what has arrived so far.");
    expect(covered).not.toContain("The pocket covers it.");
    expect(html(soFar, "nl")).toContain("tot nu toe");
  });
  it("once paid, the payment is what counts, money still arriving or not", () => {
    const out = html({ ...soFar, paid: { amount: 42000, date: "2027-01-20" }, toSetAside: 0 });
    expect(out).toContain("Paid on 20 Jan");
    expect(out).not.toContain("so far");
  });
});
