# MOTOBOUND front-end art direction: "Paddock Board"

Owner: UX/UI Director. Status: v2, implemented for the paddock menu, the Wildcard Series
board, pause menu, results, settings, the loading screen and (tokens, type, wordmark; layout
untouched) the race HUD. Not yet migrated: Team HQ, photo studio, festival HUD detail
(see section 11). Companion docs: `ART_BIBLE_B.md` (HUD sizes, now
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
| `--mb-chalk` | `#f1ecdf` | primary text (14.6:1 on asphalt-1) |
| `--mb-chalk-dim` | `#c9c3b3` | secondary text (9.8:1) |
| `--mb-chalk-faint` | `#a39e92` | labels, units (6.5:1 on asphalt-1, 5.7:1 on asphalt-2, 4.6:1 on asphalt-3) |
| `--mb-paper` | `#e8dfc8` | labels, stickers, table header strip |
| `--mb-paper-ink` | `#14110c` | text on paper (14.2:1) |
| `--mb-amber` | `#ffb21a` | selection, primary action, timing numerals |
| `--mb-amber-deep` | `#c98600` | pressed fill, index numerals (5.7:1 on asphalt-1) |
| `--mb-flag` | `#e4412e` | danger fill (DNF, live recording) |
| `--mb-flag-text` | `#ff6a55` | danger text on asphalt (6.1:1) |
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

* 4 px base unit: 4, 8, 12, 16, 24, 32, 48. Board padding 16, dial 42 high (48 for the venue dial; the whole dial including both hands is the
  target, well above the 24 px WCAG 2.5.8 minimum; it is below the 44 px touch guideline, which is a
  known trade for fitting the entry on a 720p screen).
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
unicode pictographs. Drawn today: sun, mixed sky, rain, tyre, flag, laps, grid, wheel
(assists), start slot, chevrons, caret and the go chevrons; the scrutineering check on the
chosen plate is a CSS-embedded SVG of the same construction. Icons are decorative (`aria-hidden`) next to
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
* Controller (`src/ui/menu-gamepad.ts`; it reads the Gamepad API each frame but acts only while the
  menu board or a modal is on screen):
  D-pad/left stick up-down moves focus, left-right steps a focused dial or plate,
  A activates, B closes a modal that offers a close action, Start launches the entry,
  LB/RB switch discipline. Buttons held on open are not treated as presses.
* Hints in the footer show the active device's glyphs (keyboard keys or pad buttons).
* Quick start is at most three inputs: pick a discipline (or keep the default), press GO. The
  entry remembers each discipline's own sheet while the menu is open.

### 8b. LIGHT and CONTINUE

* **LIGHT** is the ninth dial (`#light`, beside WEATHER): Venue, Midday, Sunset, Night, Live sky. It is
  the renderer's own `LightingMode` plus LIVE (`rendering/light-choice.ts`); the choice is stored per profile
  (LIVE under its old key `apex.sky.live.v1`, presets beside it) and applied when the session loads, so it
  survives a circuit change. Venue is the old behaviour (floodlit at night venues). The driving
  academy's CIRCUIT LIGHTING buttons set the same choice. Lighting is visual only. The menu showroom is
  studio-lit, so the dial shows its effect in the race, not in the menu.
* **CONTINUE** (the strip, beside the door) relaunches the last entry in one input: the form's own select
  values, or a Wildcard event id, kept in the save store under `board:last:v1` and validated on read.

## 9. Wildcard Series: the door, the board and the result

The series is the game's signature hook, so it has its own front door instead of a row of chips.

* **Door.** A ticket stub on the series strip under the plates, under every plate (the DIRT
  SERIES chips next to it belong to the DIRT plate only): a stencil count, a perforation,
  "WILDCARD SERIES" and "N OF 19 MEDALLED" from the career save. Next to it, CONTINUE (section 8b).
* **Board** (`src/ui/wildcard-board.ts`, `wildcard-board.css`, opened by `career:wildcard`): a modal
  on one screen. Left, the 19 events as a roving radio group (arrow keys, Home, End and a controller
  walking the list all select): number, the venue's real line art, title, machine on venue, weather
  and light glyphs, and the player's best medal disc (a dashed ring when none). Right, the programme
  page of the chosen event: the venue map with corner numbers, the machine's plate, venue, field, sky,
  rules (no ABS, time attack), the one-line pitch, the medal ladder (the player's rungs say EARNED), the
  best result and what it pays at most (computed by the career's own `racePayout`). The line and
  machine plate take the machine's discipline colour, so a dirt bike on a circuit draws a clay line on a
  circuit map. Not a card grid: a master list and a detail page.
* **Medals** are a disc with a letter (G, S, B) and a colour token (`--mb-medal-*`): never colour alone.
* **Result** (`resultsLead`, the head of the results screen): the medal earned (or why none: not
  classified, the AI drove, outside the ladder), what it asked for, NEW BEST or MATCHED YOUR BEST, and
  the pay; the career payment table follows. Medals come from the series' own `wildcardMedal`.
* **Start** is `career:wildcardGo:<id>`: `wildcardSession`, the machine loaned, the career's
  `settleRace` paying and recording `save.results['wildcard.<id>']` (no save schema change). An event that
  names a light (`lighting`) runs in it for that session.

### Extension point: registerSeries

The SERIES strip sits under the discipline plates (`<div id="boardSeries" class="lb-series">`).
Today it holds the two dirt shortcuts (OUTDOOR MX, STADIUM SX, built by
`motocross-presentation.ts`). `registerSeries()` in `src/ui/launch-board.ts` adds more chips,
grouped by heading, from anywhere (call it at module load or on boot; it is idempotent per `id`).
A series is a curated one-click setup:

```ts
import { registerSeries } from './ui/launch-board.ts';

registerSeries({
  id: 'wildcard-alpine-hypercar', // unique, stable
  group: 'WILDCARD',              // strip heading; entries with the same group share a row
  label: 'ALPINE HYPERCAR',       // chip text, caps, short
  title: 'Hypercar on the alpine pass', // tooltip
  apply: (set) => {               // write the same selects the form owns
    set('circuit', 'alpine-pass');
    set('vehicle', 'hy9');
    set('mode', 'race');
  },
});
```

`set(id, value)` assigns the select and dispatches `input` and `change`, so every existing rule
(`describeRules`, the dirt presenter, the machine preview, the rules line) runs exactly as for a
hand edit. After `apply` the board repairs a dirt machine/venue mismatch and repaints; the plate
follows the entry (`disciplineOf`: mode, machine family, venue), so a Hypercar on the alpine pass
stays under CIRCUIT. Ids are the form's own: `mode`, `circuit`, `vehicle`, `laps`, `weather`,
`opponents`, `compound`, `assist`, `startSlot`. The strip stays hidden only if it has no chips.

A fifth *plate* is deliberately not an API: a plate must own a rule in `disciplineOf()` so the
board can say which plate an arbitrary form state belongs to. If Wildcard needs one, add an entry
to `BOARD_DISCIPLINES` / `DISCIPLINE_SPECS` (`disciplines.ts`), a plate shape in `glyphs.ts`, a
`--mb-plate-*` token, and the plate row (`grid-auto-flow: column`) takes it without CSS changes.
`e2e/60-launch-board.spec.ts` ("wildcard series extension point") is the contract test.

## 10. Copy rules

Plain, specific, short. A motto per discipline is allowed (it is a pit-board message, not
a pitch). No "Welcome", no "Experience", no lorem, no "Get started", no exclamation marks.
Prefer a number or a noun from the data ("26 venues", "5 named corners") to an adjective.
Errors say what is wrong and what to do ("Cannot start: ...").

## 11. Race HUD (migrated in `src/ui/hud-identity.css`)

The HUD keeps its layout and footprint contracts; `hud-identity.css` is injected last and changes
colour, type and shape only. `--apex-flame` and `--accent` are now `--mb-amber`; `--apex-text` and
`--hud-text` chalk; `--hud-panel` asphalt; `--hud-radius` 0; the player's tower row is amber with
ink text (the marshal's highlighter, as in the results sheet). The tower header is a paper strip with
the MOTOBOUND wordmark in stencil; gear, speed, rpm, position and lap numerals are stencil, upright.
Timing colours (`--t-purple`, `--t-green`, `--t-yellow`, `--t-red`), compound colours and flag colours
stay: they are broadcast timing semantics. The older `style.css` skins are not edited (a unit test reads
two of their strings); the layer wins by order.

## 11b. Loading screen

A pit board, not a splash (`loading-board.css`): the session line, the stage and a stencil percent on
the left, an amber bar with a notched end, the real line art of the venue being loaded on the right
(circuit centreline or the festival region), and one tip chosen for the discipline, the weather, the
light and the player's own keys (`loading-tips.ts`, every line taken from a rule or in-game copy).

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
`tick` (dial step), `select` (plate, venue, machine), `confirm` (launch), `open` and `close` (a
modal), `back` and `deny` (an invalid entry). `src/audio/ui-sounds.ts` plays them: six sounds
synthesised in WebAudio, mechanical and short (a relay click for `tick`, a stencil-stamp thud for
`select`, a pit-exit light chime for `confirm`, a latch for `open`, the latch released for `close` and
`back`, a two-tone buzz for `deny`). It plays only after the person has interacted with the page (the
browser's autoplay rule; no context is created before), obeys the master volume and the mute key, thins a
key-repeat train, and leaves a suspended context alone. It does not touch the race audio graph.
