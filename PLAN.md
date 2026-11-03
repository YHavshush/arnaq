# PLAN

## What the app does

Personal budget tracker. I upload one CSV per bank account per month. The app shows budget vs actual, manages my vaste lasten and inkomen (suggesting them from previous months), and gives a prognose for an adjustable number of months. When I upload a new month, forecast numbers for recurring items turn into real numbers and the vaste last is checked off, so nothing is counted twice.

## Decisions

- Banks: Rabobank + Revolut (two accounts)
- Stack: Next.js (App Router) + TypeScript + Tailwind + shadcn/ui + Postgres (Drizzle ORM; PGlite locally, Supabase hosted)
- Hosting: local first, then Vercel + Supabase
- Prognose horizon: adjustable in the UI. Default 6 months (placeholder, can change)
- Budget: per category per month, plus an optional total per month
- Categories: default set below, editable
- Design: UI UX Pro Max sets direction once, Impeccable polishes at the end
- Data safety: real bank CSVs and the database are never committed

## Data model

- accounts: id, name, bank (rabobank | revolut), iban/identifier, currency
- transactions: id, account_id, date, amount (integer cents), currency, counterparty, counterparty_iban, description, category_id, import_hash (unique, dedupe), matched_occurrence_id, is_internal_transfer
- categories: id, name, type (expense | income | transfer), sort order
- budgets: category_id, month, amount. Plus monthly_total_budget: month, amount (optional)
- categorisation_rules: pattern (counterparty/description), category_id, priority
- recurring_items: id, name, type (expense | income), counterparty/IBAN match, expected amount, tolerance, day of month, frequency (monthly / quarterly / yearly), category_id, start/end date, active
- recurring_occurrences: recurring_item_id, month, expected_date, expected_amount, status (expected | matched | missed), transaction_id (set when matched)
- imports: id, account_id, month, filename, uploaded_at, row counts

## Core logic

1. Import: one parser per bank. Dedupe by hash so re-uploading a month never double counts.
2. Internal transfers: detect transfers between Rabobank and Revolut (opposite amounts, close dates, own IBANs) and exclude them from income and expenses.
3. Categorisation: apply rules in priority order. Anything left over goes to a "needs review" list. Assigning a category can create a new rule.
4. Suggestions: group past transactions by counterparty. If one appears in 3+ months with similar amount and regular timing, suggest it as a vaste last or inkomen. I accept or reject it.
5. Matching: on each upload, match transactions to expected occurrences (same counterparty/IBAN, amount within tolerance, date within about 5 days). A match sets the occurrence to matched, links the transaction and uses the real amount. A vaste last is then never counted both as forecast and as actual.
6. Missed: an expected occurrence with no match after its window passes becomes missed and is shown for review.
7. Prognose (adjustable horizon), per future month: unmatched recurring occurrences (known income and vaste lasten) plus the average variable spend per category over past months (excluding recurring items), with the budget as a comparison line. Months with an upload show actuals. The current month is a mix of actual and still-expected.

## Default categories

Expenses: Huur, Gas/water/licht, Internet & telefoon, Zorgverzekering, Boodschappen, Eten & drinken (uit eten, afhaal, koffie), Uitgaan & social, Vervoer (OV, fiets, taxi), Sport (gym), Abonnementen (Claude, Spotify, Netflix etc.), Studie (collegegeld, boeken), Kleding & verzorging, Gezondheid (huisarts, apotheek, eigen risico), Reizen & vakantie, Cadeaus & donaties, Sparen & beleggen, Overig.

Income: Salaris / bijbaan, Studiefinanciering (DUO), Zorgtoeslag, Huurtoeslag, Familie / gift, Overig inkomen.

Other: Interne overboeking (excluded from totals).

## Bank CSV notes

- Rabobank: Dutch headers, includes counterparty name and IBAN plus several description fields. Verify the exact format against a real sample before building the parser.
- Revolut: has a state column (completed / pending / reverted). Import only completed rows. Fees can be separate, and there may be multiple currencies. Handle EUR first, and flag other currencies for review.
- Build each parser against anonymised sample files in tests/fixtures/. If no samples exist yet when you reach milestone 2, stop and ask me for them.

## Milestones

1. feat/scaffold (Sonnet): Next.js + TS + Tailwind + shadcn/ui; SQLite + Drizzle with the schema and first migration; Vitest with one passing test, lint and format scripts; README with how to run locally; tests/fixtures/ with a short README.
2. feat/csv-import (Sonnet): parser interface, Rabobank parser, Revolut parser (state filter, currency handling), hash dedupe, import log, upload endpoint, tests with fixtures including re-upload.
3. feat/categories-budget (Sonnet): seed default categories, rule-based categorisation, needs-review list, budgets per category per month plus optional total, budget vs actual calculation.
4. feat/recurring (Opus): CRUD for vaste lasten and inkomen, suggestion detection, occurrence generation, matching engine (upload flips expected to matched, no double counting), missed handling, heavy test coverage.
5. feat/forecast (Opus): forecast engine with adjustable horizon, actuals replace forecast when a month is uploaded, average variable spend per category, tests for mixed months.
6. feat/design-system (Sonnet): install UI UX Pro Max, generate a design system for a personal finance dashboard (style, palette, fonts), save as design tokens (Tailwind config / CSS variables), document in DESIGN.md. No new styles from the catalog after this.
7. feat/dashboard (Sonnet): upload screen, month overview (budget vs actual per category and total), recurring items screen with suggestions, forecast chart with horizon selector, needs-review list, settings (categories, rules, budgets).
8. feat/polish (Sonnet, Haiku for small fixes): install Impeccable, run /teach-impeccable once, run critique and audit on each screen and fix findings, transfer detection edge cases, database backup/export.
9. feat/deploy (Sonnet, Opus for a final security review): Supabase project (migrations, RLS deny-all, pooled connection), app hosting, Supabase Auth (login required, this is financial data), backups/export, authentication (login required, this is financial data on someone else's server), HTTPS via reverse proxy, automated encrypted backups.
