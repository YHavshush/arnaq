# Multi-user accounts and tenancy: plan

Decided 2026-10-12 with the owner: register, log in, log out, forgot/reset password and email
confirmation (Supabase Auth); **multiple users, each with only their own data**. Designed by an Opus
architect pass; this file is the plan of record. Verify assumptions marked (A) with a spike.

## Enforcement: Postgres RLS driven by a per-request setting

- The app connects as a dedicated role `kasboek_app` (LOGIN, NOSUPERUSER, NOBYPASSRLS, does not own the
  tables). `postgres` is only used by `db:migrate` (direct connection). Production reaches `kasboek_app`
  through the pooler (port 6543, `prepare: false`, user `kasboek_app.<project-ref>`). (A)
- Every request runs `withUser(root, uid, fn)`: one transaction that does
  `select set_config('app.user_id', uid, true)` (transaction-local), seeds the user's defaults once, then
  runs `fn(tx)`. Library code keeps taking `Db`.
- `user_id uuid not null default app.uid()` on every table; `app.uid()` raises 42501 when the setting is
  absent, so a code path without the wrapper fails closed (500, never a leak). Policies:
  `user_id = (select app.uid())` for USING and WITH CHECK, granted to `kasboek_app` only.
- The root handle is not importable from `src/app` or `src/lib` (ESLint `no-restricted-imports`).
- Cross-tenant integrity: every foreign key is composite `(user_id, x_id) references x(user_id, id)`.

## Schema (migration 0003)

`app_users(user_id pk, created_at, seeded_at)`; all 10 tables get `user_id` referencing it (cascade).
Unique constraints become per user: categories `(user_id, name)`, transactions `(user_id, import_hash)`,
rejections `(user_id, key, type)`, budgets PK `(user_id, category_id, month)`, monthly_total_budget PK
`(user_id, month)`, accounts partial unique `(user_id, iban)`. Existing rows go to a sentinel owner
(all-zero uuid); `npm run db:claim -- <uuid>` moves them. No claim-on-first-login.

## Auth (Supabase Auth, server side only)

`@supabase/ssr` + `supabase-js`, publishable key, httpOnly cookies. `proxy.ts`: CSRF guard for all
non-GET, session refresh via `getClaims()`, redirect pages to `/login?next=`, 401 for `/api`. The real
guard is `userDb()` in the data layer. Pages: `/login`, `/register`, `/forgot-password`,
`/reset-password`, `/auth/confirm` (GET shows a button, POST verifies the token so mail scanners cannot
burn it), POST `/auth/logout`. `next` must be a same-origin path. Email templates link to
`/auth/confirm?token_hash=...`. New users are seeded lazily inside `withUser`.

## Local development and tests

`KASBOEK_DEV_AUTH=1` returns a fixed dev user, only when `NODE_ENV=development` and the database is not
`postgres://`. Tests mock the session (`setTestUser`) and run under the same role and policies; a
tenancy suite proves user B can read or change nothing of user A through every route and loader.

## Build order

0. Spike: PGlite roles/RLS/dump, pooler custom role, `set_config` isolation, `getClaims()` local verify.
1. `feat/tenancy-db`: migration 0003, schema, role + session user in `createDb`, `withUser`, seed per user, conflict targets, `db:claim`. Gate: existing tests green.
2. `feat/tenancy-wire`: session/request helpers, all routes/pages/shell use `userDb()`, lint rule, tenancy suite.
3. `feat/auth`: proxy, Supabase clients, auth pages (en/nl), confirm/logout, user menu.
4. Hosting config: apply 0003, set the `kasboek_app` password by hand, switch `DATABASE_URL`, claim or delete sentinel rows; Supabase: site URL, redirect allowlist, SMTP, templates, signing keys, CAPTCHA, rate limits, Data API off.
5. Opus security review before hosting.

## Risks

Code path without RLS; PGlite role/RLS differences; composite keys vs conflict targets; cached user data
or a leaking setting through the pooler; email flow pitfalls (SMTP limits, scanners, open redirect).

## Open points from the security review (2026-10-12)

Fixed in `feat/auth`: the app refuses to serve over a connection that is not the restricted `kasboek_app`
role (`assertTenantRole`); a confirmation link no longer leaves the browser signed in (the person signs
in with their own password; the reset page names the account); sign-out always clears the session
cookies; anonymous sessions are refused; only the token types the email templates use are accepted.

Done since: "Delete my data" in Settings (all of a person's data; the login itself is removed in Supabase,
because the app never holds an admin key). Security headers (nosniff, frame deny, referrer, permissions
policy) are set; a CSP still needs a nonce setup.

Done since: limits per address and per email on sign in, register and forgot password (`src/lib/auth/rate-limit.ts`,
in memory per instance, so it slows an attacker down but does not stop a determined one; the address comes
from `x-forwarded-for`, which only means something behind a proxy you trust).

Done since: `APP_URL` (redirects and the cross-site Origin check no longer depend on the Host header when it is set;
set it in production).

Done since: changing the password in Settings asks for the current one (checked by signing in again, under the
same limits as sign in).

Drafts of a privacy notice and terms are in `docs/legal/` (marked DRAFT; the owner and then a lawyer must read them).

Done since: a Content-Security-Policy (no script nonce because of partial prerendering, so scripts allow
`unsafe-inline`; everything else is closed). It is report-only in production until checked on the real deployment.

Done since: CAPTCHA (Cloudflare Turnstile) on sign in, register, forgot password and change password
(`src/components/arnaq/turnstile.tsx`, `src/lib/auth/captcha.ts`). It is off until `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is set. To
switch it on: create a Turnstile widget in Cloudflare (hostnames: the production domain), put the site key in
`NEXT_PUBLIC_TURNSTILE_SITE_KEY` on Vercel, put the secret under Supabase > Authentication > Attack Protection (CAPTCHA,
Turnstile), then redeploy. Do both together: with only the Supabase side on, nobody can sign in. The CSP allows
challenges.cloudflare.com only while the site key is set.

Not done yet, needed before registration is opened to strangers:

- The limits in `rate-limit.ts` live in the memory of one instance. On Vercel (many short-lived instances) they slow an
  attacker down very little. CAPTCHA now carries most of the weight; a shared store (a Postgres table or Vercel's
  firewall rate limit rule) would make the limits real.
- The CSP is report-only in production until `CSP_MODE=enforce` has been checked on the real deployment.
- Row ids are global serials, so a user can see how many rows other users create (no contents). Accepted.
