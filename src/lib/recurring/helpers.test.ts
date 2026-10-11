import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  clampDay,
  daysBetween,
  daysInMonth,
  isDate,
  isMonth,
  monthDiff,
} from "./dates";
import {
  counterpartyMatches,
  identityMatches,
  normaliseCounterparty,
  normaliseIban,
} from "./normalise";

describe("dates", () => {
  it("validates days and months", () => {
    expect(isDate("2026-02-28")).toBe(true);
    expect(isDate("2026-02-29")).toBe(false);
    expect(isDate("2028-02-29")).toBe(true);
    expect(isDate("2026-04-31")).toBe(false);
    expect(isDate("2026-13-01")).toBe(false);
    expect(isDate("2026-1-01")).toBe(false);
    expect(isDate(20260101)).toBe(false);
    expect(isMonth("2026-12")).toBe(true);
    expect(isMonth("2026-00")).toBe(false);
  });

  it("does month arithmetic across years", () => {
    expect(addMonths("2026-11", 3)).toBe("2027-02");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-01", -13)).toBe("2024-12");
    expect(monthDiff("2025-11", "2026-02")).toBe(3);
    expect(monthDiff("2026-02", "2025-11")).toBe(-3);
  });

  it("clamps days to the month, including leap years", () => {
    expect(daysInMonth("2026-02")).toBe(28);
    expect(daysInMonth("2028-02")).toBe(29);
    expect(daysInMonth("2100-02")).toBe(28);
    expect(daysInMonth("2000-02")).toBe(29);
    expect(clampDay("2026-02", 31)).toBe("2026-02-28");
    expect(clampDay("2028-02", 31)).toBe("2028-02-29");
    expect(clampDay("2026-04", 31)).toBe("2026-04-30");
    expect(clampDay("2026-04", 5)).toBe("2026-04-05");
  });

  it("adds and counts days across month and year ends", () => {
    expect(addDays("2026-12-29", 5)).toBe("2027-01-03");
    expect(addDays("2028-03-02", -3)).toBe("2028-02-28");
    expect(daysBetween("2026-02-25", "2026-03-02")).toBe(5);
  });
});

describe("normalise", () => {
  it("normalises names and IBANs", () => {
    expect(normaliseCounterparty("  Café   Voorbeeld\tBV ")).toBe("cafe voorbeeld bv");
    expect(normaliseCounterparty(null)).toBe("");
    expect(normaliseIban(" nl00 rabo 0000 0000 01")).toBe("NL00RABO0000000001");
  });

  it("matches counterparties as normalised substrings in either direction", () => {
    expect(counterpartyMatches("Spotify", "SPOTIFY  AB")).toBe(true);
    expect(counterpartyMatches("Verhuurder Voorbeeld BV", "verhuurder voorbeeld")).toBe(true);
    expect(counterpartyMatches("Netflix", "Spotify AB")).toBe(false);
    // Too short to count as a substring hit, but exact equality still works.
    expect(counterpartyMatches("ab", "Spotify AB")).toBe(false);
    expect(counterpartyMatches("AB", "ab")).toBe(true);
    expect(counterpartyMatches(null, "Spotify")).toBe(false);
    expect(counterpartyMatches("Spotify", null)).toBe(false);
  });

  it("lets the IBAN decide when both sides have one, else falls back to the name", () => {
    const item = { matchCounterparty: "Verhuurder", matchIban: "NL00 BANK 0000 0000 11" };
    expect(
      identityMatches(item, { counterparty: "Other name", counterpartyIban: "NL00BANK0000000011" }),
    ).toBe(true);
    expect(
      identityMatches(item, { counterparty: "Verhuurder", counterpartyIban: "NL00BANK0000000099" }),
    ).toBe(false);
    expect(identityMatches(item, { counterparty: "Verhuurder BV", counterpartyIban: null })).toBe(
      true,
    );
    expect(
      identityMatches(
        { matchCounterparty: null, matchIban: "NL00BANK0000000011" },
        { counterparty: "Verhuurder", counterpartyIban: null },
      ),
    ).toBe(false);
  });
});
