import { describe, expect, it } from "vitest";
import {
  statementPages,
  toPdfBytes,
  type StatementRow,
} from "../../../../tests/helpers/statement-pdf";
import { readPdfPages } from "../pdf";
import { StatementError, looksLikeRabobankStatement, parseRabobankStatement } from "./rabobank-pdf";

const rows: StatementRow[] = [
  {
    rente: "02-09",
    type: "ei",
    iban: "NL00 TEST 0000 0000 11",
    name: "Streamdienst",
    notes: ["Kenmerk machtiging", "REF-ABC123"],
    processed: "02-09-2026",
    debit: 999,
  },
  {
    rente: "03-09",
    type: "ec",
    name: "Pinbetaling Voorbeeldwinkel",
    notes: ["Pas: 5xxxx1234"],
    processed: "03-09-2026",
    debit: 1250,
  },
  {
    rente: "25-09",
    type: "cb",
    iban: "NL00 TEST 0000 0000 22",
    name: "Werkgever Voorbeeld BV",
    notes: ["Salaris september"],
    processed: "25-09-2026",
    credit: 185000,
  },
  {
    rente: "28-09",
    type: "bv",
    iban: "NL00 TEST 0000 0000 33",
    name: "Rabo Betaalverzoek",
    processed: "29-09-2026",
    credit: 2300,
  },
  {
    rente: "30-09",
    type: "ei",
    iban: "NL00 TEST 0000 0000 44",
    name: "Huisbaas Voorbeeld",
    processed: "30-09-2026",
    debit: 79000,
  },
];

describe("parseRabobankStatement", () => {
  it("reads rows across pages: signs, booking dates, counterparties and the account", () => {
    const r = parseRabobankStatement(statementPages({ rows, perPage: 2 }));
    expect(r.accountIdentifier).toBe("NL00RABO0000000001");
    expect(r.period).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(r.currency).toBe("EUR");
    expect(r.rows.map((x) => [x.date, x.amount, x.counterparty])).toEqual([
      ["2026-09-02", -999, "Streamdienst"],
      ["2026-09-03", -1250, "Pinbetaling Voorbeeldwinkel"],
      ["2026-09-25", 185000, "Werkgever Voorbeeld BV"],
      ["2026-09-29", 2300, "Rabo Betaalverzoek"], // booked 29-09 although the interest date is 28-09
      ["2026-09-30", -79000, "Huisbaas Voorbeeld"],
    ]);
    expect(r.rows[0]).toMatchObject({
      counterpartyIban: "NL00TEST0000000011",
      description: "Kenmerk machtiging REF-ABC123",
    });
    expect(r.rows[1].counterpartyIban).toBeNull();
    expect(r.rows[0].description).not.toMatch(/Verwerkingsdatum/);
    expect(new Set(r.rows.map((x) => x.sourceKey)).size).toBe(5);
  });

  it("uses the interest date, placed in the right year, when there is no booking date", () => {
    const r = parseRabobankStatement(
      statementPages({
        from: "15-12-2026",
        to: "15-01-2027",
        rows: [
          { rente: "28-12", type: "ei", name: "Een", debit: 100 },
          { rente: "05-01", type: "ei", name: "Twee", debit: 200 },
        ],
      }),
    );
    expect(r.rows.map((x) => x.date)).toEqual(["2026-12-28", "2027-01-05"]);
  });

  it("an empty statement is fine when the balances agree", () => {
    const r = parseRabobankStatement(statementPages({ rows: [] }));
    expect(r.rows).toEqual([]);
  });

  it("refuses a statement whose totals do not match what was read", () => {
    for (const totals of [{ debit: 12345 }, { credit: 5 }, { closing: 1 }])
      expect(() => parseRabobankStatement(statementPages({ rows, totals }))).toThrow(
        StatementError,
      );
  });

  it("refuses when a row cannot be read completely (no amount)", () => {
    const pages = statementPages({ rows });
    // Remove the amount of the second row from the page.
    const amount = pages[0].find((i) => i.str === "12,50")!;
    pages[0].splice(pages[0].indexOf(amount), 1);
    expect(() => parseRabobankStatement(pages)).toThrow(/not be read reliably/);
  });

  it("refuses a page without the header it needs", () => {
    expect(() => parseRabobankStatement([[]])).toThrow(StatementError);
    expect(looksLikeRabobankStatement([[]])).toBe(false);
    expect(looksLikeRabobankStatement(statementPages({ rows }))).toBe(true);
  });

  it("a negative opening balance (D) is handled", () => {
    const r = parseRabobankStatement(statementPages({ rows, openingCents: -5000 }));
    expect(r.rows).toHaveLength(5);
  });
});

