# Progress log

Newest first. Decisions, research and state of the project that are not obvious from the code.

## Open decisions and todos

- **Light-mode ring glow: decided A (no glow), 2026-10-16, to be applied in the UI alignment pass.** The
  owner asked for a decision based on current design practice. Reasons: 2026 guidance is restraint (glass
  and effects as accents, legibility first, calm fintech UIs with a clear hierarchy); a status-coloured
  shadow repeats what the ring colour already says, and `DESIGN.md` already treats a third status signal
  as noise (the status wash was removed in light for that reason); depth already comes from the glass
  cards; no Safari or hairline-gap risk. Close call: the research says nothing specific about ring glows.
  Keep the switch in one place (`src/components/kasboek/ring.tsx`, the light shadow element, and
  `glowStyle` in `tokens.ts`) so F can come back. Comparison page: `docs/design/ring-f-vs-a.html`.
  Related finding for the same pass: the light end of the ring gradients (for example `#8fe0bd`) is far
  below 3:1 against the page (WCAG non-text contrast); darken the light end of each light gradient.

## UI alignment pass (started 2026-10-16, owner approved the Prognose advice)

Method: per screen, app and the final mockup (`docs/design/ontwerp-v14.html`) side by side, a recommendation
per difference, the owner chooses. Not copied blindly. Order: Prognose, Overzicht, Vaste lasten, Upload,
then the dark themes.

- **Prognose: done** (branch `feat/ui-prognose`): ring without glow in light and exactly on its edge (the
  thin line is gone); sans number that shrinks to fit; ring left and sentence right on a laptop; sentence
  and explanation as in the mockup; chart with a smooth line, a soft fill and the dashed forecast, total
  above and coloured growth below each month, Total or Per month; month detail with coloured Growth;
  list of all months; small print about what is not counted. One past month is shown (8 points), so every
  value fits. Screens: `docs/design/compare/prognose-app-after-*.jpg`.
  Deviation from the mockup: the mockup shows a bank saldo; the app has no balances yet, so it shows growth
  since the first month shown (see the note in `DESIGN.md`). Storing balances is a backlog item.
- **Fixed costs: done 2026-10-16** (branch `feat/ui-fixed-costs`): Expenses and Income stay separate; every
  row has a status label (green with a check for paid, blue for due, rose for missed); what still needs
  paying comes first, paid rows below.
- **Upload: keep as is.** Report real problems first, change nothing silently.
- **Overzicht: done 2026-10-16** (branch `feat/ui-overzicht`, all advice approved). Explanation under the
  sentence; attention list with actions; tiles Budget, Fixed costs, Savings, Income ("To sort" moved to the
  attention list); "Pace of the month" card (schedule tick, one bar per day, days above a threshold numbered);
  "Where it went" with the top 5 and a link to all categories (bars by meaning: paid fixed cost green, fixed
  cost to come grey, over budget red); Income and Coming up lists; two columns on a laptop; footnote. The
  title stays "Overview" with the month above it (kept from the app, as advised). Screens:
  `docs/design/compare/overzicht-app-after-*.jpg`. Savings is found by the default category name
  ("Sparen & beleggen"); if someone renames it the tile shows "Nothing yet" (category slugs, planned in
  `docs/plans/smart-categorisation.md`, will fix that).
- **Open owner decision: ring contrast.** The light ring colours are decorative and far below 3:1 against
  the page (best end of blue 2.3, green 2.5, warm 2.0; light ends about 1.1 to 1.5). Reaching 3:1 would
  need much darker rings and change the approved pastel look. The information is also in the text, so
  nothing depends on the ring colour alone. Decide: keep, or darken the strong end only.

Parked until this is done: smart categorising (branch `feat/smart-categorising`, slice 1 of 8 committed,
migration 0004 not applied to Supabase; plan in `docs/plans/smart-categorisation.md`), then milestone 9
(hosting).

## 2026-10-12: Research, "Sign in with ChatGPT" as an AI option

**Why we looked.** Idea from the owner: let a user who has ChatGPT connect their own plan for the smart
features (automatic categorising, later more), and for everyone else offer a paid tier where we call the
Claude API ourselves. Possible selling point: "bring your ChatGPT plan".

**What it is (OpenAI, announced in 2025, extended at DevDay on 2026-09-29).** Two separate things:

1. **Identity login.** OpenID Connect + OAuth 2.0 (Authorization Code with PKCE). The app gets a stable
   account id and, when available, name, email and picture. No access to the user's chats or API
   resources. Any ChatGPT user (also Free) can sign in, but only apps OpenAI admits can offer it.
