import { describe, expect, it } from "vitest";
import { buildFixedFlow } from "./fixed-flow";

const row = (type: "expense" | "income", date: string, amount: number, status = "expected") =>
  ({ type, date, amount, status, name: `${type} ${amount}` }) as Parameters<
    typeof buildFixedFlow
  >[0]["rows"][number];

describe("buildFixedFlow", () => {
  it("runs the balance day by day from the opening balance and finds the lowest point", () => {
    const f = buildFixedFlow({
      month: "2026-11",
      opening: 50000,
      rows: [
        row("expense", "2026-11-01", 48145),
        row("expense", "2026-11-01", 15100),
        row("income", "2026-11-04", 96800),
        row("income", "2026-11-05", 50000),
        row("expense", "2026-11-20", 2178),
      ],
    });
    expect(f.days).toBe(30);
    expect(f.start).toBe(50000);
    expect(f.startKnown).toBe(true);
    expect(f.lowest).toEqual({ day: 1, balance: 50000 - 48145 - 15100 });
    expect(f.events.map((e) => [e.day, e.amount, e.balance])).toEqual([
      [1, -63245, -13245],
      [4, 96800, 83555],
      [5, 50000, 133555],
      [20, -2178, 131377],
    ]);
    expect(f.series[0]).toBe(-13245);
    expect(f.series[3]).toBe(83555);
    expect(f.series[29]).toBe(131377);
    expect(f.end).toBe(131377);
  });

  it("takes costs before income on the same day, so the dip is the careful one", () => {
    const f = buildFixedFlow({
      month: "2026-11",
      opening: 1000,
      rows: [row("income", "2026-11-03", 5000), row("expense", "2026-11-03", 4000)],
    });
    expect(f.lowest).toEqual({ day: 3, balance: -3000 });
    expect(f.end).toBe(2000);
  });

  it("starts from zero when no balance is known, leaves out missed items and other months", () => {
    const f = buildFixedFlow({
      month: "2026-02",
      opening: null,
      rows: [
        row("expense", "2026-02-10", 1000, "missed"),
        row("expense", "2026-03-01", 2000),
        row("income", "2026-02-28", 3000),
      ],
    });
    expect(f.startKnown).toBe(false);
    expect(f.days).toBe(28);
    expect(f.events.map((e) => e.day)).toEqual([28]);
    expect(f.lowest).toEqual({ day: 1, balance: 0 });
    expect(f.end).toBe(3000);
  });
});
