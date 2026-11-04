# MOTOBOUND brand identity (logo system)

Owner: Marketing & Key Art. Companion docs: [`../ART_DIRECTION.md`](../ART_DIRECTION.md) (the Paddock Board
front end this is built from), [`CAPSULE_AND_ART_BRIEF.md`](CAPSULE_AND_ART_BRIEF.md) (Steam sizes and
composition), [`ART_UPLOAD_CHECKLIST.md`](ART_UPLOAD_CHECKLIST.md) (which file goes in which Steamworks slot).

The mark has one idea: **a race-weekend object, stencilled**. The wordmark is nine capital letters cut with
stencil bridges and chamfered corners, leaning ten degrees like the italic in the in-game wordmark. The roundel
is the nose-roundel plate of the CIRCUIT discipline with a leaning M on it. Under the wordmark runs the pit-lane
rule that ends in the three chevrons painted at a pit exit (the same chevrons as the primary action in the menu).
Ink on paper, amber on asphalt, as in section 1 of `ART_DIRECTION.md`.

## Files (`docs/studio/store/brand/`)

| File | Use | Ground |
| --- | --- | --- |
| `motobound-lockup-horizontal.svg` | Default lockup: roundel, wordmark, chevron rule | asphalt (chalk letters, amber roundel and chevrons) |
| `motobound-lockup-stacked.svg` | Capsules, library capsule, library logo, end card | asphalt |
| `motobound-wordmark.svg` | Small capsule, narrow strips, any place the roundel is shown separately | asphalt |
| `motobound-roundel.svg` | Icons, avatar, favicon source, stamps | any (it is its own ground) |
| `motobound-lockup-mono-chalk.svg`, `-ink.svg`, `-amber.svg` | One-colour lockup: a single fill, the roundel's ring and M are **real holes** | dark, paper, or a photograph |
| `motobound-roundel-mono-chalk.svg`, `-ink.svg`, `-amber.svg` | One-colour roundel (knockout) | as above |

Colours are the Paddock Board tokens, not new ones: chalk `#f1ecdf`, amber `#ffb21a`, ink `#0b0c0d`, asphalt
`#121315`, paper `#e8dfc8`. **This supersedes the vermilion `#ed6947` and teal-charcoal `#11191c` of the older
visual-language table in `CAPSULE_AND_ART_BRIEF.md`**, which predates the Paddock Board sign-off (gate G5).

## How it is made (and what it is not)

* **Hand-authored geometry.** Every letter is a polygon written by hand on a 100-unit cap-height grid (stem 24,
  chamfer 22, counter chamfer 6, stencil gap 5, letter gap 14), then leaned by a 10 degree skew. The stencil
  gaps are masks over the polygons. Nothing is traced, nothing is a font outline, no stock or clip art, and the
  shapes are not drawn after any marque. The SVG files contain no text and no font reference: they render the
  same everywhere.
* The capsules' tagline and labels are **live text** set in Saira and Saira Stencil One (both OFL, both already
  bundled with the game: `@fontsource-variable/saira` and `src/ui/fonts/`). They are not part of the logo.
* **Trademark.** The name "MOTOBOUND" has had an engineering IP-guard pass only (`scripts/ip-denylist.mjs`), not
  legal clearance. Trademark search and registration of the name and the roundel are open (gate G15, owner/counsel).

## Construction

```
cap height 100 u        wordmark 915.6 u wide incl. the lean, 1115.6 u wide in the horizontal lockup
stem 24 u               letter gap 14 u            slant 10 degrees (tan = 0.176, top moves right)
roundel 200 u disc      ring r 85, 4 u line, two 17 u gaps; M at 90% leaning like the wordmark
rule                    2 u hairline 20 u under the baseline, ending in three 31 x 24 u chevrons, 24 u pitch
```

## Clear space and minimum size

* **Clear space** `x` = half the cap height (50 u). Keep `x` free on every side of the lockup, measured from the
  outermost shape (roundel disc, letters, chevrons). Nothing but the board edge or the page edge may enter it.
* **Minimum sizes on screen** (width of the file as placed):

| Version | Minimum | Why |
| --- | --- | --- |
| Horizontal lockup | 150 px wide | roundel 21 px, cap height 15 px |
| Stacked lockup | 120 px wide | cap height 13 px |
| Wordmark | 96 px wide (112 px in the small capsule) | below this the stencil gaps (5 u) fall under 0.5 px and the O, B and D close up |
| Roundel | 24 px | the ring gaps read from about 48 px; at 24-47 px treat the ring as a plain line |
| Print | wordmark 25 mm wide | |

* **No tagline in the lockup.** The line `RACE THE WRONG MACHINE` is separate: a paper strip (`#e8dfc8`, ink
  `#14110c`) with a notched top-right corner, Saira 700 caps, +0.16em, never below 9 px in the file as viewed at
  its Steam display size (the header shows it at 9.5 px at 1x and 19 px in the 2x file; it is left out of the
  small capsule, where nothing under 8 px survives).

## Use and misuse

* Primary: chalk letters and amber roundel and chevrons on asphalt. On paper use the ink one-colour lockup. Over a
  photograph use a one-colour lockup, or the library logo (below).
* The library logo carries a 4 px hard ink outline and the game's hard offset shadow (no blur) so it reads on
  light and dark hero art. That is the only outline permitted.
* Do not: recolour (a second amber, a gradient, a glow, a chrome or neon treatment); stretch or skew again;
  retype the name in another face; put the tagline inside the lockup; use the roundel without its M or the M
  without its disc; rotate; place on a busy photograph without a board; add a price, "free", "sale", a review
  quote, an award or the Steam logo to a capsule.
* The board's slanted edge, the amber lane line and the paper strip are the layout language of the capsules; do not
  add a drop shadow or a gradient scrim to them (the one soft mask is the quiet left third of the library hero).

## Safe areas used by the capsule tool

| Asset | Rule |
| --- | --- |
| Header 920x430 (460x215 at 1x) | board 45% wide at the bottom; logo and strip inside it with 22 px (1x) from the left and top-bottom centring; nothing but the photograph right of the lane line |
| Small 462x174 (231x87) | wordmark only, 112 px wide, 14 px left margin; board 140 px; one subject crop on the right |
| Main 1232x706 (616x353) | board over the hero only, four 22 px-label bands (11 px at 1x) along the bottom 90 px |
| Vertical 748x896 (374x448) | board on top 118 px, hero in the middle, three bands in the bottom 86 px |
| Library capsule 600x900 | quiet lower third: logo and strip on asphalt below y=612; no detail under it (the play bar can sit there) |
| Library hero 3840x1240 | no text, no logo; the left 40% is held dark by a mask for the logo overlay |
| Library logo 1280x720 | transparent, 1180 px wide lockup, 50 px minimum margin |
| Icons | roundel only, 12-14% margins on a square |

Steam crops and overlays differ by placement and change over time; re-check the Steamworks "Store graphical
assets" page before uploading (`ART_UPLOAD_CHECKLIST.md`).

## Rebuild

```
node scripts/studio/tools/capsule-art.mjs            # every capsule, the library art, icons, the contact sheet
node scripts/studio/tools/capsule-art.mjs --verify   # sizes, formats, alpha and the IP text check of what is on disk
```
