# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One person (the owner), a Dutch student renting a room, with a Rabobank current account and a Revolut account. They look at the app a few times a week, mostly on a phone, and after each month's statements arrive on a laptop. Possibly a partner or family member later; not confirmed.

## Product Purpose

arnaq answers one question in a second: how much is still free to spend this month, after the fixed costs that are still to come. It turns monthly bank statements into budget versus actual, fixed costs and income that match themselves against the statements (no double counting), and a forecast over a horizon the owner chooses. Success is that the owner opens it instead of their banking apps to decide whether they can afford something.

## Positioning

Not a bank aggregator and not a coach: nothing connects to the bank, the owner uploads statements (Revolut CSV, Rabobank PDF) and keeps the data. Calm, honest numbers over gamification.

## Operating Context

Statements are uploaded by hand, at arbitrary periods. Rabobank only provides PDFs the owner uses; they are read locally and accepted only when they add up. Data lives in Postgres (Supabase later). All UI text is Dutch.

## Capabilities and Constraints

Money is integer cents. The forecast is read-only. Internal transfers between own accounts are kept out of income and expenses. A month counts as uploaded only when a statement covers all of it. Hosting and login come in milestone 9; until then it runs on the owner's laptop.

## Brand Commitments

Name: arnaq. Voice: plain Dutch, second person, no jargon, no alarm. The owner chose the look (see DESIGN.md) and has final say on it.

## Evidence on Hand

Real statements exist locally and are never committed; tests use invented data. There are no testimonials, other users or benchmarks.

## Product Principles

1. One number, one sentence per screen.
2. Calm over clever: status in words as well as colour, never a red alarm.
3. Honest data: never show a half-empty month as real; say what is not known.
4. The owner keeps control: nothing is deleted or changed without a clear action, and everything can be exported.

## Accessibility & Inclusion

WCAG AA contrast (tested), 44px targets, visible focus, text alternatives for charts, reduced motion respected, works on a phone and a laptop in light and dark.
