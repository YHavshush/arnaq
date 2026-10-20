# Architecture (the target, and where we are)

```
CLAUDE CODE (local CLI)
      |  writes the code and the database migrations (Drizzle)
      v
GITHUB (private: YHavshush/budget-app) --(auto deploy)--> VERCEL (hosts the Next.js app)
                                                              |
                                                              |  server side SQL (pooler) + Auth
                                                              v
                                              SUPABASE (Postgres + Auth, region eu-central-1)
```

## Where we are (2026-10-20)

| Part                         | State                                                                                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Claude Code writes the code  | done                                                                                                                                                                     |
| GitHub                       | done, private repo `YHavshush/budget-app`, `main` pushed                                                                                                                 |
| GitHub to Vercel auto deploy | not connected yet (see `docs/deploy.md`)                                                                                                                                 |
| Vercel hosts the app         | not yet                                                                                                                                                                  |
| Supabase Postgres and Auth   | done: project `kasboek`, migrations 0000 to 0005, row level security on every table. Dashboard settings (Site URL, mail templates) still to do, see `docs/auth-setup.md` |

## How it differs from the first sketch, on purpose

- **Schema changes** are Drizzle migrations (`drizzle/`), applied by hand to the hosted database (a script or the
  Supabase MCP), not through the Supabase CLI. Automatic migrations on deploy would put the database owner role in
  GitHub as a secret; keep them manual until that is worth it.
- **No Edge Functions:** the server side lives in Next.js on Vercel.
- **No Realtime or REST:** the app talks SQL to the database through the pooler as the restricted role `kasboek_app`
  (row level security decides who sees what). The Data API stays switched off.
