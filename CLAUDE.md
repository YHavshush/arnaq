# CLAUDE.md RULES

- Stack: Next.js (App Router) + TypeScript + Tailwind + shadcn/ui + SQLite via Drizzle. Local first, hosted later on a Hetzner server via Docker.
- Money is stored as integer cents, never floats.
- Never commit real bank CSVs or the database. Only anonymised files in tests/fixtures/.
- One branch per milestone (feat/<name>), conventional commits (feat:, fix:, chore:, test:).
- Write tests alongside each milestone, especially import, matching and forecast.
- Never start the next milestone without my go-ahead.
- UI UX Pro Max sets the design direction once (milestone 6). Impeccable polishes at the end (milestone 8). Do not install design skills before then.
- Model guidance: at the start of each milestone, tell me which model fits it (Haiku 5.5, Sonnet 5.5 or Opus 5.5), using the table below. If a task mid-session needs a higher model, tell me immediately. If I keep asking simple things and the current model is heavier than needed, tell me that too. I switch models with /model.

Model table:

- Haiku 5.5: renames, formatting, README and doc tweaks, small copy or CSS changes, running tests and fixing lint errors.
- Sonnet 5.5 (default): most building work. Milestones 1, 2, 3, 6, 7, 8, 9.
- Opus 5.5: milestones 4 and 5 (matching engine, suggestion detection, forecast logic), hard debugging that Sonnet is stuck on, architecture decisions, and a final security review before hosting.

- Go-ahead given on 2026-10-11 to run milestones 2 to 9 in sequence without pausing between them. Still summarise each milestone when done.
