# Privacy notice for Kasboek (DRAFT, in English)

> **Draft, not legal advice.** Written from what the app actually does on 2026-10-16. Fill in the
> bracketed parts, have it read by the owner and, before strangers use the app, by a lawyer. Provide it in
> Dutch as well if Dutch speakers use the app. Update it whenever a processor or a data flow changes.

## Who is responsible

[Name or company], [address], [email]. This is the controller of the personal data described below.

## What Kasboek is

A personal budget tracker. You create an account, upload your own bank statements, and Kasboek shows
where your money goes and how the coming months look.

## What we store

| Data                                                                                                           | Why                                                                                | Where                                     |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------- |
| Your email address and a password (stored only as a hash by Supabase Auth)                                     | to sign you in                                                                     | Supabase, EU (Frankfurt)                  |
| The transactions in the statements you upload: date, amount, counterparty name and account number, description | to show your overview and forecast                                                 | Supabase, EU (Frankfurt)                  |
| Your categories, rules, budgets, fixed costs, the shops Kasboek has learned from your choices, your settings   | to work as you set it up                                                           | same                                      |
| A language and a theme choice                                                                                  | to remember your preference                                                        | your browser (a cookie and local storage) |
| Sign-in cookies                                                                                                | to keep you signed in; they are not readable by scripts and only sent to this site | your browser                              |

We do not use advertising or analytics trackers. We do not sell data.

## Who else receives data (processors)

- **Supabase** (database and sign-in), data in the EU. [Link the data processing agreement.]
- **[Hosting provider, e.g. Vercel or Hetzner]**: serves the app; it handles requests but does not keep your data. [DPA.]
- **Anthropic** (the company behind Claude), **only if you switch on "Kasboek AI"** after reading the
  consent text. We then send the name of a shop and a short description with numbers, account numbers and
  e-mail addresses removed. We never send amounts, dates, account numbers, your name, or payments to and
  from people. Anthropic is outside the EU; the transfer relies on [standard contractual clauses / its DPA]. You can switch
  this off at any time. [Check and state Anthropic's current retention and training terms for API data.]

## How long we keep it

As long as you have an account. "Delete my data" in Settings removes everything you stored (not your login,
which is removed by asking [contact]). Backups at Supabase are kept for [x days] and then disappear.

## Your rights

You can see and download your data (Settings, backup and CSV), correct it, delete it ("Delete my data"), and
ask us to delete your account. You can object to or limit processing and complain to the Dutch Data Protection
Authority (Autoriteit Persoonsgegevens). Contact: [email].

## Security

Every row belongs to one account and the database itself refuses to show it to anyone else (row level
security). Connections are encrypted. The app never holds an administrator key. Statements are processed to
extract transactions and the files themselves are not kept.

## Changes

If this notice changes in a way that matters (a new processor, a new use of your data), we will tell you in
the app and, for Kasboek AI, ask for your consent again.
