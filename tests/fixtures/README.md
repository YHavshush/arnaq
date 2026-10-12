# Test fixtures

Anonymised sample bank exports used by the parser tests.

- Only **anonymised** files belong here. Replace real names, IBANs, descriptions and amounts before adding a file.
- Real bank CSVs are never committed. `.gitignore` ignores `*.csv` everywhere except `tests/fixtures/`.

## Current files

| File                  | Origin                                                                                                                             |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `rabobank-sample.csv` | **Synthetic**, written from the documented Rabobank column layout (comma separated, Dutch headers, `+1.234,56` amounts).           |
| `revolut-sample.csv`  | **Synthetic**, written from the documented Revolut layout (COMPLETED / PENDING / REVERTED, separate Fee column, mixed currencies). |

**Revolut: verified** against a real export (same columns and `State` values; one difference found and fixed: the date is the _Completed_ date, because the statement period is by completion). **Rabobank CSV: not verified.** The owner's Rabobank statements arrive as **PDF** ("Rekeningafschrift"), which is read by `src/lib/import/parsers/rabobank-pdf.ts` and tested with a generated, invented statement (`tests/helpers/statement-pdf.ts`). Real statements are never committed (`*.pdf` is git-ignored).

To verify the Rabobank CSV: To verify: take a real export, anonymise it (change names, IBANs, descriptions, amounts), save it here as a new fixture, and add a parser test. If a header differs, adjust the parser in `src/lib/import/parsers/`.
