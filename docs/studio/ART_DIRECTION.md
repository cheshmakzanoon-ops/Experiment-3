# MOTOBOUND front-end art direction: "Paddock Board"

Owner: UX/UI Director. Status: v1, implemented for the paddock menu, pause menu, results,
settings and the other modal screens. The race HUD still uses the older `--apex-*` tokens
(see section 11 for the migration map). Companion docs: `ART_BIBLE_B.md` (HUD sizes, now
superseded for menus), `reports/ux.md` (audit and verification).

## 1. Concept

The front end is **the paddock**: every surface is something you could find on a race
weekend, and nothing is a generic app widget.

| Surface in the game | Real-world object it borrows from |
| --- | --- |
| Menu panel | the painted pit board / entry-desk board, with a paper header strip |
| Discipline selector | four race-number plates, each with its own silhouette |
| Venue sheet | a circuit map from a programme, drawn from the real centreline |
| Option rows ("dials") | the lines of an entry sheet: label, value, a hand to flip it |
| State chips | scrutineering (tech inspection) stickers |
| Timing figures | amber timing screen / pit-board numerals |
| Primary action | the pit-exit light plus the chevrons painted on the lane |
| Results | a timing sheet with the player's row highlighted by the marshal's highlighter |
| Driver badge | the paddock pass on the lanyard |

The rule that keeps it consistent: **ink on paper, amber on asphalt**. Paper-coloured
labels carry ink text. Asphalt boards carry chalk text. Amber means "this is the thing
you are choosing or about to do". Red is reserved for danger and live states, green for
go/OK, cyan for wet.

## 2. The four disciplines are first-class

Each has an own plate silhouette (never colour alone), numeral, colour, motto and map style.
The silhouette is a real object: the open-wheel nose roundel, a GP fairing plate, a
motocross front plate and a road licence plate.

| # | Discipline | Plate | Colour token | Map style | Motto (menu `h1`) |
| --- | --- | --- | --- | --- | --- |
| 1 | CIRCUIT | roundel (circle) | `--mb-plate-circuit` paper | circuit centreline, DRS zones in amber | EVERY INPUT. EVERY FORCE. |
| 2 | GP BIKE | fairing plate (pill + notch) | `--mb-plate-gp` teal | circuit centreline, apex numbers | LEAN IN. LET GO LATE. |
| 3 | DIRT | arch plate (domed top) | `--mb-plate-dirt` clay | course outline, jump ticks | FIND YOUR FLOW. (MX) / OWN THE RHYTHM. (SX) |
| 4 | FESTIVAL | wide licence plate | `--mb-plate-fest` lime | region roads, coast, event markers | ONE COAST. NO FENCES. |

A fifth slot is reserved for the Content agent's Wildcard Series (section 9).

## 3. Colour tokens

Defined on `:root` by `src/ui/front-end.css` (prefix `--mb-`). Dark-only (a racing game
front end over a 3D scene); high-contrast mode lifts the dim tiers.

| Token | Value | Use |
| --- | --- | --- |
| `--mb-ink` | `#0b0c0d` | deepest black, text on paper |
| `--mb-asphalt-0` | `#121315` | page scrim, wells |
| `--mb-asphalt-1` | `#1a1b1e` | board surface |
| `--mb-asphalt-2` | `#24262a` | raised field (dial, input) |
| `--mb-asphalt-3` | `#33353a` | hover, strong hairline |
| `--mb-chalk` | `#f1ecdf` | primary text (contrast on asphalt-1 about 14:1) |
| `--mb-chalk-dim` | `#b5afa0` | secondary text (about 7.6:1) |
| `--mb-chalk-faint` | `#8a8578` | tertiary, units (about 4.6:1, never for essential text) |
| `--mb-paper` | `#e8dfc8` | labels, stickers, table header strip |
| `--mb-paper-ink` | `#14110c` | text on paper (about 15:1) |
| `--mb-amber` | `#ffb21a` | selection, primary action, timing numerals |
| `--mb-amber-deep` | `#b87700` | pressed, rules on paper |
| `--mb-flag` | `#e4412e` | danger, DNF, live recording |
| `--mb-go` | `#4fd36a` | OK, green flag, "applied" |
| `--mb-wet` | `#5bc7d9` | wet weather and wet tyres |
| `--mb-plate-*` | see section 2 | plate fills |
| `--mb-line` | `rgba(241,236,223,.14)` | hairlines on asphalt |

