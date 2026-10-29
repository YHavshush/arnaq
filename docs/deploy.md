# Deploying arnaq

Status: not deployed yet. This is the checklist for when it is. Do `docs/auth-setup.md` first (Supabase
settings, the app's database role, the migration). Nothing here contains a secret.

## What the app needs

| Variable                   | What                                                                                                                                     | Where it comes from                                 |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `SUPABASE_URL`             | the project URL                                                                                                                          | Supabase > Project Settings > API                   |
| `SUPABASE_PUBLISHABLE_KEY` | the publishable key (`sb_publishable_...`), never a secret or service_role key                                                           | same page                                           |
| `DATABASE_URL`             | the pooler string for the restricted role `kasboek_app`                                                                                  | `scripts/db-app-role.sh` writes it to `.env.hosted` |
| `APP_URL`                  | the address the app is served from, e.g. `https://kasboek.example`; redirects and the cross-site check use it instead of the Host header | your own address; leave unset on a local machine    |
| `KASBOEK_AI_USERS`         | optional: user ids that may use arnaq AI                                                                                               | Supabase > Authentication > Users                   |
| `ANTHROPIC_API_KEY`        | only when the Claude provider exists; server side only                                                                                   | console.anthropic.com, with a spend limit           |

The app refuses to run over a database role that bypasses row level security (it says so and serves
nothing), and refuses to start in production without `DATABASE_URL`. Never set `KASBOEK_DEV_AUTH` anywhere
but a local development machine.

## Vercel (the least work)

1. Put the code in a private GitHub repository (the real bank files and `.env*` are already git-ignored).
2. In Vercel: Add New > Project > import the repository. Framework: Next.js (detected).
3. Settings > Environment Variables: add the variables above for Production.
4. Deploy. Then in Supabase > Authentication > URL Configuration set the Site URL and the redirect URL to
   the Vercel address, and use the email templates from `docs/auth-setup.md`.
5. Smoke test: register, confirm the email, upload a file, check you only see your own data (register a
   second account and look).

The free Hobby plan is for personal, non-commercial use. A request body larger than the platform's limit
(a few MB) is refused before the app sees it; the app's own limit for statements is 4 MB (Vercel refuses request bodies above 4.5 MB).

## Hetzner (more control, more upkeep) — untested outline

A small VPS in Germany or Finland (close to the Supabase region eu-central-1). Install Node 22, build with
`npm ci && npm run build`, run `npm start` behind Caddy or nginx for HTTPS, keep the variables in a root-only
file used by the service, restart on boot (systemd). You own updates, backups of the server and the
firewall. Check this outline against a real server before relying on it.

## Content-Security-Policy

In production the app sends the policy in `src/lib/csp.ts` as **report-only**: the browser logs what it would
block to its developer console but blocks nothing. After the first deploy, open every page signed in (and
the sign-in pages) with the console open; if there are no "Content-Security-Policy" messages, set
`CSP_MODE=enforce`. If something is blocked, fix the policy (or the page) first. It is off in development.

## Before opening it to other people

See "Open points from the security review" in `docs/plans/auth-tenancy.md`: CAPTCHA and rate limits per
IP and per email, a fixed `APP_URL` for redirects, asking for the current password, a privacy notice and a
data processing agreement with Anthropic before arnaq AI is offered, and account deletion.

## After deploying

- Turn on Supabase's daily backups (paid plan) and keep an occasional export from Settings.
- Watch the platform's logs; the app logs counts and codes, never merchant names, amounts or keys.
- CI (`.github/workflows/ci.yml`) runs types, lint, tests, the build and `npm audit` on every push.
