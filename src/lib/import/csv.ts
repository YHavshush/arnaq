import Papa from "papaparse";

export interface CsvTable {
  headers: string[];
  records: Record<string, string>[];
}

/** Parse a CSV string with auto-detected delimiter (comma or semicolon). Strips a UTF-8 BOM. */
export function readCsv(content: string): CsvTable {
  const text = content.replace(/^﻿/, "");
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    delimitersToGuess: [",", ";"],
    transformHeader: (h) => h.trim(),
  });
  const fatal = result.errors.find((e) => e.type === "Delimiter" || e.type === "Quotes");
  if (fatal) throw new Error(`Cannot read CSV: ${fatal.message}`);
  return { headers: result.meta.fields ?? [], records: result.data };
}

export function readHeaders(content: string): string[] {
  const text = content.replace(/^﻿/, "");
  const result = Papa.parse<string[]>(text, {
    preview: 1,
    delimitersToGuess: [",", ";"],
  });
  return (result.data[0] ?? []).map((h) => h.trim());
}
