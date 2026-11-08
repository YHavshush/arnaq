import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/recurring/dates";
import { BTW_PAYMENT_LAGS } from "./defaults";
import { btwQuarterOfReceipt, btwReceiptWindow, calendarQuarter } from "./quarter";

describe("calendarQuarter", () => {
  it("is the calendar quarter a day or a month falls in, with its due date", () => {
    expect(calendarQuarter("2026-11-08")).toEqual({
      label: "2026-Q4",
      from: "2026-10-01",
      to: "2026-12-31",
      due: "2027-01-31",
    });
    expect(calendarQuarter("2026-01").label).toBe("2026-Q1");
    expect(calendarQuarter("2026-03-31").label).toBe("2026-Q1");
    expect(calendarQuarter("2026-04-01").label).toBe("2026-Q2");
  });
});

describe("btwQuarterOfReceipt: the BTW quarter money from the client counts for", () => {
  it("lag 0: the calendar quarter of the day it arrived", () => {
    expect(btwQuarterOfReceipt("2026-10-01", 0).label).toBe("2026-Q4");
    expect(btwQuarterOfReceipt("2026-12-31", 0).label).toBe("2026-Q4");
    expect(btwQuarterOfReceipt("2027-01-01", 0).label).toBe("2027-Q1");
  });

  it("lag 1: money arriving in November to January counts for the fourth quarter", () => {
    expect(btwQuarterOfReceipt("2026-10-31", 1).label).toBe("2026-Q3");
    expect(btwQuarterOfReceipt("2026-11-01", 1).label).toBe("2026-Q4");
    expect(btwQuarterOfReceipt("2026-12-15", 1).label).toBe("2026-Q4");
    // Across the year end: January money is the previous year's fourth quarter.
    expect(btwQuarterOfReceipt("2027-01-31", 1).label).toBe("2026-Q4");
    expect(btwQuarterOfReceipt("2027-02-01", 1).label).toBe("2027-Q1");
  });

  it("lag 2: money arriving in December to February counts for the fourth quarter", () => {
    expect(btwQuarterOfReceipt("2026-11-30", 2).label).toBe("2026-Q3");
    expect(btwQuarterOfReceipt("2026-12-01", 2).label).toBe("2026-Q4");
    expect(btwQuarterOfReceipt("2027-01-10", 2).label).toBe("2026-Q4");
    expect(btwQuarterOfReceipt("2027-02-28", 2).label).toBe("2026-Q4");
    expect(btwQuarterOfReceipt("2027-03-01", 2).label).toBe("2027-Q1");
  });

  it("takes a month as well as a day", () => {
    expect(btwQuarterOfReceipt("2027-01", 1).label).toBe("2026-Q4");
    expect(btwQuarterOfReceipt("2027-01", 0).label).toBe("2027-Q1");
  });

  it("keeps the quarter's own dates and due date: only the money that funds it moves", () => {
    expect(btwQuarterOfReceipt("2027-01-20", 1)).toEqual(calendarQuarter("2026-12-01"));
  });
});

describe("btwReceiptWindow: the days whose money funds a quarter", () => {
  const q4 = calendarQuarter("2026-10-01");
  it("is the quarter itself with lag 0, and moves by the lag in whole months", () => {
    expect(btwReceiptWindow(q4, 0)).toEqual({ from: "2026-10-01", to: "2026-12-31" });
    expect(btwReceiptWindow(q4, 1)).toEqual({ from: "2026-11-01", to: "2027-01-31" });
    expect(btwReceiptWindow(q4, 2)).toEqual({ from: "2026-12-01", to: "2027-02-28" });
    // A leap year's February.
    expect(btwReceiptWindow(calendarQuarter("2027-10-01"), 2).to).toBe("2028-02-29");
  });

  it("agrees with btwQuarterOfReceipt on every day of two years, for every lag", () => {
    for (const lag of BTW_PAYMENT_LAGS)
      for (let day = "2026-01-01"; day <= "2027-12-31"; day = addDays(day, 1)) {
        const quarter = btwQuarterOfReceipt(day, lag);
        const window = btwReceiptWindow(quarter, lag);
        expect(day >= window.from && day <= window.to, `${day} lag ${lag}`).toBe(true);
      }
  });
});
