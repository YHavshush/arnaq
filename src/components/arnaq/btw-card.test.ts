import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { messages } from "@/i18n/messages";
import type { BtwSummary } from "@/lib/btw/summary";
import { BtwChip } from "./btw-card";

const quarter = { label: "2026-Q4", from: "2026-10-01", to: "2026-12-31", due: "2027-01-31" };
const base: BtwSummary = {
  quarter,
  received: 96800,
  owed: 16800,
  pocket: 0,
  toSetAside: 16800,
  paid: null,
  fromOwnMoney: 0,
  hasData: true,
};
const html = (btw: BtwSummary, locale: "en" | "nl" = "en") =>
  renderToStaticMarkup(createElement(BtwChip, { btw, t: messages[locale], locale }));

describe("BtwChip", () => {
  it("says in one line what is still to set aside and by when", () => {
    const out = html(base);
    expect(out).toContain("BTW 2026 Q4");
    expect(out).toContain("€168 to set aside");
    expect(out).toContain("31 Jan");
  });
  it("says it is covered when nothing is missing", () => {
    expect(html({ ...base, pocket: 16800, toSetAside: 0 })).toContain("covered");
  });
  it("shows what was paid and when once the quarter is paid", () => {
    const out = html({
      ...base,
      toSetAside: 0,
      paid: { amount: 30000, date: "2026-10-29" },
    });
    expect(out).toContain("€300 paid on 29 Oct");
  });
  it("speaks Dutch too", () => {
    expect(html(base, "nl")).toContain("opzij te zetten");
  });
});
