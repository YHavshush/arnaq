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
    setAside: { actual: 0, planned: 0, total: 0, reserve: 0 },
    cumulativeSetAside: 0,
    cumulativeReserve: 0,
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
    openingBalance: null,
    openingSavings: null,
    months,
  }) as unknown as Forecast;

describe("buildPrognose with the bank's balances", () => {
  it("the totals become the real balance, starting from the opening balance", () => {
    const months = [
      fm("2026-09", "actual", 5000, 5000),
      fm("2026-10", "mixed", 20000, 25000),
      fm("2026-11", "forecast", -10000, 15000),
    ];
    const without = buildPrognose(forecast(months), "en");
    const withBalance = buildPrognose({ ...forecast(months), openingBalance: 250000 }, "en");
    expect(without.hasBalance).toBe(false);
    expect(without.points.map((p) => p.cumulative)).toEqual([5000, 25000, 15000]);
    expect(withBalance.hasBalance).toBe(true);
    expect(withBalance.points.map((p) => p.cumulative)).toEqual([255000, 275000, 265000]);
    expect(withBalance.notes.some((n) => /Net worth adds up/.test(n))).toBe(true);
    // Growth (the ring, the sentence) does not depend on the opening balance.
    expect(withBalance.growth).toBe(without.growth);
  });
});

describe("buildPrognose: net worth in the header", () => {
  const months = [
    fm("2026-09", "actual", 5000, 5000),
    fm("2026-10", "mixed", 20000, 25000),
    fm("2026-11", "forecast", 10000, 35000),
  ];
  it("gives the net worth where the real months end and where the forecast ends", () => {
    const p = buildPrognose({ ...forecast(months), openingBalance: 250000 }, "en");
    expect(p.netWorth).toEqual({ start: 255000, end: 285000 });
    expect(p.detail).toContain("€2,550");
    expect(p.detail).toContain("€2,850");
  });
  it("is null (and the detail is the plain growth one) without any balance", () => {
    const p = buildPrognose(forecast(months), "en");
    expect(p.netWorth).toBeNull();
    expect(p.detail).not.toContain("Net worth");
  });
  it("counts savings in it", () => {
    const p = buildPrognose(
      { ...forecast(months), openingBalance: 100000, openingSavings: 50000 },
      "en",
    );
    expect(p.netWorth).toEqual({ start: 155000, end: 185000 });
  });
});

