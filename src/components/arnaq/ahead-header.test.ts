import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AheadHeader } from "./ahead-header";
import { Ring } from "./ring";

describe("AheadHeader", () => {
  const html = (pill?: { text: string; good: boolean }) =>
    renderToStaticMarkup(
      createElement(AheadHeader, {
        label: "net worth by Apr",
        amount: "€3,480",
        pill,
        sentence: [{ text: "You keep " }, { text: "growing", emphasis: true }] as never,
        detail: "A line that explains it.",
      }),
    );
  it("shows what the number is, the number, the pill and the sentence, and no ring", () => {
    const out = html({ text: "+€1,170 over 6 months", good: true });
    expect(out).toContain("net worth by Apr");
    expect(out).toContain("€3,480");
    expect(out).toContain("+€1,170 over 6 months");
    expect(out).toContain("text-good");
    expect(out).toContain("A line that explains it.");
    expect(out).not.toContain("<svg");
  });
  it("a falling number gets the bad tone, and no pill when there is nothing honest to say", () => {
    expect(html({ text: "−€1,759 over 6 months", good: false })).toContain("text-bad");
    expect(html()).not.toContain("rounded-full");
  });
});

describe("Ring with a lighter arc ahead", () => {
  const out = (value: number, ahead?: number) =>
    renderToStaticMarkup(createElement(Ring, { value, ahead, tone: "good", label: "x" }));
  it("draws the lighter arc after the solid one, and never past a full circle", () => {
    const two = out(0.2, 0.35);
    expect(two).toContain('stroke-dasharray="35 100"');
    expect(two).toContain('stroke-dashoffset="-20"');
    expect(two).toContain('opacity="0.38"');
    // 0.8 solid + 0.5 ahead is cut at the end of the circle.
    expect(out(0.8, 0.5)).toMatch(
      /stroke-dasharray="(19\.99|20)[0-9]* 100" stroke-dashoffset="-80"/,
    );
  });
  it("draws no lighter arc without one", () => {
    expect(out(0.4)).not.toContain("stroke-dashoffset");
  });
});