describe("layouts a real statement can have", () => {
  const one: StatementRow[] = [
    {
      rente: "05-09",
      type: "ei",
      iban: "NL00 TEST 0000 0000 11",
      name: "Streamdienst",
      notes: ["Kenmerk REF-1"],
      processed: "06-09-2026",
      debit: 999,
    },
    { rente: "10-09", type: "ec", name: "Winkel", processed: "10-09-2026", debit: 500 },
  ];

  it("a row whose last lines continue on the next page keeps its booking date and description", () => {
    const pages = statementPages({ rows: one, perPage: 1 });
    const processed = pages[0].find((i) => i.str.startsWith("Verwerkingsdatum: 06-09"))!;
    const note = pages[0].find((i) => i.str === "Kenmerk REF-1")!;
    // The note and the booking date of the first row move to the top of the second page.
    pages[0].splice(pages[0].indexOf(processed), 1);
    pages[0].splice(pages[0].indexOf(note), 1);
    pages[1].push({ ...note, y: 566 }, { ...processed, y: 556 });
    const r = parseRabobankStatement(pages);
    expect(r.rows[0]).toMatchObject({ date: "2026-09-06", description: "Kenmerk REF-1" });
    expect(r.rows[1]).toMatchObject({ date: "2026-09-10", counterparty: "Winkel" });
  });

  it("page furniture below the last row (a page number) is not part of its description", () => {
    const pages = statementPages({ rows: one });
    pages[0].push({ str: "Pagina 1 van 1", x: 300, right: 330, y: 330 });
    const r = parseRabobankStatement(pages);
    expect(r.rows[1].description).toBeNull();
  });

  it("a long name that runs towards the amount column is kept", () => {
    const long = "Een Zeer Lange Naam Van Een Organisatie BV Amsterdam";
    const r = parseRabobankStatement(statementPages({ rows: [{ ...one[1], name: long }] }));
    expect(r.rows[0].counterparty).toBe(long);
  });

  it("a row with an empty name column takes its name from the first description line", () => {
    const r = parseRabobankStatement(
      statementPages({
        rows: [
          {
            rente: "22-09",
            type: "ei",
            iban: "NL00 TEST 0000 0000 55",
            name: "",
            notes: ["VIDEODIENST B.V.", "Kenmerk machtiging"],
            processed: "22-09-2026",
            debit: 2099,
          },
        ],
      }),
    );
    expect(r.rows[0]).toMatchObject({
      counterparty: "VIDEODIENST B.V.",
      description: "Kenmerk machtiging",
    });
  });

  it("a total that prints blank counts as zero", () => {
    const pages = statementPages({
      rows: [{ rente: "02-09", type: "cb", name: "Bij", processed: "02-09-2026", credit: 1000 }],
    });
    const debitValue = pages[0].find((i) => i.str === "0,00" && i.x > 380 && i.x < 450)!;
    pages[0].splice(pages[0].indexOf(debitValue), 1);
    expect(parseRabobankStatement(pages).rows).toHaveLength(1);
  });

  it("strips control characters from names and descriptions", () => {
    const r = parseRabobankStatement(
      statementPages({
        rows: [{ ...one[0], name: "Naam\u0000Met\u202ENul", notes: ["Een\u0007 regel"] }],
      }),
    );
    expect(r.rows[0].counterparty).toBe("NaamMetNul");
    expect(r.rows[0].description).toBe("Een regel");
  });
});

describe("readPdfPages limits", () => {
  it("refuses a PDF with an absurd number of text items", async () => {
    const items = Array.from({ length: 6000 }, (_, i) => ({
      str: "x",
      x: 10,
      right: 15,
      y: 800 - (i % 700) - i / 10000,
    }));
    await expect(readPdfPages(toPdfBytes([items]))).rejects.toThrow(/too complex/);
  });

  it("groups lines in linear time (many distinct baselines stay fast)", () => {
    const items = Array.from({ length: 20000 }, (_, i) => ({
      str: "x",
      x: 10,
      right: 15,
      y: i * 3,
    }));
    const started = Date.now();
    expect(() => parseRabobankStatement([items])).toThrow(StatementError);
    expect(Date.now() - started).toBeLessThan(1500);
  });
});

describe("readPdfPages (real PDF bytes)", () => {
  it("extracts the same rows from an actual PDF file", async () => {
    const bytes = toPdfBytes(statementPages({ rows, perPage: 3 }));
    const pages = await readPdfPages(bytes);
    expect(pages).toHaveLength(2);
    const r = parseRabobankStatement(pages);
    expect(r.rows.map((x) => x.amount)).toEqual([-999, -1250, 185000, 2300, -79000]);
    expect(r.accountIdentifier).toBe("NL00RABO0000000001");
  });

  it("rejects bytes that are not a PDF", async () => {
    await expect(
      readPdfPages(new TextEncoder().encode("%PDF-1.4 but nothing else")),
    ).rejects.toThrow(StatementError);
  });
});
