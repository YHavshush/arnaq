# Budget Tracker

Personal budget tracker: upload one CSV per bank per month (Rabobank, Revolut), see budget vs actual, manage vaste lasten and inkomen, and get an adjustable prognose. See [PLAN.md](PLAN.md) for the full plan and [CLAUDE.md](CLAUDE.md) for repo rules.

**Stack:** Next.js (App Router) · TypeScript · Tailwind · shadcn/ui · SQLite via Drizzle ORM · Vitest

## Run locally

Requires Node 22+.

```bash
npm install
npm run db:migrate   # creates data/budget.db and applies migrations
npm run dev          # http://localhost:3000
```

The database lives in `data/budget.db` (git-ignored). Set `DATABASE_URL` to use another path.

## Scripts

| Script                            | What it does                            |
| --------------------------------- | --------------------------------------- |
| `npm run dev`                     | Start the dev server                    |
| `npm run build` / `npm start`     | Production build / serve it             |
| `npm test` / `npm run test:watch` | Run Vitest once / in watch mode         |
| `npm run lint`                    | ESLint                                  |
| `npm run format` / `format:check` | Prettier write / check                  |
| `npm run typecheck`               | TypeScript without emitting             |
| `npm run db:generate`             | Generate a migration after schema edits |
| `npm run db:migrate`              | Apply migrations to the local database  |
| `npm run db:studio`               | Browse the database in Drizzle Studio   |

## Database

Schema is in [src/db/schema.ts](src/db/schema.ts); migrations are in `drizzle/`. After changing the schema run `npm run db:generate`, then `npm run db:migrate`. Money is stored as integer cents, dates as ISO strings (`YYYY-MM-DD`, months as `YYYY-MM`).

## Data safety

Real bank CSVs and the database are never committed. Only anonymised samples go in [tests/fixtures/](tests/fixtures/).

## API

| Endpoint                                                 | Purpose                                                                       |
| -------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `POST /api/import`                                       | Upload a CSV (`file`, optional `accountId`, `month`). Re-uploads are safe     |
| `GET/POST /api/accounts`                                 | List or create accounts                                                       |
| `GET /api/categories`                                    | Categories                                                                    |
| `GET/POST /api/rules`, `DELETE /api/rules/:id`           | Categorisation rules                                                          |
| `GET /api/review`                                        | Transactions needing a category (or in a foreign currency)                    |
| `PUT /api/transactions/:id/category`                     | Set a category, optionally learning a rule                                    |
| `GET /api/overview?month=YYYY-MM`                        | Budget vs actual for a month                                                  |
| `GET/PUT /api/budgets`                                   | Budgets per category per month                                                |
| `PUT /api/budgets/total`, `POST /api/budgets/copy`       | Optional total budget, copy a month's budgets                                 |
| `GET/POST /api/recurring`                                | List or create vaste lasten / inkomen (amounts in cents)                      |
| `GET/PATCH/DELETE /api/recurring/:id`                    | One item with its occurrences; update (`active: false` stops it); hard delete |
| `GET /api/recurring/occurrences?from=YYYY-MM&to=YYYY-MM` | Occurrences with status and, when matched, the real amount                    |
| `GET /api/recurring/missed`                              | Missed occurrences for review, most recent first                              |
| `GET /api/recurring/suggestions`                         | Suggested recurring items from past transactions                              |
| `POST /api/recurring/suggestions/accept`, `.../reject`   | Accept (creates the item) or reject (never offered again)                     |
| `GET /api/forecast?months=6&history=3&pastMonths=3`      | Prognose: actual, current (mixed) and forecast months; read-only              |

Forecast semantics (month kinds, no double counting, variable-spend averages and rounding) are documented in [docs/plans/m5-forecast.md](docs/plans/m5-forecast.md).

## Design

See [DESIGN.md](DESIGN.md). Prototypes and their private links are listed in [docs/design/README.md](docs/design/README.md).
