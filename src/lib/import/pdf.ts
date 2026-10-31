import { getDocumentProxy } from "unpdf";
import { StatementError } from "./parsers/rabobank-pdf";
import type { PdfItem } from "./parsers/rabobank-pdf";

/** A statement is some pages with a few hundred text items each (a whole year is about 80 pages and 25,000 items);
 * anything beyond these limits is not a bank statement (or is built to be slow), so it is refused before it is processed. */
export const MAX_PDF_PAGES = 200;
export const MAX_ITEMS_PER_PAGE = 5_000;
export const MAX_ITEMS_TOTAL = 100_000;
const MAX_READ_MS = 10_000;

export const isPdf = (bytes: Uint8Array) =>
  bytes.length > 4 &&
  bytes[0] === 0x25 &&
  bytes[1] === 0x50 &&
  bytes[2] === 0x44 &&
  bytes[3] === 0x46; // "%PDF"

const tooComplex = () => new StatementError("This PDF is too complex to be a statement.");

/** Positioned text per page. Text only: no scripts, forms or images are touched. */
export async function readPdfPages(bytes: Uint8Array): Promise<PdfItem[][]> {
  const deadline = Date.now() + MAX_READ_MS;
  let pdf;
  try {
    pdf = await getDocumentProxy(new Uint8Array(bytes), {
      verbosity: 0,
      stopAtErrors: true,
      disableFontFace: true,
      maxImageSize: 1,
    });
  } catch {
    throw new StatementError("This PDF could not be read.");
  }
  try {
    if (pdf.numPages > MAX_PDF_PAGES) throw tooComplex();
    const pages: PdfItem[][] = [];
    let total = 0;
    for (let n = 1; n <= pdf.numPages; n++) {
      if (Date.now() > deadline) throw tooComplex();
      let items;
      try {
        items = (await (await pdf.getPage(n)).getTextContent()).items as {
          str?: string;
          transform?: number[];
          width?: number;
        }[];
      } catch {
        throw new StatementError("This PDF could not be read.");
      }
      total += items.length;
      if (items.length > MAX_ITEMS_PER_PAGE || total > MAX_ITEMS_TOTAL) throw tooComplex();
      pages.push(
        items
          .filter((i) => typeof i.str === "string" && i.transform && typeof i.width === "number")
          .map((i) => ({
            str: i.str!,
            x: i.transform![4],
            right: i.transform![4] + i.width!,
            y: i.transform![5],
          })),
      );
    }
    return pages;
  } finally {
    await (pdf as unknown as { destroy?: () => Promise<void> }).destroy?.();
  }
}