Tyre compounds keep the existing `--tyre-*` tokens (they are timing semantics, not brand).

## 4. Type

Faces: **Saira Variable** (already bundled, OFL; width axis 50-125) for everything, and
**Saira Stencil One** (OFL 1.1, same family, one weight, Latin subset 20 KB, shipped in
`src/ui/fonts/` with its licence text) for numerals, plates, the wordmark and board
titles. Tabular figures everywhere data changes.

| Token | Face / size / treatment | Use |
| --- | --- | --- |
| `--mb-t-label` | Saira 11 px, 650, caps, +0.14em, width 92% | field labels, kickers |
| `--mb-t-value` | Saira 14 px, 600, width 100% | dial values, body |
| `--mb-t-lead` | Saira 15 px, 500 | blurbs |
| `--mb-t-title` | Saira 22 px, 750, caps, width 96% | sheet title, dialog `h2` |
| `--mb-t-board` | Stencil 18 px, +0.04em | board message (menu `h1`), table index |
| `--mb-t-plate` | Stencil 44 px | plate numerals |
| `--mb-t-nameplate` | Stencil `clamp(44px, 5vw, 76px)` | machine nameplate |

No italics except the wordmark's slant; no gradient text.

## 5. Spacing, shape, elevation

* 4 px base unit: 4, 8, 12, 16, 24, 32, 48. Board padding 16, dial height 44 (touch minimum).
* Radii: boards 0 with one notched corner (10 px), fields 2 px, plates their own shapes.
* No drop-shadow cards. Elevation is shown by a 1 px chalk hairline and a 2 px ink offset
  line ("hard shadow"), never a blur. Exceptions: none.
* The 3D showroom is the background. The board is opaque (94% asphalt) with no
  `backdrop-filter`; text over the scene (masthead, footer) gets a text-shadow, not a panel.

## 6. Motion

Mechanical and short: things flip, slide or snap; nothing bounces or fades slowly.

| Token | Value | Use |
| --- | --- | --- |
| `--mb-ease-snap` | `cubic-bezier(.5, 0, .1, 1)` | dial value flip |
| `--mb-ease-out` | `cubic-bezier(.2, .7, .1, 1)` | plate lift, board slide |
| `--mb-d-tick` | 90 ms | dial step, hover |
| `--mb-d-plate` | 140 ms | plate select |
| `--mb-d-board` | 220 ms | modal in, series strip |

Dial change: the new value slides in 6 px from the direction of travel. Plate select:
lift 3 px and the sticker stamps in. Modal in: 6 px rise. All of it is removed by
`prefers-reduced-motion` and by the in-game "reduced motion" setting
(`:root[data-reduced-motion='true']`).

## 7. Iconography

Hand-written inline SVG in `src/ui/glyphs.ts`: 24x24 viewBox, 2 px stroke, square caps and
mitre joins (it should look stencilled, not rounded-friendly). No icon pack, no emoji, no
unicode pictographs. Drawn today: sun, mixed sky, rain, tyre, flag, stopwatch, grid, wheel
(assists), start slot, chevrons, check, lock. Icons are decorative (`aria-hidden`) next to
a text label; icon-only controls carry an `aria-label`.

Track and region art (`src/ui/track-art.ts`) is generated, never hand-drawn: the closed
Catmull-Rom of `CircuitDefinition.design` (the same curve `Track` samples), corner
numbers at the real corner stations, DRS zones from `drsZones`, the start/finish tick at
station 0; the festival map draws `SOLVANE.roads`, `coast` and event waypoints.

## 8. Interaction model (keyboard, pointer, controller)

* One native control per option. Every dial is a real `<select>`, so assistive technology,
  Tab, Up/Down/Left/Right, type-ahead and the full list all work natively. The stepper
  arrows and the discipline plates are extra affordances, not replacements.
