# DESIGN.md

The design system for arnaq. The look was chosen by the owner over eleven prototype rounds (`docs/design/`, index in `docs/design/README.md`). This file records what was decided and why, so later work does not relitigate it.

**Source of truth for colour: `src/design/tokens.ts`.** `npm run tokens` generates `src/app/tokens.generated.css`. Tests (`src/design/tokens.test.ts`) fail if the generated file is stale or any text pair drops below WCAG AA (4.5:1). Never edit the generated CSS by hand.

## Principles

1. **One number, one sentence.** Every screen opens with a ring, one big number inside it, and one serif sentence that says why. You know how things stand in a second.
2. **Calm over clever.** Soft colour, no alarms. Status is carried by words and numbers as well as colour, never colour alone. A tight month is amber, never a red page.
3. **Honest data.** Numbers are cents in the database and formatted at the edge (`nl-NL`, tabular figures). Forecast values are visibly dashed. "Free to spend" is what is left after fixed costs that are still to come.
4. **One adaptive layout.** Phone: floating pill navigation, single column. Laptop (app width 900px or more): sidebar and two columns. The switch follows the app's own width (container query), not the device.
5. **The user chooses the theme, we choose the rest.** Light, Dark and System are the only settings.

## The hero pattern (every screen)

Title, then a ring with the key number inside and a serif sentence below it, then details.

| Screen       | Ring shows                                    | Centre number                        | Sentence                                          |
| ------------ | --------------------------------------------- | ------------------------------------ | ------------------------------------------------- |
| Overzicht    | share of budget used or already planned       | what is still free to spend          | how the gewone uitgaven are tracking against pace |
| Prognose     | share of forecast months that end in the plus | growth until the last forecast month | the tightest and the best month                   |
| Vaste lasten | fixed costs paid                              | `6/8`                                | what is still to come this month                  |
| Upload       | transactions sorted (counts down)             | how many are left, a check when done | what to do next                                   |

Ring tone follows status: `good` under 85% of budget, `warn` from 85% to 100%, `bad` above 100%. `accent` (blue) is for neutral progress (fixed costs, upload).

## Themes

Set by the inline script in `src/design/theme-script.ts` before first paint (no flash). Preference is stored in `localStorage` under `kasboek-theme`: `system | light | dark` (a stored `darkplus`, the retired third theme, reads as dark).

