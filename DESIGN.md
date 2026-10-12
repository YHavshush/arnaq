# DESIGN.md

The design system for Kasboek. The look was chosen by the owner over eleven prototype rounds (`docs/design/`, index in `docs/design/README.md`). This file records what was decided and why, so later work does not relitigate it.

**Source of truth for colour: `src/design/tokens.ts`.** `npm run tokens` generates `src/app/tokens.generated.css`. Tests (`src/design/tokens.test.ts`) fail if the generated file is stale or any text pair drops below WCAG AA (4.5:1). Never edit the generated CSS by hand.

## Principles

1. **One number, one sentence.** Every screen opens with a ring, one big number inside it, and one serif sentence that says why. You know how things stand in a second.
2. **Calm over clever.** Soft colour, no alarms. Status is carried by words and numbers as well as colour, never colour alone. A tight month is amber, never a red page.
3. **Honest data.** Numbers are cents in the database and formatted at the edge (`nl-NL`, tabular figures). Forecast values are visibly dashed. "Free to spend" is what is left after fixed costs that are still to come.
4. **One adaptive layout.** Phone: floating pill navigation, single column. Laptop (app width 900px or more): sidebar and two columns. The switch follows the app's own width (container query), not the device.
5. **The user chooses the theme, we choose the rest.** Light, Dark, Dark + and System are the only settings.

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

Set by the inline script in `src/design/theme-script.ts` before first paint (no flash). Preference is stored in `localStorage` under `kasboek-theme`: `system | light | dark | darkplus`.

