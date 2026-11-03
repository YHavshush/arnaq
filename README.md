# arnaq

arnaq is a personal budget tracker. Upload a bank file per month (CSV or TXT from Rabobank, Revolut, ABN AMRO, ING or Knab, or a Rabobank PDF statement), see budget vs actual, manage your fixed costs and income, and get an adjustable forecast. English and Dutch. See [PLAN.md](PLAN.md) for the full plan and [CLAUDE.md](CLAUDE.md) for repo rules.

**Stack:** Next.js (App Router) · TypeScript · Tailwind · shadcn/ui · Postgres via Drizzle ORM (PGlite locally, Supabase when hosted) · Vitest

## Run locally

Requires Node 22+.

```bash
npm install
npm run dev          # http://localhost:3000
```

No database server needed: the app runs a real Postgres in-process ([PGlite](https://pglite.dev)) and keeps it in `data/pglite/` (git-ignored). It migrates and seeds itself on first start.

## Scripts

| Script                            | What it does                               |
| --------------------------------- | ------------------------------------------ |
| `npm run dev`                     | Start the dev server                       |
| `npm run build` / `npm start`     | Production build / serve it                |
| `npm test` / `npm run test:watch` | Run Vitest once / in watch mode            |
| `npm run lint`                    | ESLint                                     |
| `npm run format` / `format:check` | Prettier write / check                     |
| `npm run typecheck`               | TypeScript without emitting                |
| `npm run db:generate`             | Generate a migration after schema edits    |
| `npm run db:migrate`              | Migrate a hosted Postgres (`DATABASE_URL`) |
| `npm run db:studio`               | Browse the database in Drizzle Studio      |

## Database

Schema is in [src/db/schema.ts](src/db/schema.ts); migrations are in `drizzle/`. After changing the schema run `npm run db:generate` and commit the new migration. Money is stored as integer cents (`bigint`, read as a JS number), dates as ISO strings (`YYYY-MM-DD`, months as `YYYY-MM`). Every table has row level security switched on with no policies (deny all), so Supabase's REST API exposes nothing; a test fails if a new table forgets it.

All database access is async (`await`); ESLint fails on a forgotten `await`.

### Using Supabase

The Supabase project **kasboek** (ref `vdjqqidkoputigxxeqoz`, Frankfurt, free plan) exists and already has the schema (migrations 0000 to 0002 applied and registered, so `db:migrate` finds nothing left to run but still seeds the default categories). `anon` and `authenticated` have no privileges on `public`. Never put the `service_role` key in the app or the browser: it bypasses RLS.

1. Create a project at supabase.com and copy the **direct** connection string (Project settings, Database). Use the pooled one (port 6543) for the running app.
2. Migrate once with the direct string:

   ```bash
   DATABASE_URL='postgres://postgres:<password>@db.<ref>.supabase.co:5432/postgres?sslmode=require' npm run db:migrate
   ```

3. Start the app with `DATABASE_URL` set to the pooled string. The app never changes a hosted schema by itself; `db:migrate` does that.

In production the app refuses to start without `DATABASE_URL` (set `KASBOEK_ALLOW_LOCAL_DB=1` only if you really want PGlite there), and a value that looks like a URL but is not `postgres://` is rejected. Connections to a non-local host use TLS. Also switch on "Enforce SSL" in the Supabase project.

Keep the password out of the repo (`.env*` is git-ignored). The app connects as the `postgres` role, which bypasses RLS; the public `anon` and `authenticated` roles see nothing.

## Accounts and privacy

Several people can have an account, and each sees only their own data. This is enforced by the database, not just by the code: every table has an owner (`user_id`) and a row level security policy, and the app connects as a role (`kasboek_app`) that cannot bypass it. Each request runs as one user in one transaction (`userDb` in `src/lib/auth/request.ts`); a query that runs without a user fails instead of showing data. Foreign keys include the owner, so a row can never point at another user's row. The design and its reasons are in [docs/plans/auth-tenancy.md](docs/plans/auth-tenancy.md); `src/app/api/tenancy.test.ts` proves isolation through every route and loader.

- **Local development without sign-in:** `npm run dev` sets `KASBOEK_DEV_AUTH=1`, which signs you in as one development user. It only works with `next dev` on the local database; a hosted database or a production build ignores it. `npm run seed:demo` fills that user's data.
- **Rows from before accounts existed** belong to a sentinel owner nobody can see. Move them to a real user with `DATABASE_URL=<direct connection as postgres> npm run db:claim -- <user id>`.
- App code must not import `@/db/admin` (ESLint and a test enforce it).
- **Real sign-in** is Supabase Auth (email and password, email confirmation, password reset). Setup for the hosted project: [docs/auth-setup.md](docs/auth-setup.md). To try it locally, run `npx next dev` (without the dev bypass; `.env.local` holds the public Supabase values).

## Language

The app is in English by default with Dutch as the second language. The choice (the language button in the top bar) is stored in a cookie. Texts live in `src/i18n/messages/{en,nl}/`: English is the source and Dutch must have exactly the same shape (the compiler and a test check it). Amounts, dates and month names follow the language (`src/lib/view/format.ts`). Server messages (validation, import) are English in the code and translated to Dutch at the API edge (`src/i18n/server-messages.ts`). The default category names are stored in Dutch and shown in English via a label map (`categoryLabel`). To add a language: add it to `LOCALES`, copy `messages/en`, translate, and add a label map and server-message rules.

## Bank files

- **Revolut:** the CSV export. The period is read from the file name Revolut gives it.
- **ING:** "Alle afschriften" as CSV (comma or semicolon). **Knab:** the CSV export (semicolon). **ABN AMRO:** the TXT export (tab separated, no header), or the same columns with a header row. Built from the documented layouts and invented samples, **not yet checked against real files**. PDF statements are only read for Rabobank.
- **Rabobank:** the PDF statement ("Rekeningafschrift"). It is read locally (no upload to anything else) and only accepted when the transactions add up to the totals and balances printed on the statement; otherwise nothing is imported. A Rabobank CSV is also supported but unverified against a real export.
- A month only counts as uploaded ("actual" in the forecast) when a statement covers all of it. A statement that stops mid-month leaves that month open.

## Data safety

Real bank CSVs and the database are never committed. Only anonymised samples go in [tests/fixtures/](tests/fixtures/).

## API

| Endpoint                                                 | Purpose                                                                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `POST /api/import`                                       | Upload a bank CSV or TXT, or a Rabobank PDF statement (`file`, optional `accountId`, `month`). Re-uploads are safe |
| `GET/POST /api/accounts`                                 | List or create accounts                                                                                            |
| `GET /api/categories`                                    | Categories                                                                                                         |
| `GET/POST /api/rules`, `DELETE /api/rules/:id`           | Categorisation rules                                                                                               |
| `GET /api/review`                                        | Transactions needing a category (or in a foreign currency)                                                         |
| `PUT /api/transactions/:id/category`                     | Set a category, optionally learning a rule                                                                         |
| `GET /api/overview?month=YYYY-MM`                        | Budget vs actual for a month                                                                                       |
| `GET/PUT /api/budgets`                                   | Budgets per category per month                                                                                     |
| `PUT /api/budgets/total`, `POST /api/budgets/copy`       | Optional total budget, copy a month's budgets                                                                      |
| `GET/POST /api/recurring`                                | List or create vaste lasten / inkomen (amounts in cents)                                                           |
| `GET/PATCH/DELETE /api/recurring/:id`                    | One item with its occurrences; update (`active: false` stops it); hard delete                                      |
| `GET /api/recurring/occurrences?from=YYYY-MM&to=YYYY-MM` | Occurrences with status and, when matched, the real amount                                                         |
| `GET /api/recurring/missed`                              | Missed occurrences for review, most recent first                                                                   |
| `GET /api/recurring/suggestions`                         | Suggested recurring items from past transactions                                                                   |
| `POST /api/recurring/suggestions/accept`, `.../reject`   | Accept (creates the item) or reject (never offered again)                                                          |
| `GET /api/forecast?months=6&history=3&pastMonths=3`      | Prognose: actual, current (mixed) and forecast months; read-only                                                   |

Forecast semantics (month kinds, no double counting, variable-spend averages and rounding) are documented in [docs/plans/m5-forecast.md](docs/plans/m5-forecast.md).

## Design

See [DESIGN.md](DESIGN.md). Prototypes and their private links are listed in [docs/design/README.md](docs/design/README.md).