- `<html data-theme="light|dark">` only for explicit choices; `data-mode="light|dark"` is always set (Tailwind's `dark:` variant uses it).
- With no explicit choice the CSS follows `prefers-color-scheme`.
- **Light:** airy glass cards on a soft gradient, cool blue into warm peach. **Dark:** deep navy with lit gradient rings; its page background is made like the onboarding's (a blue tint at the top and a violet one in the middle, mixed into the navy). There used to be a third theme, "Dark +" (a lighter slate); it was retired on 2026-10-22 because it looked almost the same as Dark, and the new Dark is lighter at the top.

## Tokens

Semantic names, generated per theme. shadcn's variables are derived from them in `src/app/globals.css`, so shadcn components follow the theme automatically.

| Token                                | Use                                                                                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `canvas`, `surface`                  | page base and card (translucent glass in practice; the solid `surface` is used for contrast tests)                                                                       |
| `ink`, `ink-muted`                   | text; muted is for secondary text and must stay readable on the washed page top                                                                                          |
| `hair`, `track`, `soft`              | borders, ring and bar tracks, quiet fills and selection                                                                                                                  |
| `accent`, `accent-ink`               | links and text accents (light: ink-blue, dark: pale blue)                                                                                                                |
| `action`, `action-ink`               | primary buttons in the app (light: ink-blue, dark: pale sky). The onboarding's call to action keeps the logo cyan. Its own token so buttons are separate from text links |
| `select`                             | the selected dot of radio buttons and toggles (light: ink-blue, dark: pale sky)                                                                                          |
| `good`, `warn`, `bad`                | status **text** colours (AA on surface and canvas)                                                                                                                       |
| `chip-*` and `chip-*-ink`            | category icon tints: sky, mint, peach, rose, lavender, yellow, gray                                                                                                      |
| `ring-<tone>-from/to`, `glow-<tone>` | ring gradients and the tint under/behind the hero ring                                                                                                                   |
| `page-bg-<mood>`                     | page background: a vertical gradient plus a status wash at the top                                                                                                       |

Contrast results are enforced by tests, not by this table. Two real findings from them: the muted text colours were darkened in light and lightened in dark and Dark + so they stay readable on the strongest part of the wash, and the Dark + `bad` text was lightened (4.26:1 to above 4.5).

## Page background

**One gradient per theme, the same on every screen** (`page` in `src/design/tokens.ts`, emitted as `--page-bg` and `--page-end`). Light: the soft blue-to-peach dawn. Dark: the onboarding's recipe, `linear-gradient(165deg, blue 26% over navy, violet 22% over navy at 55%, navy)`, with the mixes computed in OKLab so they equal CSS `color-mix(in oklab, ...)`. The onboarding screens end in `--page-end`, so the intro finishes in the app's own last colour (peach in light, navy in dark).

It is drawn on a fixed layer behind the page (`body::before`), not as a `background` on the body: a `fixed` keyword in the shorthand only fixes the last layer, and iOS Safari ignores `background-attachment: fixed`.

History: until 2026-10-22 the dark themes also had a _status wash_, a glow at the top that changed colour per screen (blue, green, amber, rose). It read as uneven colours and was removed for every theme (owner decision). `data-mood` is still set per screen by `MoodSetter` but nothing in the CSS uses it.

## Glow (decided for now, easy to change)

- **Light: A (decided 2026-10-16).** No glow. F, a soft shadow in the status colour straight under the ring (a `box-shadow` on a sibling element), was the earlier choice and is in git history.
- **Dark: D.** The conic gradient ring with a lit head cap and a tight glow.
- Chosen per theme in `glowStyle` in `tokens.ts`. Alternatives that were built and compared: A (no glow), D in light, a frosted lens, a soft bloom, a lit inner well.
- **Safari rule: never put a CSS `filter` on an SVG element.** iPhone Safari can clip it to the element box and show a hard edge. Use a div, a box-shadow, or a conic-gradient ring instead.
- Why light and dark differ: a glow that radiates evenly is a light source on a dark ground but reads as a smudge on a light one. Impeccable's depth rule says the same: depth comes from an offset shadow with a soft blur, and a zero-offset coloured halo is decoration.

## Typography

- **Display and sentences:** Newsreader, weights 400 and 500, italic for the number inside a sentence. Page titles and the hero sentence only.
- **UI and numbers:** the system font (SF Pro on Apple devices) with Geist as fallback. The big number in the ring is in this font too (not the serif), tight letter spacing (-0.035em), and shrinks to fit when it is long (`numberSize` in `hero.tsx`).
- **Big number:** the same weight in both themes, medium (500) in light and one step lighter (400) in dark, because light type on a dark ground looks optically heavier. It was once bold in light and thin in dark by accident; do not reintroduce that.
- Numbers use tabular figures everywhere they line up.
- Fixed rem scale, ratio about 1.2 for UI; the hero number is about 52px and the page title about 40px on laptop.

## Components and rules

- **Cards:** radius 24px, hairline border, glass blur. Not every block is a card: the hero has none (it sits on the wash).
- **One radius for every card:** 24px, also for a table or chart. What fills a card to its edges gets at least 16px of padding inside it, so text never sits against a curve (the Fixed tracker once clipped its first and last column with 8px).
- **Ring:** 14px stroke at hero size, round caps, gradient from `ring-<tone>-from` to `-to`, track `track`. Never an SVG filter (see Glow).
- **Rows:** icon chip (40px, 12px radius) + name + amount, with a thin status bar. Planned fixed costs show "komt 25 okt" instead of a spent amount.
- **Status tiles:** label, one status word, short sub-line. Two across on phone, four on laptop.
- **Charts:** every number a chart implies is printed on it. Forecast months are dashed. Tapping a month shows its details in a panel below. The Prognose chart has two views (Total, Per month). Total: a smooth line with a soft fill under it, the running total above each point and the growth of that month below it, green for plus and red for minus (true minus sign). When the bank's balances are known (they are stored from migration 0005 on) the numbers are the real balance at the end of each month: the balance at the start of the first month plus the growth. Before that, or for accounts without balances, they are growth since the first month shown.
- **Navigation:** floating pill bar on phone, sidebar on laptop.
- **Targets:** at least 44px. Focus is always visible. Charts have text alternatives.
- **Selection, scrollbars, accent colour of native controls** follow the palette.

## Open decisions and known limits

- The balance chart assumes the CSV parsers store the running balance (Rabobank "Saldo na trn", Revolut "Balance"). They do not yet; that comes with the database port.
- All prototypes use demo data. The parsers are unverified against real bank exports.

## Screens as built (milestone 7)

| Route          | Screen      | Notes                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`            | Overzicht   | Ring = budget used or planned, centre = free to spend, a line of explanation, an attention list with actions, four status tiles (budget, fixed costs, savings, income), pace of the month (one bar per day), where it went (top 5, bars by meaning: paid fixed cost green, fixed cost to come grey, over budget red), income, coming up. Two columns on a laptop. `?month=YYYY-MM` steps through months |
| `/prognose`    | Prognose    | Ring = share of forecast months in the plus. Chart of the running total (dashed = forecast), tap or arrow-key a month for its details. Horizon 3, 6, 12 or 24 months (`?months=`)                                                                                                                                                                                                                       |
| `/fixed-costs` | Fixed costs | Ring = paid fixed costs. Suggestions (accept or never show again), missed payments, add, pause, delete                                                                                                                                                                                                                                                                                                  |
| `/upload`      | Upload      | Ring = transactions sorted. Drop a CSV, then sort what is left (a choice can create a rule)                                                                                                                                                                                                                                                                                                             |
| `/budget`      | Budget      | Per category and optional total; a field saves when you leave it; copy the previous month                                                                                                                                                                                                                                                                                                               |

- **Loading** is a calm skeleton with the hero's footprint (no spinner). **Empty** says what to do next with one action. **Error** never shows the raw error: "Er is niets kwijt".
- **Glass** (`--glass-bg`, `--glass-border`, `--glass-shadow`, `--glass-nav`) is part of the tokens, per theme, so cards and the nav follow Light, Dark and Dark +.
- Server components load data directly (no HTTP hop) inside `<Suspense>`; mutations are client components calling the existing API and then `router.refresh()`.
- The layout switches on the app's own width (`@container/app`, 900px), not the device.
- The balance line in Prognose is the running total of income minus expenses, not the bank balance, until the parsers store it.
- `npm run seed:demo` fills the local database with invented data to look at the screens.

## What was tried and dropped

Three directions in round 1 (ledger, colour-blocked, instrument panel); flat "Helder" without glass; a layout switch (Verhaal or Dashboard); one-or-three rings; a month-wide mood; a perzik halo and a frosted lens behind the ring. Reasons live in `docs/design/` and the git history.

## Changing the design

1. Edit `src/design/tokens.ts`.
2. `npm run tokens`.
3. `npm test` (contrast and sync tests).
4. If you add a theme, add it to `THEMES`, the theme script, and this file.
