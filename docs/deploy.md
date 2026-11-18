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
| `KASBOEK_AI_USERS`         | optional: user ids that may use arnaq AI                                                                                                 | Supabase > Authentication > Users                   |
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

## Linking banks with Enable Banking

arnaq can read the owner's own bank accounts through [Enable Banking](https://enablebanking.com), a licensed PSD2
account-information service, instead of uploading files. It only reads (transactions and balances); it can never
move money. It is off until the variables below are set; without them Settings explains that linking is not set
up and the banking routes answer 503.

| Variable                        | What                                                                                                      |
| ------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `ENABLE_BANKING_APPLICATION_ID` | the application id (a UUID) the Enable Banking control panel shows after you upload the certificate       |
| `ENABLE_BANKING_PRIVATE_KEY`    | the application's RSA private key, PEM; one line with literal `\n` for the line breaks is fine. A secret. |
| `ENABLE_BANKING_API_URL`        | optional; default `https://api.enablebanking.com`. Only for a test server (https, or http on localhost).  |
| `APP_URL`                       | required for linking: the bank sends the person back to `${APP_URL}/api/banking/callback`                 |

Never commit the key or put it in a `NEXT_PUBLIC_` variable. It stays on the server: `src/lib/banking/enable-banking.ts`
signs a short-lived token (RS256, one hour) for every call, never stores or logs the key or the token, and refuses to
load in a browser (ESLint and `src/lib/banking/client-guard.test.ts` keep browser code from importing it).

Steps for the owner, in order:

1. Make the key and certificate (as the Enable Banking docs say): `openssl genrsa -out private.key 2048` and
   `openssl req -new -x509 -days 3650 -key private.key -out public.crt`. Keep `private.key` out of the repository
   (`*.key` belongs in a password manager, not in git).
2. In the Enable Banking control panel, register a **sandbox** application first with `public.crt`. Redirect URL:
   `http://localhost:3000/api/banking/callback` (and set `APP_URL=http://localhost:3000` locally). Put the two
   variables in `.env.local` and try linking a sandbox bank in Settings.
3. Register a **production** application for your own accounts (Enable Banking's free "restricted" mode). Redirect
   URL: `${APP_URL}/api/banking/callback` with the real address, exactly as `APP_URL` is set.
4. Restricted mode only reads accounts you have linked to the application yourself: in the control panel, link
   your own accounts (Rabobank, Revolut, ...). Until then linking in arnaq says no accounts are linked.
5. Set `ENABLE_BANKING_APPLICATION_ID` and `ENABLE_BANKING_PRIVATE_KEY` in the host's environment (Production only)
   and redeploy. Then in arnaq: Settings > Bank connections > Link a bank, agree at the bank, and you are back in
   Settings; the first refresh fetches the last 90 days.

How it behaves:

- Only Rabobank, Revolut, ABN AMRO, ING and Knab can be linked (the banks arnaq knows, `BANKS` in
  `src/db/schema.ts`); others are not offered. Personal accounts only.
- A linked account goes into the arnaq account with the same IBAN (a Revolut upload has no IBAN: the one Revolut
  account is used), otherwise into a new one. Rows the account already holds from an uploaded file are not stored
  twice.
- "Refresh now" fetches booked transactions since a week before the last refresh. There is no background sync.
- The consent lasts the bank's maximum, at most 180 days; Settings offers "Reconnect" from 14 days before it ends.
- "Disconnect", "Delete my data" and restoring a backup end the consent at Enable Banking. A backup holds no bank
  links: after a restore, link again.

Privacy: with a bank linked, Enable Banking (and through it the bank) processes the account data on arnaq's behalf.
It is named as a processor in `docs/legal/privacy-notice-DRAFT.md`.

Network and CSP: every call to Enable Banking is made by the server, so the browser's `connect-src 'self'` is
unaffected. The browser only navigates to the bank's consent page (a top-level navigation, which the CSP does not
restrict). Bank logos from the list are not shown (they would need `img-src` for another host).

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
