# Implementation Plan: Milestone 5, forecast (prognose)

## Overview

PLAN.md core logic 7: a read-only forecast engine `getForecast(db, { today, months, history, pastMonths })`
in `src/lib/forecast/` plus `GET /api/forecast`. Per month it returns actuals for uploaded past
months, a mix of actual and still-expected money for the current month, and a projection
(unmatched recurring occurrences plus average variable spend) for future months, with the budget
as a comparison line and a running cumulative net for the chart.

## Requirements

- Money in integer cents, dates as ISO strings; core never reads the clock (`today` is an argument).
- Read-only: no `generateOccurrences` / `syncRecurring`; future occurrences come from the pure
  `planOccurrences()`.
- No double counting: a matched occurrence is real money in the actuals and is never projected.
- Same basis as `getMonthOverview` (EUR / account currency only, internal transfers excluded,
  refunds net against their category), by sharing code rather than copying it.
- API: `months` 1-36 (default 6), `history` 1-12 (default 3), `pastMonths` 0-12 (default 3); 422 on
  anything else.

## Semantics (decisions)

- **Range.** `pastMonths` months before the current month, the current month, then `months` months
  ahead (so `months=6` returns 3 + 1 + 6 = 10 entries by default). Month = calendar month of
  `today`.
- **Kinds.** Past month with a row in `imports`: `actual` (exactly `getMonthOverview`). Past month
  without one: `no-data` (zero totals, budget differences null). Current month: `mixed` (with
  `hasUpload` telling whether it was uploaded). Later months: `forecast`.
- **Recurring sources.** For the current month and later, stored occurrences win (their status
  and edited amounts are honoured); for (item, month) pairs that are scheduled by an active item
  but not stored yet, `planOccurrences()` fills in. One line per (item, month), never two.
  Stored `expected` occurrences of inactive items are ignored (deactivation removes them anyway).
- **Statuses.** `expected` (active item): projected, `counted: "projected"`. `matched`: never
  projected; `counted: "actual"` when its transaction lies in that month (it is already inside
  the actuals), otherwise `"none"` (paid early or late, counted in the month it was paid).
  `missed`: never projected (it did not happen), `counted: "none"`, and surfaced in the per-month
  `missedCount` and the top-level `missed` list.
- **Planned occurrences already paid.** A planned (not yet stored) occurrence can already have its
  payment in the data, typically rent for the 1st paid on the 28th of the month before. The engine
  runs the matching rules in memory (shared pairing code from `matching.ts`, nothing written) and
  treats such an occurrence as matched, so it is not projected again and its transaction is not
  counted as variable spend either.
- **Carry-over.** An `expected` occurrence from an earlier month whose match window
  (+5 days) reaches into the current month may still be paid this month: it is projected in the
  current month (flag `carriedOver`).
- **Variable spend.** Window: the last `history` uploaded months strictly before the current month
  (two uploads for one month count once). Only transactions not linked to an occurrence, not
  internal transfers, in the account currency. Per expense category the net spend over the window
  (refunds subtract) is clamped at 0 and divided by the number of months that actually have data.
  Uncategorised outgoing money gets its own line (incoming uncategorised is not projected).
  No months: every average 0, `lowConfidence: true` and a reason; fewer than `history` months:
  averages over what exists, also `lowConfidence: true` with a reason.
- **Rounding.** `averageCents(total, n) = floor((2 * total + n) / (2 * n))` on integers: round half
  up, exact, no floats. Averages are rounded per category and the total is the sum of the rounded
  lines, so lines always add up to the total.
- **Income.** Projected only from recurring income items. Income categories are not averaged:
  irregular income (gifts, refunds, one-off jobs) would make the forecast optimistic, and the
  user's regular income (salary, DUO, toeslagen) is exactly what recurring items are for.
- **Current month (`mixed`).** Expenses = actual expenses so far (overview basis, including
  matched recurring payments) + projected recurring expenses + per category
  `max(0, average - max(0, variable so far))`. Income = actual income so far + projected recurring
  income.
- **Budget comparison.** Per month: explicit `monthly_total_budget`, else the sum of the category
  budgets, else null; per category the budget and `budget - total`. No budgets are invented for
  months without them. `no-data` months report budgets but null differences.
- **Chart totals.** Each month has `income`, `expenses`, `net`, `budget.total` and `cumulativeNet`
  (running sum over the returned months).

## Implementation steps (thin vertical slices)

1. **Shared sums** (`src/lib/budget/overview.ts`): extract `sumTransactions()` (per month, per
   category, optional exclusion of matched transactions) and build `getMonthOverview` on it.
   Existing overview tests guard the refactor. Risk: low.
