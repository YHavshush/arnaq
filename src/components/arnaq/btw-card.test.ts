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
  renderToStaticMarkup(
    createElement(BtwCard, { btw, client: "Featurn", t: messages[locale], locale }),
  );

describe("BtwCard", () => {
  it("says what is still missing and by when", () => {
    const out = html(base);
    expect(out).toContain("Set aside");
    expect(out).toContain("31 Oct");
    expect(out).toContain("Received from Featurn");
  });
  it("says the pocket covers it, and shows no 'missing' line", () => {
    const out = html({ ...base, pocket: 50000, toSetAside: 0 });
    expect(out).toContain("The pocket covers it");
    expect(out).not.toContain("Still to set aside");
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
  it("speaks Dutch too", () => {
    expect(html(base, "nl")).toContain("Zet nog");
  });
});