- `<html data-theme="light|dark|darkplus">` only for explicit choices; `data-mode="light|dark"` is always set (Tailwind's `dark:` variant uses it).
- With no explicit choice the CSS follows `prefers-color-scheme`.
- **Light:** airy glass cards on a soft gradient. **Dark:** graphite with lit gradient rings (the former "Titanium"). **Dark +:** the same, on a lighter, bluer slate. It was added because the owner found plain dark possibly too dark; it is a one-tap setting, easily reversible.

## Tokens

Semantic names, generated per theme. shadcn's variables are derived from them in `src/app/globals.css`, so shadcn components follow the theme automatically.

| Token                                | Use                                                                                                |
| ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `canvas`, `surface`                  | page base and card (translucent glass in practice; the solid `surface` is used for contrast tests) |
| `ink`, `ink-muted`                   | text; muted is for secondary text and must stay readable on the washed page top                    |
| `hair`, `track`, `soft`              | borders, ring and bar tracks, quiet fills and selection                                            |
| `accent`, `accent-ink`               | primary actions and links (light: ink-blue, dark: pale blue)                                       |
| `good`, `warn`, `bad`                | status **text** colours (AA on surface and canvas)                                                 |
| `chip-*` and `chip-*-ink`            | category icon tints: sky, mint, peach, rose, lavender, yellow, gray                                |
| `ring-<tone>-from/to`, `glow-<tone>` | ring gradients and the tint under/behind the hero ring                                             |
| `page-bg-<mood>`                     | page background: a vertical gradient plus a status wash at the top                                 |

Contrast results are enforced by tests, not by this table. Two real findings from them: the muted text colours were darkened in light and lightened in dark and Dark + so they stay readable on the strongest part of the wash, and the Dark + `bad` text was lightened (4.26:1 to above 4.5).

## Status wash

**Decision (owner): off in light, on in dark and Dark +.** It is one flag per theme: `statusWash` in `tokens.ts`, then `npm run tokens`. Everything below explains how it works if it is turned on again, and why it is off in light.

The top of the page is lightly tinted by the **active screen's** tone (set `data-mood="neutral|good|warn|bad"` on `<html>` per screen). Amber on Overzicht when the month is tight, green on a healthy Prognose, blue (neutral) on Vaste lasten and Upload.

Findings from testing it, which are rules:

- **Follow the screen, not the month.** A month-wide mood put an amber page behind green and blue rings and fought them.
- **Use a neutral base.** Washing over a blue-topped gradient gave a muddy mauve.
- **Never red.** `bad` is a soft rose wash.
- **Cap the strength.** The strength per theme is capped so muted text keeps 4.5:1 on the strongest part (see `tokens.ts`).
- It is a third signal next to ring colour and glow, so keep it quiet. Cross-fade between screens (about 300 ms, off under `prefers-reduced-motion`) so changing tabs does not flash.
- Why off in light: it is a third signal next to the ring colour and the glow, and the colour of the page changing between tabs adds motion nobody asked for. In dark the glow at the top is part of the approved look, so it stays.
- Even with the wash off, keep setting `data-mood` per screen; dark and any future theme with the wash on use it.

## Glow (decided for now, easy to change)

- **Light: F.** A soft shadow in the status colour straight under the ring, drawn as a `box-shadow` on a sibling element.
- **Dark: D.** The conic gradient ring with a lit head cap and a tight glow.
- Chosen per theme in `glowStyle` in `tokens.ts`. Alternatives that were built and compared: A (no glow), D in light, a frosted lens, a soft bloom, a lit inner well.
- **Safari rule: never put a CSS `filter` on an SVG element.** iPhone Safari can clip it to the element box and show a hard edge. Use a div, a box-shadow, or a conic-gradient ring instead.
- Why light and dark differ: a glow that radiates evenly is a light source on a dark ground but reads as a smudge on a light one. Impeccable's depth rule says the same: depth comes from an offset shadow with a soft blur, and a zero-offset coloured halo is decoration.

## Typography

- **Display and sentences:** Newsreader, weights 400 and 500, italic for the number inside a sentence. Page titles and the hero sentence only.
- **UI and numbers:** the system font (SF Pro on Apple devices) with Geist as fallback.
- **Big number:** the same weight in both themes, medium (500) in light and one step lighter (400) in dark, because light type on a dark ground looks optically heavier. It was once bold in light and thin in dark by accident; do not reintroduce that.
- Numbers use tabular figures everywhere they line up.
- Fixed rem scale, ratio about 1.2 for UI; the hero number is about 52px and the page title about 40px on laptop.

## Components and rules

- **Cards:** radius 24px, hairline border, glass blur. Not every block is a card: the hero has none (it sits on the wash).
- **Ring:** 14px stroke at hero size, round caps, gradient from `ring-<tone>-from` to `-to`, track `track`. Never an SVG filter (see Glow).
- **Rows:** icon chip (40px, 12px radius) + name + amount, with a thin status bar. Planned fixed costs show "komt 25 okt" instead of a spent amount.
- **Status tiles:** label, one status word, short sub-line. Two across on phone, four on laptop.
- **Charts:** every number a chart implies is printed on it. Forecast months are dashed. Tapping a month shows its details in a panel below. The saldo line shows the balance above each point and the monthly growth below.
- **Navigation:** floating pill bar on phone, sidebar on laptop.
- **Targets:** at least 44px. Focus is always visible. Charts have text alternatives.
- **Selection, scrollbars, accent colour of native controls** follow the palette.

## Open decisions and known limits

- Status wash: off in light (owner decision), on in dark and Dark + (unconfirmed, say if it should go there too).
- Dark vs Dark +: both ship; the owner has not chosen a default.
- The balance chart assumes the CSV parsers store the running balance (Rabobank "Saldo na trn", Revolut "Balance"). They do not yet; that comes with the database port.
- All prototypes use demo data. The parsers are unverified against real bank exports.

## Screens as built (milestone 7)

| Route           | Screen       | Notes                                                                                                                                                                              |
| --------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`             | Overzicht    | Ring = budget used or planned, centre = free to spend, status tiles, categories with bars. `?maand=YYYY-MM` steps through months                                                   |
| `/prognose`     | Prognose     | Ring = share of forecast months in the plus. Chart of the running total (dashed = forecast), tap or arrow-key a month for its details. Horizon 3, 6, 12 or 24 months (`?maanden=`) |
| `/vaste-lasten` | Vaste lasten | Ring = paid fixed costs. Suggestions (accept or never show again), missed payments, add, pause, delete                                                                             |
| `/upload`       | Upload       | Ring = transactions sorted. Drop a CSV, then sort what is left (a choice can create a rule)                                                                                        |
| `/budget`       | Budget       | Per category and optional total; a field saves when you leave it; copy the previous month                                                                                          |

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