2. **Shared pairing** (`src/lib/recurring/matching.ts`): extract the pure candidate pairing used by
   `matchOccurrences` so the forecast can match in memory. Existing matching tests guard it.
   Risk: medium (core of milestone 4), covered by its tests.
3. **Averages** (`src/lib/forecast/variable.ts`): `averageCents` and `getVariableAverages(db,
{ beforeMonth, history })`. Tests: rounding, window choice, dedupe of uploads, matched/transfer/
   foreign rows excluded, refunds, low confidence.
4. **Month timeline and actuals** (`src/lib/forecast/forecast.ts`): kinds, past months from the
   overview, validation (`ForecastError` -> 422). Tests: kinds, year rollover, 31st, horizon 1/36.
5. **Recurring projection**: stored vs planned merge, statuses, missed list, carry-over, in-memory
   match for planned occurrences. Tests: quarterly/yearly, ended / not started, early match, missed.
6. **Current month mix and budgets**: actual + remaining variable, budget comparison, cumulative net.
7. **Invariants**: property-style no-double-counting test over random histories, read-only
   snapshot, determinism, performance (5 years, 30 items).
8. **API** `src/app/api/forecast/route.ts` (thin, `handle()`, `requestTime()`, `todayIso()`), an
   HTTP flow test, README API table (also the recurring endpoints milestone 4 left out).

## Testing strategy

- Unit/integration on `createDb(":memory:")` with `src/lib/recurring/test-utils.ts` helpers.
- HTTP: `src/app/api/forecast-flow.test.ts` (upload fixture, recurring item, forecast, 422s).

## Risks and mitigations

- Double counting between matched and projected money: invariant test plus explicit `counted`.
- A recurring payment that never matches (amount drifted beyond tolerance) shows up as variable
  spend in its category and the item is still projected. Mitigation: those occurrences become
  `missed` and are surfaced; the user fixes the item. Not solvable read-only without guessing.
- Performance on long histories: one ranged query for the history window, overview per past month
  only for the returned past months.

## Success criteria

- [x] All semantics above covered by tests; `npm test`, lint, typecheck, format:check, build pass.
- [x] Forecast leaves the database untouched (snapshot test, 60 random worlds, HTTP test).
- [x] README API table complete.

## TDD evidence

| Slice                    | RED commit (failure seen)                             | GREEN commit | Guarantees                                                                                    |
| ------------------------ | ----------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------- |
| Shared sums and budgets  | `2cc9a4f` (`sumTransactions is not a function`)       | `026af5e`    | Overview and forecast count money identically; matched rows can be excluded                   |
| Shared pairing           | `403af28` (`unmatchedCandidates is not a function`)   | `4758ffb`    | Matching rules live in one pure function; existing matching suite unchanged and green         |
| Variable averages        | `0442a38` (module missing)                            | `fe1db09`    | Window, dedupe of uploads, exclusions, refunds, clamp, rounding, low confidence               |
| Engine                   | `2314ff2` (modules missing)                           | `fe1c751`    | Kinds, timeline, recurring sources and statuses, carry-over, mixed month, budgets, cumulative |
| API                      | `e87e68b` (route missing)                             | `5066324`    | Defaults, params, 422 on invalid input, read-only over HTTP                                   |
| Invariants (guard tests) | written after the engine; mutation-checked (see body) | `6a5356b`    | No double counting over random histories, read-only, deterministic, 5 years in ~25 ms         |

Commands: `npx vitest run <file>` for each RED/GREEN step, `npm test` for the full suite
(190 tests before the milestone, 235 after).

## Review log

- code-reviewer checklist: one function above 50 lines with logic (`projectRecurring`) split;
  sort given a final tie-breaker; loose `!=` replaced. Remaining long functions are object
  literals. No CRITICAL/HIGH findings.
- security-reviewer (API route): input is three query parameters, accepted only as 1-4 plain
  digits and range-checked (bounded work: at most 49 months); Drizzle parameterised queries only
  (the overview's `LIKE` became a date range); domain errors map to 422 without internals; GET
  is read-only and passes the cross-site guard as a safe method; no secrets, no new dependencies.
  Authentication is milestone 9.

## Known limitations

- A recurring payment that never matches (amount drifted beyond the tolerance) counts as
  variable spend in its category while the item is still projected; the occurrence turns
  `missed` and is surfaced so the user can fix the item.
- Occurrences are booked in their scheduled month; a payment expected on the 31st that lands on
  the 2nd shows up in the next month's actuals once uploaded.
