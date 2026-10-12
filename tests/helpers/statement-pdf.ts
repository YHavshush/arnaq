// Builds a Rabobank-style "Rekeningafschrift" for tests: the same page layout and column positions
// as the real PDF, filled with invented data. Real statements are never committed.
import type { PdfItem } from "@/lib/import/parsers/rabobank-pdf";

const CHAR = 4.8; // width of one Courier character at 8 pt

export interface StatementRow {
  /** dd-mm (interest date). */
  rente: string;
  type: string;
  iban?: string;
  name: string;
  /** Extra description lines under the name. */
  notes?: string[];
  /** dd-mm-yyyy. Omitted: no "Verwerkingsdatum" line, the interest date is used. */
  processed?: string;
  /** Positive cents. */
  debit?: number;
  credit?: number;
}

export interface StatementSpec {
  iban?: string; // with spaces, as printed
  from?: string; // dd-mm-yyyy
  to?: string;
  openingCents?: number; // signed: negative prints "D"
  rows: StatementRow[];
  /** Rows per page (default 4). */
  perPage?: number;
  /** Override printed totals to simulate a misread statement. */
  totals?: { debit?: number; credit?: number; closing?: number };
}

const fmt = (cents: number) =>
  `${Math.floor(Math.abs(cents) / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${String(Math.abs(cents) % 100).padStart(2, "0")}`;

const item = (str: string, x: number, y: number): PdfItem => ({
  str,
  x,
  right: x + str.length * CHAR,
  y,
});
const right = (str: string, rightEdge: number, y: number): PdfItem =>
  item(str, rightEdge - str.length * CHAR, y);

export function statementPages(spec: StatementSpec): PdfItem[][] {
  const iban = spec.iban ?? "NL00 RABO 0000 0000 01 EUR";
  const from = spec.from ?? "01-09-2026";
  const to = spec.to ?? "30-09-2026";
  const opening = spec.openingCents ?? 100000;
  const debit = spec.rows.reduce((s, r) => s + (r.debit ?? 0), 0);
  const credit = spec.rows.reduce((s, r) => s + (r.credit ?? 0), 0);
  const closing = spec.totals?.closing ?? opening - debit + credit;
  const bal = (c: number) => `${fmt(c)} ${c < 0 ? "D" : "CR"}`;

  const pages: PdfItem[][] = [];
  const perPage = spec.perPage ?? 4;
  for (let p = 0; p * perPage < Math.max(spec.rows.length, 1); p++) {
    const items: PdfItem[] = [
      item(p === 0 ? "Rekeningafschrift" : "vervolg Rekeningafschrift", 34, 772),
    ];
    items.push(
      item("Datum vanaf", 405, 674),
      item(from, 395, 662),
      item("Datum tot en met", 392, 644),
      item(to, 395, 632),
    );
    items.push(item("IBAN / Rekeningnummer", 37, 613), item(iban, 37, 601));
    if (p === 0) {
      items.push(
        item("Beginsaldo", 532, 674),
        right(bal(opening), 567, 662),
        item("Eindsaldo", 536, 644),
        right(bal(closing), 567, 632),
        item("Totaal afgeschreven", 383, 613),
        right(fmt(spec.totals?.debit ?? debit), 447, 601),
        item("Totaal bijgeschreven", 502, 613),
        right(fmt(spec.totals?.credit ?? credit), 567, 601),
      );
    }
    items.push(
      item("Rente", 37, 583),
      item("datum", 37, 577),
      item("Type", 69, 583),
      item("Tegenrekening", 89, 583),
      item("Naam/omschrijving", 206, 583),
      item("Bedrag af (debet)", 420, 583),
      item("Bedrag bij (credit)", 509, 583),
    );
    let y = 541;
    for (const r of spec.rows.slice(p * perPage, (p + 1) * perPage)) {
      items.push(item(r.rente, 37, y), item(r.type, 69, y));
      if (r.iban) items.push(item(r.iban, 89, y));
      items.push(item(r.name, 206, y));
      if (r.debit) items.push(right(fmt(r.debit), 474, y));
      if (r.credit) items.push(right(fmt(r.credit), 565, y));
      for (const note of r.notes ?? []) items.push(item(note, 206, (y -= 10)));
      if (r.processed) items.push(item(`Verwerkingsdatum: ${r.processed}`, 206, (y -= 10)));
      y -= 22;
    }
    if (p === Math.ceil(spec.rows.length / perPage) - 1 || spec.rows.length === 0) {
      items.push(item("ba = betaalautomaat", 34, 273), item("CR = tegoed", 700, 100));
    }
    pages.push(items);
  }
  return pages;
}

/** A real, minimal PDF (Courier text at fixed coordinates) so the text extraction is tested too. */
export function toPdfBytes(pages: PdfItem[][]): Uint8Array {
  const objects: string[] = [];
  const add = (body: string) => objects.push(body) && objects.length;
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>");
  const pageIds: number[] = [];
  const pagesId = objects.length + pages.length * 2 + 1;
  for (const items of pages) {
    const stream = items
      .map(
        (i) =>
          `BT /F1 8 Tf 1 0 0 1 ${i.x.toFixed(2)} ${i.y.toFixed(2)} Tm (${i.str.replace(/[()\\]/g, "\\$&")}) Tj ET`,
      )
      .join("\n");
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    pageIds.push(
      add(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Contents ${content} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`,
      ),
    );
  }
  add(
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`,
  );
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(out);
}
