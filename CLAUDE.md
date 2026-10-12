# CLAUDE.md RULES

- Stack: Next.js (App Router) + TypeScript + Tailwind + shadcn/ui + Postgres via Drizzle (PGlite locally and in tests, Supabase when hosted). Local first.
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

## Orchestration (ECC)

- Vendored ECC subset lives in `.claude/` (see `.claude/ecc/README.md`). Pipeline per milestone: size it, plan (planner), TDD (tdd-guide), review (code-reviewer, plus security-reviewer when auth, input handling, DB queries, file paths or secrets are touched), then conventional commits. Details: `.claude/skills/orch-pipeline/SKILL.md`.
- The two human gates (plan, commit) are self-checked and logged in the milestone summary while the go-ahead above is active. CRITICAL/HIGH review findings must be fixed before merging.
- Hard logic (milestones 4 and 5, final security review) runs on Opus subagents; the agent definitions in `.claude/agents/` are the briefs.

## Decisions added 2026-10-11

- **Database target is Supabase (Postgres).** The user sets up the Supabase project later. Until then keep everything Postgres-portable: no new SQLite-only SQL, money as integers (bigint in Postgres), no reliance on synchronous DB calls in new code. The `feat/postgres-port` milestone is done: all DB code is async Drizzle on Postgres (PGlite locally and in tests, postgres-js for Supabase). Always `await` DB calls (ESLint enforces it), use `tx` inside `db.transaction`, and test with `createDb(":memory:")`. Milestone 9 becomes Supabase + app hosting + Supabase Auth; enable RLS (deny all) on every table because Supabase exposes `public` over its REST API.
- **The user has final say on the look of the app.** Milestone 6 produces vastly different design variants (UI UX Pro Max to generate, Impeccable principles to critique and iterate), shown as mock screens with demo data. Present one final, or 2-3 only when they are genuinely different. Do not build the dashboard (milestone 7) before the user picks.

## Design system (milestone 6, done)

- The design is in `DESIGN.md`; colour tokens are generated from `src/design/tokens.ts` (`npm run tokens`). Do not invent new colours or styles in components: use the tokens and shadcn variables.
- UI UX Pro Max is vendored in `.claude/skills/ui-ux-pro-max/` as an idea bank. Impeccable is installed at milestone 8, not before.
- Hard rule: never put a CSS `filter` on an SVG element (iPhone Safari clips it).
