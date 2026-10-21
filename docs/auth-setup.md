# Going live with accounts: what to set up in Supabase

The code is finished and tested (see `docs/plans/auth-tenancy.md`). These steps are settings only the
project owner can make, in the Supabase dashboard of the project `kasboek`, plus one command each for the
database. Do them in this order. Nothing here is committed with a secret.

## 1. Auth settings (dashboard)

**Authentication > URL Configuration**

- Site URL: the address the app is served from (`http://localhost:3202` for the local test server,
  your real address once it is hosted).
- Redirect URLs: the same address.

**Authentication > Sign In / Providers > Email**

- Email provider on, **Confirm email** on.
- Minimum password length **10** (the app also requires 10).
- If available on your plan: block leaked passwords.

**Authentication > Emails > Templates.** The links must go to our confirmation page, which only shows a
button (so a mail scanner that opens the link cannot use the token up). Use these.

Confirm signup:

```html
<h2>Confirm your email address</h2>
<p>Press the button to finish creating your arnaq account.</p>
<p>
  <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/"
    >Confirm email address</a
  >
</p>
```

Reset password:

```html
<h2>Choose a new password</h2>
<p>
  Press the button to choose a new password for your arnaq account. If you did not ask for this,
  ignore this email.
</p>
<p>
  <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery"
    >Choose a new password</a
  >
</p>
```

**Authentication > Emails > SMTP Settings.** Supabase's built-in sender only mails members of your own
team and is limited to a couple of emails per hour. For anyone else to register, set up your own SMTP
provider here.

**Authentication > Attack Protection.** Do NOT switch on CAPTCHA yet: the forms do not send a CAPTCHA token
yet, so it would block every sign-in and registration. Also note that every auth call comes from the
server's address, so Supabase's per-IP limits are one shared bucket for all visitors: one person
hammering "forgot password" can lock everyone out and use up the email quota. Before opening
registration to strangers, add Turnstile to the forms (pass `options.captchaToken`) and per-IP and
per-email limits in the app (see "Open points" in `docs/plans/auth-tenancy.md`). Until then, keep
registration to people you know (Authentication > Sign In / Providers > "Allow new users to sign up" off
after your friends have registered).

**Authentication > Sign In / Providers.** Keep "Allow anonymous sign-ins" OFF (the app also refuses
anonymous sessions) and turn on "Secure password change" so a password change needs a recent sign-in.

**Project Settings > JWT Keys.** Use the asymmetric signing keys (so the app can verify a session without
calling Supabase) and a short expiry, for example 900 seconds, so signing out and password resets take
effect quickly.

**Project Settings > API (Data API).** The app never uses the REST API. Switch it off, or at least do not
expose the `public` schema.

## 2. The app's database role

The migration creates the role `kasboek_app` without a login. Give it one, with a password only you know,
in **SQL Editor** (never in a migration or a file):

```sql
alter role kasboek_app login password '<a long random password>';
```

The app connects as this role through the pooler (**Connect > Session pooler or Transaction pooler**; user
`kasboek_app.<project-ref>`). It cannot bypass row level security and does not own the tables.

## 3. Apply the migration and claim the existing data

The data uploaded before accounts existed becomes owned by a placeholder nobody can sign in as.

1. Migrate (as `postgres`, with the direct or session-pooler string):
   `scripts/db-migrate-hosted.sh` (it asks for the connection string without showing it).
2. Register your own account in the app and confirm the email.
3. Copy your user id (**Authentication > Users**), then move the old data to it:
   `DATABASE_URL=<postgres connection> npm run db:claim -- <user id>`. If the old data was only test
   data, delete it instead and start clean.

## 4. Environment of the running app

| Variable                   | Value                                                                             |
| -------------------------- | --------------------------------------------------------------------------------- |
| `SUPABASE_URL`             | `https://<project-ref>.supabase.co`                                               |
| `SUPABASE_PUBLISHABLE_KEY` | the `sb_publishable_...` key (Project Settings > API Keys). Never the secret key. |
| `DATABASE_URL`             | the `kasboek_app` pooler string, with `?sslmode=require`                          |

Never set `KASBOEK_DEV_AUTH` on a server; it is ignored there anyway.

## 5. Check it

- Signed out, open `/`: you land on the login page. `curl /api/review` answers 401.
- Register a second account: it sees none of the first account's data.
- Sign out (Settings > Account) and sign in again.
