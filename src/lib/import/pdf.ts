import { getDocumentProxy } from "unpdf";
import { StatementError } from "./parsers/rabobank-pdf";
import type { PdfItem } from "./parsers/rabobank-pdf";

/** Statements are a handful of pages; anything bigger is not a bank statement. */
export const MAX_PDF_PAGES = 60;

export const isPdf = (bytes: Uint8Array) =>
  bytes.length > 4 &&
  bytes[0] === 0x25 &&
  bytes[1] === 0x50 &&
  bytes[2] === 0x44 &&
  bytes[3] === 0x46; // "%PDF"

/** Positioned text per page. Text only: no scripts, forms or images are touched. */
export async function readPdfPages(bytes: Uint8Array): Promise<PdfItem[][]> {
  let pdf;
  try {
    pdf = await getDocumentProxy(new Uint8Array(bytes));
  } catch {
    throw new StatementError("Dit PDF-bestand kon niet gelezen worden.");
  }
  try {
    if (pdf.numPages > MAX_PDF_PAGES)
      throw new StatementError("Dit PDF-bestand heeft te veel pagina's voor een afschrift.");
    const pages: PdfItem[][] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const content = await (await pdf.getPage(n)).getTextContent();
      pages.push(
        (content.items as { str?: string; transform?: number[]; width?: number }[])
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
