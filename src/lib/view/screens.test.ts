import { describe, expect, it } from "vitest";
import type { Forecast, ForecastMonth } from "@/lib/forecast/forecast";
import type { OccurrenceView } from "@/lib/recurring/occurrences";
import { buildPrognose } from "./prognose";
import { buildVasteLasten } from "./vaste-lasten";

const fm = (month: string, kind: ForecastMonth["kind"], net: number, cumulativeNet: number) =>
  ({
    month,
    kind,
    net,
    cumulativeNet,
    income: Math.max(net, 0),
    expenses: Math.max(-net, 0),
  }) as ForecastMonth;

const forecast = (months: ForecastMonth[], lowConfidence = false): Forecast =>
  ({
    today: "2026-10-11",
    currentMonth: "2026-10",
    settings: { months: 3, history: 3, pastMonths: 1 },
    variableBasis: {
      months: [],
      history: 3,
      lowConfidence,
      reason: lowConfidence ? "Maar 1 maand data." : null,
    },
    missed: [],
    months,
  }) as Forecast;

describe("buildPrognose", () => {
  it("ring = share of months ahead that end in the plus; centre = growth; sentence names tightest and best", () => {
    const p = buildPrognose(
      forecast([
        fm("2026-09", "actual", 5000, 5000),
        fm("2026-10", "mixed", 20000, 25000),
        fm("2026-11", "forecast", -10000, 15000),
        fm("2026-12", "forecast", 40000, 55000),
      ]),
    );
    expect(p.ahead).toBe(3); // the past month is context, not forecast
    expect(p.inThePlus).toBe(2);
    expect(p.share).toBeCloseTo(2 / 3);
    expect(p.growth).toBe(50000);
    expect(p.tone).toBe("warn");
    const text = p.sentence.map((s) => s.text).join("");
    expect(text).toMatch(/krapste maand is november 2026/);
    expect(text).toMatch(/beste december 2026/);
    expect(p.points.map((x) => x.projected)).toEqual([false, true, true, true]);
  });

  it("all plus is good; negative growth is bad; nothing to forecast is neutral", () => {
    expect(buildPrognose(forecast([fm("2026-10", "mixed", 100, 100)])).tone).toBe("good");
    expect(
      buildPrognose(
        forecast([fm("2026-10", "mixed", -500, -500), fm("2026-11", "forecast", -100, -600)]),
      ).tone,
    ).toBe("bad");
    const none = buildPrognose(forecast([fm("2026-09", "actual", 1, 1)]));
    expect([none.hasForecast, none.tone]).toEqual([false, "accent"]);
  });

  it("passes the low-confidence reason through", () => {
    expect(buildPrognose(forecast([fm("2026-10", "mixed", 1, 1)], true)).lowConfidence).toBe(
      "Maar 1 maand data.",
    );
  });
});

const occ = (
  id: number,
  name: string,
  status: OccurrenceView["status"],
  amount: number,
  date: string,
  type: "expense" | "income" = "expense",
): OccurrenceView => ({
  id,
  recurringItemId: id,
  itemName: name,
  type,
  categoryId: null,
  month: "2026-10",
  expectedDate: date,
  expectedAmount: amount,
  status,
  transactionId: null,
  actualAmount: status === "matched" ? amount : null,
  actualDate: status === "matched" ? date : null,
  amount,
});

describe("buildVasteLasten", () => {
  it("counts paid expenses, lists what is still to come and names the next one", () => {
    const v = buildVasteLasten([
      occ(1, "Huur", "matched", 90000, "2026-10-01"),
      occ(2, "Spotify", "expected", 1099, "2026-10-25"),
      occ(3, "Internet", "expected", 3500, "2026-10-18"),
      occ(4, "Salaris", "expected", 150000, "2026-10-27", "income"),
    ]);
    expect([v.paid, v.total]).toEqual([1, 3]);
    expect(v.share).toBeCloseTo(1 / 3);
    expect(v.toCome).toBe(4599);
    expect(v.sentence.map((s) => s.text).join("")).toMatch(/eerstvolgende is Internet op 18 okt/);
    expect(v.expenses.map((r) => r.label)).toEqual(["betaald 1 okt", "komt 18 okt", "komt 25 okt"]);
    expect(v.income).toHaveLength(1);
  });

  it("everything paid, and nothing set up", () => {
    expect(
      buildVasteLasten([occ(1, "Huur", "matched", 90000, "2026-10-01")]).sentence[1].text,
    ).toBe("betaald");
    const empty = buildVasteLasten([]);
    expect([empty.total, empty.share]).toEqual([0, 0]);
  });

  it("a missed payment still counts as open money", () => {
    const v = buildVasteLasten([occ(1, "Gym", "missed", 3000, "2026-10-03")]);
    expect([v.paid, v.toCome]).toEqual([0, 3000]);
    expect(v.expenses[0].label).toBe("gemist, verwacht 3 okt");
  });
});