describe("buildPrognose", () => {
  it("says what is missing when real income exists but none is planned (no fixed income items)", () => {
    const p = buildPrognose(
      forecast([
        fm("2026-09", "actual", 20000, 20000),
        fm("2026-10", "mixed", -5000, 15000),
        fm("2026-11", "forecast", -30000, -15000),
        fm("2026-12", "forecast", -30000, -45000),
      ]),
      "en",
    );
    expect(p.incomeMissing).toBe(true);
    expect(p.tone).toBe("accent");
    expect(p.share).toBe(0);
    expect(p.sentence.map((s) => s.text).join("")).toMatch(/No income is planned/);
  });

  it("does not flag missing income when income is planned", () => {
    const p = buildPrognose(
      forecast([
        fm("2026-09", "actual", 20000, 20000),
        fm("2026-10", "mixed", 5000, 25000),
        fm("2026-11", "forecast", 30000, 55000),
      ]),
      "en",
    );
    expect(p.incomeMissing).toBe(false);
  });

  it("ring = share of months ahead that end in the plus; centre = growth; sentence names tightest and best", () => {
    const p = buildPrognose(
      forecast([
        fm("2026-09", "actual", 5000, 5000),
        fm("2026-10", "mixed", 20000, 25000),
        fm("2026-11", "forecast", -10000, 15000),
        fm("2026-12", "forecast", 40000, 55000),
      ]),
      "nl",
    );
    expect(p.ahead).toBe(3); // the past month is context, not forecast
    expect(p.inThePlus).toBe(2);
    expect(p.share).toBeCloseTo(2 / 3);
    expect(p.growth).toBe(50000);
    expect(p.tone).toBe("warn");
    const text = p.sentence.map((s) => s.text).join("");
    expect(text).toBe("November 2026 wordt krap, december 2026 is je beste maand.");
    expect(p.detail).toMatch(
      /groeit in totaal met .*500.* tot en met december 2026\. 2 van 3 maanden/,
    );
    expect(p.points.map((x) => x.projected)).toEqual([false, true, true, true]);
  });

  it("with no month in the minus the sentence names the best month first; both languages", () => {
    const months = [
      fm("2026-10", "mixed", 100, 100),
      fm("2026-11", "forecast", 5000, 5100),
      fm("2026-12", "forecast", 20000, 25100),
    ];
    expect(
      buildPrognose(forecast(months), "en")
        .sentence.map((s) => s.text)
        .join(""),
    ).toBe("December 2026 is your best month, October 2026 the tightest.");
    const nl = buildPrognose(forecast(months), "nl");
    expect(nl.sentence.map((s) => s.text).join("")).toBe(
      "December 2026 is je beste maand, oktober 2026 de krapste.",
    );
    expect(nl.notes[0]).toMatch(/schatting/);
  });

  it("all plus is good; negative growth is bad; nothing to forecast is neutral", () => {
    expect(buildPrognose(forecast([fm("2026-10", "mixed", 100, 100)]), "nl").tone).toBe("good");
    expect(
      buildPrognose(
        forecast([fm("2026-10", "mixed", -500, -500), fm("2026-11", "forecast", -100, -600)]),
        "nl",
      ).tone,
    ).toBe("bad");
    const none = buildPrognose(forecast([fm("2026-09", "actual", 1, 1)]), "nl");
    expect([none.hasForecast, none.tone]).toEqual([false, "accent"]);
  });

  it("a forecast with no money anywhere has nothing to say (no green ring over an empty database)", () => {
    const p = buildPrognose(
      forecast([fm("2026-10", "mixed", 0, 0), fm("2026-11", "forecast", 0, 0)]),
      "nl",
    );
    expect([p.hasForecast, p.tone, p.ahead]).toEqual([false, "accent", 0]);
  });

  it("explains low confidence in the chosen language", () => {
    const low = (n: number, locale: "en" | "nl") =>
      buildPrognose(
        {
          ...forecast([fm("2026-10", "mixed", 1, 1)]),
          variableBasis: {
            months: Array(n).fill("2026-09"),
            history: 3,
            lowConfidence: true,
            reason: "x",
          },
        },
        locale,
      ).lowConfidence;
    expect(low(0, "en")).toMatch(/No uploaded month/);
    expect(low(0, "nl")).toMatch(/geen eerdere maand/);
    expect(low(2, "en")).toBe("Only 2 of the 3 months of history are uploaded.");
    expect(low(2, "nl")).toBe("Maar 2 van de 3 maanden geschiedenis zijn geüpload.");
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
    const v = buildVasteLasten(
      [
        occ(1, "Huur", "matched", 90000, "2026-10-01"),
        occ(2, "Spotify", "expected", 1099, "2026-10-25"),
        occ(3, "Internet", "expected", 3500, "2026-10-18"),
        occ(4, "Salaris", "expected", 150000, "2026-10-27", "income"),
      ],
      "nl",
    );
    expect([v.paid, v.total]).toEqual([1, 3]);
    expect(v.share).toBeCloseTo(1 / 3);
    expect(v.toCome).toBe(4599);
    expect(v.sentence.map((s) => s.text).join("")).toMatch(/eerstvolgende is Internet op 18 okt/);
    // What is still to pay comes first, by date; what is paid goes below it.
    expect(v.expenses.map((r) => r.label)).toEqual(["komt 18 okt", "komt 25 okt", "betaald 1 okt"]);
    expect(v.income).toHaveLength(1);
  });

  it("everything paid, and nothing set up", () => {
    expect(
      buildVasteLasten([occ(1, "Huur", "matched", 90000, "2026-10-01")], "nl").sentence[1].text,
    ).toBe("betaald");
    const empty = buildVasteLasten([], "nl");
    expect([empty.total, empty.share]).toEqual([0, 0]);
  });

  it("a missed payment still counts as open money", () => {
    const v = buildVasteLasten([occ(1, "Gym", "missed", 3000, "2026-10-03")], "nl");
    expect([v.paid, v.toCome]).toEqual([0, 3000]);
    expect(v.expenses[0].label).toBe("gemist, verwacht 3 okt");
  });
});