2. **Plan usage ("token sharing").** The user lets an app run eligible AI requests against their own
   ChatGPT Plus or Pro plan allowance instead of the developer's API key. The user sets a weekly cap per
   app and manages it in ChatGPT settings (Usage). The developer pays nothing for these requests.

**Technical shape** (from a developer write-up that reproduces the docs; verify before building):

- Issuer `https://auth.openai.com`, standard discovery document. Plan usage asks for the extra scopes
  `offline_access` and `resource.invoke` with the permission `chatgpt.tokens.use.direct`, resource
  `https://api.openai.com/v1`.
- Access token about 1 hour, refresh token about 30 days (rotated on each refresh).
- Eligible calls go to the Responses API with `store: false` and `stream: true`. No hosted tools
  (file search, code interpreter), no `temperature`/`max_output_tokens`. The model list depends on the
  user's account, so list it with the token instead of hard-coding a model.
- Errors to handle: `subscription_sharing_usage_limit_exceeded` (429), `..._user_not_eligible` (403),
  `..._invalid_user` (401, or `invalid_grant` on refresh = the user disconnected). OpenAI does not tell
  the app when a user disconnects. There is no automatic fallback to billing the developer.
- A "Manage usage" link to the user's ChatGPT usage settings is required in the UI.

**The catch for us (official docs).** At launch plan usage is available to open-source projects,
personal projects that run locally, and selected private apps. **Hosted multi-user web apps are not
covered**, and paid or remotely hosted apps must request access through OpenAI's waitlist/interest form
before offering it. Identity login is a limited trial for selected commercial partners. Kasboek is a
hosted multi-user app, so today it does not qualify. The owner running it locally for themselves would.

**Decision.** Build the AI layer behind a provider interface, so the source of the model can change without
touching the categorising logic:

| Provider                     | Who pays                                | When                                                        |
| ---------------------------- | --------------------------------------- | ----------------------------------------------------------- |
| Our Claude API (paid tier)   | We pay per call, the subscriber pays us | First, works today                                          |
| User's own ChatGPT plan      | The user, from their plan               | Only after OpenAI approves hosted use; request access early |
| Off (rules and history only) | Nobody                                  | Default, no data leaves the app                             |

- Apply for OpenAI's access (interest form) once the app is hosted and has real users to describe.
- Do not build the OAuth flow before approval: scopes, endpoints and terms are still in preview and
  secondary sources disagree on details.
- Whatever the provider: send only the merchant name and description, never amounts, dates or IBANs, and
  only when the user has switched it on.

**Sources.**

- OpenAI developer docs: [Sign in with ChatGPT quickstart](https://developers.openai.com/siwc/quickstart),
  [cookbook walkthrough](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt)
- OpenAI help center: [Using your ChatGPT plan in other apps and sites](https://help.openai.com/articles/20001542) (could not be fetched, 403; summarised by search)
- Secondary: [DEV Community write-up of the OAuth flow and plan usage](https://dev.to/hassann/sign-in-with-chatgpt-for-developers-the-oauth-flow-plan-usage-and-what-it-means-for-your-api-bill-48f7),
  [The New Stack](https://thenewstack.io/sign-in-with-chatgpt/),
  [TechCrunch, May 2025](https://techcrunch.com/2025/05/27/openai-may-soon-let-you-sign-in-with-chatgpt-for-other-apps/)

**Open questions.** Does OpenAI approve a small paid hosted app, and on what terms? Are plan-usage requests
allowed for categorising only, or only for chat-like products? What does a user see when their cap is hit
(we must degrade to "ask the user" quietly)?

## 2026-10-12: State of the project

- Milestones 1 to 8 done (import, matching, forecast, design system, dashboard, polish). English default,
  Dutch second.
- Supabase project `kasboek` live: migrations 0000 to 0003 applied, row level security on every table,
  app role `kasboek_app` with login. Accounts through Supabase Auth, one user registered, old data claimed.
- Security review (Opus) done on auth and tenancy: no critical findings, one high finding fixed (refuse
  to run over a role that bypasses RLS). Still open before strangers register: CAPTCHA, per-IP and
  per-email rate limits, current password for password changes, `APP_URL` for redirects
  (see `docs/plans/auth-tenancy.md`).
- Next: smart categorising (separate feature, before hosting), then milestone 9 (hosting).