* Discipline plates are a `tablist` with roving tabindex: Left/Right/Home/End move and select.
* Controller (`src/ui/menu-gamepad.ts`, opt-in poll only while the menu or a modal is open):
  D-pad/left stick up-down moves focus, left-right steps a focused dial or plate,
  A activates, B closes a modal that offers a close action, Start launches the entry,
  LB/RB switch discipline. Buttons held on open are not treated as presses.
* Hints in the footer show the active device's glyphs (keyboard keys or pad buttons).
* Quick start is at most three inputs: pick a discipline (or keep the default), press GO. The
  entry remembers each discipline's own sheet while the menu is open.

## 9. Extension point: Wildcard Series

`registerSeries()` in `src/ui/launch-board.ts` adds a chip to the SERIES strip (under the
plates). A series is a curated one-click setup:

```ts
registerSeries({
  id: 'wildcard-hill-climb-hypercar',
  label: 'WILDCARD',          // chip text, caps
  title: 'Hypercar up the pass', // aria-label / tooltip
  apply: (set) => {           // write the same selects the form owns
    set('circuit', 'alpine-pass');
    set('vehicle', 'hy9');
    set('mode', 'race');
  },
});
```

`set(id, value)` assigns the select and dispatches `change`, so every existing rule
(`describeRules`, the MX presenter, machine preview) runs. Content that needs its own
plate can pass `plate: { numeral, shape: 'roundel'|'fairing'|'arch'|'licence', colour }`;
the strip is hidden while no series is registered and the DIRT shortcuts
(OUTDOOR MX, STADIUM SX) are the first registered entries.

## 10. Copy rules

Plain, specific, short. A motto per discipline is allowed (it is a pit-board message, not
a pitch). No "Welcome", no "Experience", no lorem, no "Get started", no exclamation marks.
Prefer a number or a noun from the data ("26 venues", "5 named corners") to an adjective.
Errors say what is wrong and what to do ("Cannot start: ...").

## 11. HUD migration map (phase 2, not done)

`--apex-flame` -> `--mb-amber` for selection and `--mb-flag` for alerts; `--apex-text` ->
`--mb-chalk`; `--apex-dim` -> `--mb-chalk-dim`; `--hud-panel` -> `--mb-asphalt-1`;
`--apex-cut` clip-paths -> the single 10 px notch. Timing colours (`--t-purple`, `--t-green`,
`--t-yellow`) stay: they are broadcast timing semantics.

## 12. Anti-slop checklist (review gate for every front-end change)

Reject the change if any answer is yes.

1. Any purple, indigo or blue-to-violet gradient? Any gradient used as decoration at all?
2. Glassmorphism: translucent card with `backdrop-filter: blur` as a container?
3. A grid of identical rounded cards with an icon on top, a title and a grey sentence?
4. Emoji or pictographic Unicode used as an icon?
5. Lorem ipsum, "Lorem", "Placeholder", "Coming soon" with no date, or marketing filler
   ("Experience the thrill", "Unleash", "Next-generation")?
6. A centred hero: big headline, subtitle, one pill button, in the middle of the screen?
7. Gradient text, glowing neon box-shadows, animated gradient borders?
8. A purely decorative element that carries no data (random blobs, grid noise, stock photos)?
9. Colour as the only signal (discipline, tyre, weather, state)?
10. A control that cannot be reached and operated with keyboard and controller alone?
11. Text below 11 px, or text-on-background contrast below 4.5:1?
12. A new colour, radius, font size or duration that is not a token?

## 13. Sound-cue hooks

`src/ui/ui-cue.ts` dispatches `window` events `motobound:cue` with `detail.cue` in
`tick` (dial step), `select` (plate, venue, machine), `confirm` (launch), `open`, `close`,
`back` and `deny` (an invalid entry). No audio is played yet; the audio engine can subscribe in
one place without touching UI code. Suggested character: mechanical (a relay click for
`tick`, a stencil-stamp thud for `select`, a pit-exit light chime for `confirm`).
