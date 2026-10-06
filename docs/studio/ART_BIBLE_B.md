# ART BIBLE B — HUD, Cockpit, Broadcast, Front-end and Game Design

Owner: Art Director (UI/HUD, cockpit, broadcast) + Game Designer. Analysis phase only. No source changed.
Target: EA F1 25 (PS5) presentation language, rebuilt with original APEX branding in Three.js/DOM.
Reference images belong to their owners. They are described here in words and measurements only and
must never be copied into the repo, traced, or used as textures.

## 0. How to read this document

- **Coordinates** are fractions of the full frame: `x` from the left edge, `y` from the top edge.
  For example, `x 0.027–0.183` is 2.7 %–18.3 % of the width. To convert to 1280×720 pixels, multiply by 1280/720.
  CSS should use `vw`/`vh` (or `calc(... * var(--ui-scale))`) so that 720p, 1080p and 4K match.
- **Measured references** (HUD exactly at 16:9): `085_gamescreed_2` and `084_gamescreed_1` (both 1280×720),
  `089_maxigeek_3` (1000×562), `094_fallback_joinsteer` (2000×1125), `095_fallback_onpsx` (3840×2160),
  `097_fallback_ps4hry` (1600×900), `070/072/074_topgear` (892×502), `039_thumbculture_2` (1024×576).
- **Colours** marked *sampled* were measured from the refs with the pixel and dominant-colour tools
  (JPEG noise is about ±8/channel). Colours marked *spec* are design decisions consistent with the refs.
- **Baseline** means the current build's shots in `scratchpad/shots/baseline/` (1280×720, medium quality).

### 0.1 Images reviewed in this pass

| Category | Files | Relevance |
|---|---|---|
| review_techradar | 043–066 (24) | **F1:** 043 driver portrait, 044 Imola pack, 045 top-down tracking, 046 LiDAR vs render, 047 grid with blankets and crew, 066 Miami turn. **Unrelated** (sidebar thumbnails): 048–065, which show wheels, other games, phones, cameras, a 3D printer and SGF. Ignore them. |
| review_topgear | 067–074 | 067 T-cam on a straight, 068 wet Spa, 069 time-trial leaderboard, **070/072/074 T-cam HUD (reverse-layout time trial)**, 071 pit stop, 073 helmet close-up |
| ps5_review_thumbculture | 039–042, 099 | **039 replay tower (22 cars)**, **040 accessibility settings list**, 041 gravel dust letterbox, 042 broadcast letterbox, 099 key art |
| review_gamingbolt | 081–083, 098 | 081 My Team HQ atrium, 082 wet Spa spray; 083 duplicates 045, 098 duplicates 044 |
| review_gamescreed | 084–086 | **084 F2 cockpit HUD**, **085 chase-cam HUD**, 086 F1 TV studio presenters with lower-third |
| review_maxigeek | 087–089 | 087 Las Vegas night, 088 true cockpit with wheel LCD, **089 chase HUD with story objectives** |
| ps5_review_cgmag | 090, 091 | 090 Monza pan-blur tracking shot, 091 key art |
| review_noobfeed 093, review_vandal 096 | 2 | wet cockpit (093 is a streamer sim-rig overlay; ignore its wheel), 096 wet Melbourne cockpit |
| review_gamecritics 092 | 1 | pit-stop crew (variant of 004/071) |
| reference_* 094, 095, 097 | 3 | **094 start lights, name tags and clutch prompt**, **095 pit-lane panel and pit mini-game**, **097 full mini-map, objectives and fastest-lap row** |
| official_ea_myteam 011–019, 100 | 10 (AVIF; converted to PNG in the scratchpad for viewing) | HQ exterior, Engineering, Personnel, Workforce, Finances, HQ atrium, Driver Select, Team Rivalry, Driver Icons, key art |
| also skimmed for §4/§5 | 003, 004, 005, 020, 021, 031–033, 075–080 | wheel LCD, pit stop, livery studio, Braking Point, decal editor, livery, photo mode results |

### 0.2 Baseline gap summary (current build vs. F1 25 HUD language)

| Element | Baseline now (file) | F1 25 reference |
|---|---|---|
| Overall type | Italic, heavy, skewed `clip-path` chips with an orange "flame" accent (`style.css` L2513–3300) | **Upright** wide geometric sans. Rounded-rectangle glass panels with a thin light outline. No skew and no italics. |
| Top scrim | `.hud-top:before` darkens the top ~88 px of the frame (`style.css` L370–376 and L2817) and dulls the sky | No scrim. The sky stays clean. |
| Brand/position | "APEX" logo plus a large white slanted "P5/8" badge at the top-left (`interface.ts` L153) | Position lives in the tower and in the top-right sector panel ("13 / 20"). The series logo sits in the tower header. |
| Session strip | Lap, flag and weather chips at top-left/centre | Lap is in the tower header ("LAP 1 / 52"). Flags appear as transient banners. Weather is not on the HUD. |
| Cluster | Rectangular block at the bottom-right (`race-day-hud.css` L28–40) | **Bottom-centre "binocular" cluster**: ERS pod + gear + speed/RPM pod |
| Tower | 174 px wide, 3-letter codes, "NO TIME", orange player row | Surnames, team logo, tyre icon, a separate shaded interval column and a light-grey player row |
| Mini-map | Whole circuit with a white ribbon and a caption | Full map with sector numbers, green DRS zones, chequered S/F, outlined team dots and a yellow player triangle. A local "snake" map is the alternative. |
| Action bar | CHASE/PIT/ERS/DATA/REPLAY/AI OFF buttons at the bottom centre during driving | None. Only two small icons at the bottom-right (radio, MFD). |
| Proximity | Red triangle plus "CAR RIGHT" text at 43 % height | Red chevron next to the overlapping car, no text |
| Menu | Form-style paddock with 8 dev/evidence buttons (REFERENCE REVIEW, SESSION 146 EVIDENCE…) | Cinematic 3D backdrop, a left list menu with a pill selection, contextual cards |

### 0.3 Global UI tokens (put on `:root` in `src/ui/style.css` and replace L2520–2537)

```css
/* Surfaces */
--hud-panel:        rgba(14, 16, 22, 0.86);   /* tower/sector/cluster body (sampled #15161b–#1b1c22) */
--hud-panel-head:   rgba(9, 10, 15, 0.92);    /* tower header and sector tab row */
--hud-panel-2:      rgba(42, 44, 52, 0.62);   /* tower interval column (sampled #2b2c32) */
--hud-stroke:       rgba(214, 218, 226, 0.55);/* 1.5px outer frame of tower/sector panel */
--hud-hair:         rgba(255, 255, 255, 0.10);/* 1px row separators */
--hud-radius:       8px;                       /* outer radius; inner rows are square */
--hud-text:         #f4f5f7;
--hud-text-dim:     #9a9ea8;                   /* "RACE", "/ 20", labels (sampled #92969f–#a1a2a7) */
--hud-player-row:   rgba(150, 156, 172, 0.62); /* replay/race player highlight (sampled #8a8fa0) */
--hud-player-text:  #1c1f27;
/* Timing semantics */
--t-purple: #b418cc;  /* overall fastest (row/sector) — sampled #b418cc */
--t-green:  #19c23b;  /* personal best — delta hatch sampled #009c00..#00c000 */
--t-yellow: #e4c030;  /* no improvement — sampled #e4c030/#f0cc30 */
--t-red:    #e0182a;  /* slower delta / invalid */
/* Energy and driving */
--ers-hi:   #e4f084;  /* BATT value and arc head — sampled */
--ers-lo:   #9cc054;  /* arc tail — sampled */
--drs-on:   #a6e04a;  /* DRS pill — sampled 089 */
--pit-cyan: #54e4f0;  /* PIT LANE header and stop time — sampled 095 */
--obj-purple: #b454fc;/* story/challenge objective banner — sampled 089/097 */
--obj-yellow: rgba(216, 216, 112, 0.38); /* secondary objective, 45° hatch */
--light-red: #f00c0c; /* start-light lit core — sampled 094; dim ring #901818 */
/* Front-end */
--fe-accent:  #fc4854; /* red-pink category pill and underline — sampled 040/015/017 */
--fe-income:  #58e06a;  --fe-outgoing: #fc4854;  --fe-warn: #f0fc0c;
--dept-engineering: #a8fccc; --dept-personnel: #a884cc;  /* sampled 012/013 */
/* Tyre compounds (tower ring icons, MFD) */
--tyre-s: #e5313d; --tyre-m: #f5c518; --tyre-h: #f2f2f2; --tyre-i: #43b047; --tyre-w: #1f8fe0;
```

**Type.** The bundled `Saira Variable` (wdth 50–125, `src/main.ts` L34) is the stand-in for F1 Display:
- HUD numerals and headlines: `font-stretch:125%; font-weight:800; font-style:normal; font-variant-numeric:tabular-nums; letter-spacing:0`.
- Labels such as BATT, MPH, S1 and BEST: `font-stretch:112%; font-weight:500; text-transform:uppercase; letter-spacing:.04em`.
- Tower surnames: `font-stretch:112%; font-weight:500; uppercase; letter-spacing:.02em`.
- Body and menu descriptions: `font-stretch:100%; font-weight:500`, title case.
- **Remove every `font-style: italic` and every skew `clip-path`/`skewX` from the HUD layer.** F1 25 uses none.

**Motion.** Rows re-order with a 180 ms ease-out translateY. Banners enter with 220 ms slide + fade and auto-hide after 4 s.
Sector tabs fill left→right over 250 ms. The delta panel never animates its number; it changes colour instantly.

---

## 1. In-race HUD (chase / T-cam / cockpit)

### 1.1 Layout map (16:9, measured from 085/089/097/094)

```
y0.04 ┌[TOWER x.027–.184 (+gap col to .262)]┐          [VIRTUAL MIRROR x.34–.66 y.14–.24, cockpit/T-cam only]   ┌[SECTOR PANEL x.773–.973]┐
      │ APEX  RACE           (header .045–.113)│                [FLAG / MESSAGE BANNER x.38–.62, y.10–.15]         │ S1 │ S2 │ S3  (tabs .042–.062)│
      │ LAP 14 / 18          (.113–.149)       │                [PIT LANE panel x.385–.615 y.149–.244]            │ 6 / 20        31.519     │
      │ rows ×5, 0.038 each  (.149–.339)       │                                                                   │ BEST        1:59.301     │
      └────────────────────────────────────────┘                                                                   └──────────────────────────┘
y0.36 [OBJECTIVES x.01–.29, y.37–.54 (story/challenge only)]
                                      [START LIGHTS x.40–.60, centre y .31]   [NAME TAGS above cars ahead]
y0.66 [MINI-MAP full: x.028–.226 y.662–.885 | local snake: x.10–.19 y.70–.93]            [proximity chevrons at car edges]
y0.81                                   [CLUSTER x.392–.605 y.808–.950]                       [prompts x.73–.99 y.74–.97]
y0.90                                                                                      [radio | MFD icons x.875–.975 y.90–.965]
```

Safe margins are **2.7 % of the width** on the left and right and **4.2 % of the height** at the top. Nothing touches the bottom 3 %.

### 1.2 Timing tower (`#tower`; refs 085, 089, 095, 097, 039)
- **Frame.** Panel `x 0.027–0.184`, top `y 0.045`. The outer frame is a 1.5 px `--hud-stroke` with `--hud-radius` 8 px corners.
  Only the name block (position, team logo, name) has the frame. The interval column is a separate flat block,
  `x 0.184–0.262`, filled with `--hud-panel-2` and without a frame.
- **Header** (`y 0.045–0.113`). APEX wordmark (white, 4.2 vh) followed by "RACE" in `--hud-text-dim`, stretch 125, weight 800, 3.6 vh.
  The session word changes to QUALIFYING, PRACTICE or TIME TRIAL. The header background is `--hud-panel-head`.
- **Lap row** (`0.113–0.149`). Centred. "LAP" is weight 400 at 2.0 vh in `#d6d9df`. The current lap is weight 800 at 2.6 vh, white.
  "/ 18" is weight 400 at 2.0 vh. A 1 px `--hud-hair` divider sits below it.
- **Rows.** Height **3.8 vh** (27 px at 720p). Contents from left to right:
  - position: weight 400, 1.75 vh, `#c8ccd4`, right-aligned in a 2.2 vw cell;
  - team bar: **2 px × 2.4 vh**, vertical, team colour;
  - team logo: 1.9 vh monochrome glyph (APEX teams need small logo glyphs);
  - SURNAME: weight 500, 1.75 vh, white.
  The interval column holds the tyre icon (ring 1.9 vh, 1.5 px stroke in the compound colour, letter in white at 1.1 vh) and the gap,
  right-aligned at 1.75 vh weight 500 (`+4.788`, `-0.334`, `--:--.---`, `PIT`, `OUT`, `DNF`).
- **Gap modes.** During the race, show the interval to the car ahead (as the current build does).
  In qualifying and practice, show the gap to the leader's best. In time trial, the rows are you, the rival ghost and "Personal Best" (070/072).
- **Window.** In race mode the tower shows 5 rows centred on the player (085 shows P11–P15 for a player in 13th).
  A full 20-row tower is only for replay and the pause/race-info view (039).
- **Player row (spec).** Background `--hud-player-row` with text `--hud-player-text`. Never orange.
- **Fastest-lap holder.** Whole row filled with `--t-purple`, plus an appended 2.2 vh square tab holding a white stopwatch glyph (097).
- **AI badge** in multiplayer (095): a 1.9 vh grey rounded square with "AI", placed before the name.
- **Current-build changes.**
  - `interface.ts` L433–494: emit `<b pos><i bar><img logo><span name><em tyre><small gap>` and stop using driverCode() 3-letter codes.
  - `race-day-hud.css` L120–136: widen the tower to 15.7 vw plus the 7.8 vw interval column.
  - Delete the skin rules at `style.css` L2946–3006 (italic, skew, orange player gradient).

### 1.3 Sector / position / lap panel (top-right; refs 085, 089, 094, 095, 097)
Replaces `.lap-panel` (`interface.ts` L155; CSS `race-day-hud.css` L137–152 and `style.css` L468–505, L3008–3070).
- **Frame.** `x 0.773–0.973`, `y 0.042`. 1.5 px `--hud-stroke` outline. 8 px radius, with the top-right corner given a 14 px radius bevel.
- **Tab row** (`0.042–0.062`). Three equal tabs, S1/S2/S3, weight 500 at 1.1 vh, with 1 px gaps.
  An empty tab is `#1d2028`. A completed sector fills with `--t-purple`, `--t-green` or `--t-yellow` (095 shows S1 and S2 yellow).
  In the current sector, the fill grows left→right with the sector's distance progress.
- **Main row** (`0.062–0.105`).
  - Left: position "6" (weight 800, 3.2 vh) and "/ 20" (weight 400, 2.4 vh, dim).
  - Right: current lap time (weight 500, 2.4 vh, tabular).
  - Under this row, a **2 px progress line** across the panel. Its colour follows the live delta state:
    yellow `#d4e000` if not improving, green if a personal best is projected, cyan `#1aa6a6` in the pit lane (sampled 095), orange `#e8902a` on an invalid lap (094).
- **BEST row** (`+0.05 vh` tall). "BEST" (weight 500, 2.0 vh, dim white) and the best lap on the right.
  The row is hidden until a best lap exists.
- **Data source.** Use `F.SECTOR` (60), `F.SECTOR_1..3` (61–63), `F.LAP_VALID` (64), `F.LAP_TIME` and `F.BEST_LAP`.
  Sector colours need the per-sector session best and personal best. Keep them in `Interface` alongside the GapTimer.

### 1.4 Time-trial / practice delta panel (refs 070, 072, 074)
- Placed at `x 0.773–0.973, y 0.0–0.048`, flush with the top edge, with only the bottom corners rounded at 8 px.
- Rows: "BEST  --:--.---" on `--hud-panel`, then "⏱ DELTA  -0.220" on a **45° hatch**:
  - ahead: `repeating-linear-gradient(135deg,#009c00 0 6px,#006000 6px 12px)` (sampled);
  - behind: `#c4141e / #7a0a12`.
- The numerals are weight 800, 2.6 vh, white, right-aligned. Used in time trial and in practice when `F.DELTA_VALID`.

### 1.5 Driving cluster — "binocular" (refs 070, 072, 085, 089, 094, 095, 097)
Replaces `.instruments` (`interface.ts` L160–162; `race-day-hud.css` L28–112 bottom-right block).

**Envelope**
- Centred. `x 0.392–0.605` (21.3 vw), `y 0.808–0.950`. In cockpit view, `y 0.83–0.985`, sitting on the wheel's lower rim (094).
- The background is a single SVG/canvas shape: two circles of **11 vh** diameter joined by a trapezoid bridge, 4.6 vh tall, between them.
- Fill `rgba(10,12,18,0.82)`. Stroke 1.5 px `rgba(120,126,140,0.55)`, plus a second inner tick ring at 0.35 alpha.

**Left pod — ERS**
- 270° arc, 0.9 vh thick, starting at 225°. The arc fill is `linear-gradient(--ers-lo → --ers-hi)` and is proportional to the battery level.
- An outer thin arc segment shows energy deployed or harvested this lap: `#8fd44a` for harvest, yellow `#e6e04a` for deploy (089).
- Label "BATT" at 1.4 vh, weight 500, `--ers-hi`. Value "52%" at 3.0 vh, weight 800, `--ers-hi`.
- At the bottom-left of the pod sits a 2.4 vh ERS-mode badge: concentric-ring glyph, red `#e0182a` ring and yellow centre.

**Bridge**
- Gear numeral at **6.4 vh**, weight 800, stretch 125, white (`N`, `R`, `1`–`8`).
- To its left, ghost icons at 22 % alpha: DRS eye, fuel can, wrench (damage). They light up when relevant.
- To its right, ghost up/down shift arrows at 22 % alpha that light green on the optimal shift.
- **Rev LEDs** along the bridge's top edge: 15 dots of 0.55 vh with 0.35 vh gaps. Dim `#2a2d36`.
  When lit: dots 1–5 green `#22d44a`, 6–10 red `#ff2a2a`, 11–15 blue `#3d6bff`. All 15 flash blue at the limiter (8 Hz).
  Replace the threshold at `interface.ts` L386–388 (`5800 + i*465`) with `shiftRpm*(0.80 + i*0.0143)`.
- Under the gear, a status line at 1.5 vh, weight 600, uppercase, `#e8b06a` (sampled #d8a86c):
  `HARVESTING`, `REDUCED HARVESTING`, `OVERTAKE`, `PIT LIMITER`, `DRS ENABLED`.
- **DRS pill** below the bridge: 3.2 vw × 0.9 vh, radius 0.45 vh. Unavailable: `#2a2d36`. Available: outline `--drs-on`. Open: filled `--drs-on` with glow `0 0 8px`.
- Under the cluster, a 2.2 vh button prompt plus "OVERTAKE" (weight 700, white) when overtake can be used (094/095).
  On keyboard, show a key-cap chip "E".

**Right pod**
- "MPH/KPH" label 1.4 vh weight 400, then speed 3.9 vh weight 800.
- "RPM" label, then RPM value 2.6 vh weight 700. Everything is white and centred.
- A thin grey outer arc (`rgba(200,205,215,0.35)`) acts as the throttle trace. A brake trace in red `#ff2a2a` sits on the inner side.

**Removed from the cluster:** BRK/THR bars, the FUEL kg line and the "BALANCED" yellow chip. Fuel goes to the MFD.
The BRK/THR bars stay behind a `Show inputs` setting and become two 0.5 vh vertical bars inside the right pod.

### 1.6 Mini-map (refs 097 full, 085/089 local; `interface.ts` L509–550 `drawMap`)
- **Full mode (default)**: `x 0.028–0.226, y 0.662–0.885`. Drawn on a transparent canvas at devicePixelRatio, **not** 250×240 CSS-scaled.
  - Ribbon: 6.5 px (@720) `#202227` at 0.85 alpha, with a 1 px `rgba(255,255,255,0.85)` hairline on both edges.
  - DRS zones: ribbon tinted `#3fae49` over their length. Since `F` has no DRS data, define zones per circuit in data.
  - Sector numbers "1", "2", "3": 2.0 vh, weight 500, white, offset outward from the sector start.
  - A 1.6 vh chequered flag glyph at S/F.
  - Car dots: **10 px diameter (@720)**, team colour fill, 1.5 px `#0b0c10` outline, z-ordered by race position.
  - Player: a **yellow `#f5e11c` triangle**, 2.4 vh, pointing along the track tangent, with a dark outline.
  - Flagged sectors: pulsing ring, 1.9 vh, 1.5 px (yellow `#f0d020` for yellow flag, green `#3fd04a` for cleared), 1.2 s pulse.
- **Local mode** (setting "Mini-map: Local"): the track segment within ±350 m of the player, rotated so travel points up.
  Same styling, drawn at `x 0.10–0.19, y 0.70–0.93`.
- **Remove**: the caption "AUREL / GRAND CIRCUIT" (`#minimapCaption`) during driving. The orange S/F bar (L534–542) and the orange player dot (L543–554) become the spec above.

### 1.7 Vehicle MFD (tyres / fuel / damage / setup; refs 070, 072, 085, 089)
Today the MFD is a hidden `VEHICLE` drawer (`race-day-hud.ts`; CSS `race-day-hud.css` L193–235).
- **Collapsed** (always visible): `x 0.875–0.975, y 0.900–0.965`. Two rounded 6 px boxes with a 1 px `rgba(255,255,255,0.35)` stroke on transparent glass.
  - Left box: headset glyph plus a key-cap (radio/engineer).
  - Right box: ≡ glyph plus a key-cap (MFD).
  - A warning triangle `#f0a020` appears in front when `vehicleWarning()` is non-empty (095).
  - Remove the top-bar `VEHICLE` button.
- **Expanded** (key M or the MFD button): a panel growing upward from the collapsed box, `x 0.745–0.975`, max height 0.30.
  - Pages, cycled with ←/→ and shown as dots: TYRES, ENERGY, DAMAGE, FUEL, SETUP.
  - Rows are 3.6 vh tall: icon, label (weight 500, 1.8 vh), `‹ ›` and the value right-aligned.
  - The selected row is a white `#f4f5f7` fill with `#14161c` text. Unselected rows are white text on `rgba(10,12,18,0.55)`.
- **TYRES page.** A car silhouette (top view) with four tyre glyphs coloured by carcass temperature:
  `<70 °C #4fa3ff`, `70–85 #5fd3a0`, `85–105 #4cd964`, `105–115 #ffd60a`, `>115 #ff3b30`.
  Wear percentage under each tyre. Compound ring icon plus the laps on the set.
- **DAMAGE page.** The car silhouette split into front wing L/R, floor, sidepods, rear wing, gearbox and engine.
  Colours: white `#e8e8e8` (ok), yellow `#ffd60a` (>15 %), orange `#ff9500` (>40 %), red `#ff3b30` (>70 %).
  Data: `F.FRONT_HEALTH`, `F.FLOOR_HEALTH`, `F.REAR_HEALTH`, `F.SIDEPOD_HEALTH`, `F.SUSPENSION_DAMAGE`.
- **SETUP page** (070): Front Brake Bias `‹ › 58%`, Differential `‹ › 30%`, ERS mode. Adjustable live.

### 1.8 Name tags and proximity (refs 085, 094)
- **Name tags** float 0.6 m above each visible car's airbox, projected each frame; hidden when farther than 120 m or occluded.
  - Pill: height 2.3 vh, padding 0 0.6 vw, background `rgba(10,12,18,0.72)`, radius 2 px.
  - Contents: position (weight 400, 1.6 vh, `#c8ccd4`), a 2 px × 1.6 vh team bar, then SURNAME (weight 700, 1.6 vh, white).
  - Show up to 5 tags. At the start grid show all (094); while racing, show only the car directly ahead (085).
- **Proximity**: replace the "◀ CAR LEFT" block (`style.css` L2165–2195).
  - Draw a **red `#e0182a` chevron**, 3.2 vh tall with a 3 px stroke, at the screen-space edge of the overlapping car's projected bounds, pointing toward that car.
  - Overlap: solid. Approaching: 50 % alpha. No text. Colour-blind mode adds a white 1 px outline.

### 1.9 Banners, flags, penalties, pit limiter, pit lane, start, objectives
- **Race-control banner** (convention; refs show only objectives). Top centre, `x 0.38–0.62`, `y 0.10–0.15`, under the virtual mirror.
  - Layout: a 4.4 vh square flag swatch on the left, then a text block on `--hud-panel` (weight 700, 1.9 vh, uppercase) with a 1.3 vh subline.
  - Enter animation: slide down 12 px with a fade over 220 ms.
  - Flag swatches:

    | Flag | Swatch | Text |
    |---|---|---|
    | Yellow | `#ffd21f` | "YELLOW FLAG · SECTOR 2" |
    | Double yellow | two stacked yellow bars | "DOUBLE YELLOW · SLOW · NO OVERTAKING" |
    | Blue | `#2f6bff` | "BLUE FLAG · LET <NAME> THROUGH" (`F.BLUE_CAR`) |
    | Green | `#19c23b` | "TRACK CLEAR" |
    | Chequered | pattern | "CHEQUERED FLAG" |
    | Safety car (future) | black/yellow `#ffd21f` "SC" board | — |

  - Replaces the permanent `#flag` chip and the `#raceMessage` strings (`interface.ts` L352–361 and L405–431).
- **Penalties and warnings** (convention). Same banner with an orange `#ff9500` swatch:
  "TRACK LIMITS WARNING 2/3", "+5s TIME PENALTY — CORNER CUTTING" (`F.WARNINGS`, `F.PENALTY`).
  The tower gap column then shows "+5s" in orange on the player row.
- **Pit limiter.** The cluster status line reads "PIT LIMITER". All rev LEDs blink blue `#3d6bff` at 2 Hz. The speed value turns cyan `--pit-cyan`.
- **Pit lane panel** (095). `x 0.385–0.615, y 0.149–0.244`:
  - header row: "PIT LANE" (weight 800, 2.0 vh, `--pit-cyan`) on `#0b0d14`;
  - body: two cells split by a 1 px divider. "PIT 7.5" (label 1.8 vh plus value 2.6 vh, white) and "STOP TIME 1.6" (label 1.8 vh plus value **3.6 vh, weight 800, cyan**).
  - Data: `F.PIT_CLOCK` (80) and `F.PIT_PHASE` (34).
  - **Pit-box timing mini-game** (095): a capsule at `y 0.33–0.40`.
    - "TURN-IN" label (1.9 vh, white).
    - "OPTIMAL / GOOD / LATE" word at **4.6 vh, weight 800, `#a860e4`** (sampled) with a violet glow `0 0 18px #a860e4aa`.
    - The capsule body is a lime `#c8e04a` rounded rectangle on the right with a dot-matrix texture.
    - Under it, "Estimated stop time 7.6s – 7.6s" (1.9 vh plus 2.6 vh weight 600).
- **Start lights** (094). Five circles, **5.6 vh diameter, 4.25 vw pitch**, centred at `y 0.31`, spanning `x 0.40–0.60`.
  - Unlit: `#2b2d31` with a 1.5 px top arc `#6a6d74` (a hood).
  - Lit: a radial `#ff2a1a → #f00c0c → #901818` with a 0.4 vh dot-matrix pattern overlay and an outer glow `0 0 22px #f00c0c99`.
  - Replaces the 18 px dots at `style.css` L506–539. Keep `H.LIGHTS`.
- **Clutch launch prompt** (094). Right column, `x 0.74–0.98, y 0.82–0.88`:
  - a 3.6 vh gear-wheel icon, then "HOLD [key] ENGAGE THE CLUTCH" at weight 800, 2.2 vh, white;
  - a second row "REACH OPTIMAL RPM" at 30 % alpha until active;
  - the whole prompt sits in a bracket frame with a 1 px `rgba(255,255,255,0.3)` corner.
  - Data: `F.CLUTCH_PEDAL`, `F.CLUTCH_ENGAGEMENT` (69–70).
- **Objectives** (story/challenge; 089, 097). `x 0.01–0.29, y 0.37–0.54`. Stacked rows, each 4.2 vh, with a ◇ diamond glyph on the left:
  - primary: `linear-gradient(90deg, #b454fc 0%, #b454fccc 55%, transparent)`, white text weight 700 at 1.9 vh;
  - secondary: a 45° hatch in `--obj-yellow`;
  - status: `rgba(30,30,36,0.6)`, e.g. "**5** Laps remaining" and "--:--.--- Gap to 1st";
  - an update flashes as "UPDATE: Win the race".
- **Racing-line assist** (089, 097). Dashes on the road. Each is 2.2 m long with 3.5 m gaps, 0.45 m wide.
  Green `#cfe8c4` at 0.85 alpha on throttle zones, then yellow `#f2d43a` and red `#ff3b30` approaching braking points.

### 1.10 Remove or hide during driving
- `.hud-top` brand "APEX LIVE", `.position-badge`, the `.session-status` lap/flag/weather chips and the `VEHICLE` toggle (all `interface.ts` L153).
- `.hud-top:before` scrim (`style.css` L370–376 and L2817).
- `.hud-actions` bar (L164): show it only on the pause screen, or keep it as a 0-opacity hover/focus overlay for mouse users.
- `#minimapCaption`, and the `.car-status` "VEHICLE STATE" heading.

---

## 2. Cockpit view framing and steering wheel

### 2.1 Framing targets (measured; acceptance = within ±0.03)

| Metric (cockpit cam) | F1 25 (094/096/085 F2) | Baseline 11/21 | Action |
|---|---|---|---|
| Halo top-bar lower edge at centre | y ≈ **0.25–0.27** | y ≈ 0.40 | narrow the FOV and move the eye forward |
| Halo centre pillar foot | y ≈ 0.38–0.45 | ≈ 0.55 | — |
| Wheel rim top | y ≈ **0.66–0.70** | ≈ 0.575 | — |
| Wheel width | **≈ 0.33 of width** (x 0.33–0.67) | ≈ 0.22 | — |
| Side mirrors centre | y ≈ 0.55–0.60, x ≈ 0.06 / 0.94 | at the edges, dark | — |
| Horizon | y ≈ 0.46–0.48 | ≈ 0.47 (ok) | keep the pitch |

The current `COCKPIT_FRAMING` (`src/rendering/cockpit-framing.ts` L7–14) is `verticalFov 64` (about 96° horizontal at 16:9),
`eyeOffset [0,-0.05,-0.12]` and `pitch -0.045`. The baseline compresses the halo and wheel toward the centre, which is the signature of an over-wide FOV.
- **Start values:** `verticalFov 52` (about 82° horizontal), `eyeOffset [0,-0.03,-0.04]` (8 cm forward, 2 cm up), `pitchRadians -0.035`.
- Iterate with captures until the table matches.
- Add a user "Cockpit FOV" slider from 44 to 70 vertical (F1 25 exposes camera FOV, offset and tilt).

**T-cam** (`pod` mode; refs 072/074/097):
- Targets: halo apex at y ≈ 0.66–0.70; front tyres visible in the lower corners (x 0.15–0.33 and 0.67–0.85, y 0.55–0.82); horizon y ≈ **0.43**.
- Baseline horizon is about 0.47. Set `TCAM_PITCH` -0.06 → **-0.085** (`renderer.ts` L136). The pod FOV `68 + 0.075·v` (L1061) should be 60 + min(5, 0.05·v).

**Chase cam** (085/089):
- Target: the car spans **29–30 % of the width** (x 0.335–0.645); the rear-wing top is at y ≈ 0.62–0.64; the rear-tyre bottom is at y ≈ 0.85–0.87; horizon y ≈ 0.43.
  The cluster overlaps the bottom 5 % of the car.
- Baseline 20: the car is 21 % wide and sits at y 0.62–0.97.
- `CHASE` (`renderer.ts` L124–133) start values: `fov 58→50`, `fovGain 6→4`, `distance 5.7→4.8`, `height 1.95→1.55`, `lookAhead 10→12`, `lookLift 0.42→0.55`.

### 2.2 Steering-wheel LCD (`src/rendering/steering-display.ts` L24–56, 512×256 canvas)

**Current.** Monospace green-white text on `#09100f` with a thin orange RPM bar. The F1 25 wheel (003, 088, 096, 094) is a full-colour dashboard.

**New layout (canvas px)**
- Background `#020305`, with an inner 4 px rounded bezel in `#14171c`.
- **Gear**: centre (256,132), bold 120 px, white `#ffffff`, upright Saira 125 % (load it with `document.fonts.load` before drawing).
- **Top row** (y 14–56): left box "L 3" (lap, 30 px); centre "P5" (34 px, bold); right box: delta.
  The delta reads e.g. "+0.49" in a pill with fill `#0f5e1a`/text `#3ddc5a` when ahead and `#5e0f12`/`#ff5a5a` when behind.
- **Left column** (x 16–150): lap time "1:27.203" (28 px white) over the delta "(+0.92)" (24 px, green/red).
- **Right column** (x 362–496): four tyre temperatures in a 2×2 grid, 22 px, coloured with the §1.7 scale (`W.SURFACE_TEMP`). Below them, brake bias "BB 56.0".
- **Bottom bar** (y 212–244): ERS bar.
  - Fill `#39d353` proportional to battery, with a 10 % tick grid.
  - The mode text sits inside the bar: HARVEST, BALANCED or OVERTAKE, black, 20 px.
  - The bar turns yellow `#ffd21f` during overtake. A battery percentage sits at the right end.
- **Refresh**: keep the `SteeringDisplayClock` 80 ms cadence (L59–74).

**Physical LEDs** on the 3D wheel rim above the LCD, as emissive meshes driven by `shiftLight()` (L21):
- 15 LEDs: 5 green `#00ff40`, 5 red `#ff1a1a`, 5 blue `#2f6bff`, with emissive intensity 4 and bloom.
- Three flag LEDs on each side: yellow for a yellow flag, blue for a blue flag.
- Rotary dials get coloured number rings (yellow, purple, green, rainbow).
- Button caps get saturated colours: N green, +10 purple, PIT orange `#ff7a1a`, DRS green, RAD blue, OK green.

### 2.3 Cockpit HUD variant and mirrors
- In cockpit view, the tower, sector panel and mini-map keep their positions. The cluster shrinks to 80 % and sits at `y 0.83–0.985` (094/097).
  The gear readout is mirrored by the wheel, so a "Minimal cockpit HUD" option can hide the cluster entirely (084 shows only gear/RPM/speed).
- **Virtual rear-view mirror** (084, 094, 097): an optional overlay at `x 0.34–0.66, y 0.14–0.24`.
  It is a rounded trapezoid (radius 1.6 vh) with a 2 px `#1a1c22` frame and reuses a `MirrorViews` render target at 512×160.
  Default ON in T-cam and cockpit, OFF in chase.
- **Side mirrors** (`src/rendering/mirrors.ts` L12, 256×96 at 15 Hz): on High quality, use 384×144 at 30 Hz. The baseline mirrors read almost black. Cut the `0xd4dde0` tint (L26) to `0xeef2f4`.
- Gloves and arms: refs show textile weave and colourway gloves (yellow/purple 088, teal 096). See ART_BIBLE character docs.

---

## 3. Broadcast and replay presentation (refs 039, 041, 042, 045, 090, 086)
- **Replay HUD (039).**
  - Hide the cluster, MFD and mini-map.
  - Show the **full-field tower** at `x 0.025–0.183`, `y 0.04–0.81` with row height **2.95 vh**. Header: the APEX mark plus "RACE", and "LAP 1 / 5".
  - Top-right badge "APEX ▸ REPLAY": `x 0.78–0.975, y 0.04–0.10`, `--hud-panel` with 1 px stroke, "REPLAY" weight 800 at 3.0 vh.
  - Bottom-right button prompt "(○) Cancel" at 1.8 vh.
  - The current `.replay-bar` (`interface.ts` L167; `style.css` L825–860) becomes an auto-hiding transport.
    It appears on mouse move, sits at `y 0.90–0.97` and is centred at 60 % width.
    It contains a scrubber with lap ticks, play/pause, speed chips (¼ ½ 1 2) and a camera-name chip. Everything fades out after 2.5 s idle.
- **Cinematic replay and broadcast cameras.** These were seen in 041/042, `broadcast-cameras.ts` exists.
  - **Letterbox bars** of 12.2 % top and bottom (2.35:1) on "Cinematic" replay cameras and on highlights. Animate the bars in over 400 ms.
  - Camera types to represent:
    - long-lens tracking at 135–300 mm equivalent (vertical FOV 6–12°) with **pan motion blur on the background** (042, 090) and a sharp car;
    - low trackside at grass level with dust (041);
    - overhead/helicopter top-down (045);
    - rear-low "kerb cam" at 0.3 m (044).
  - Hard cuts every 3–6 s, chosen by proximity to cars in battle (`gap < 1.0 s`).
  - Add an on-screen broadcast caption for 2.5 s on each cut: a lower-third "GAP 0.4s · LAP 12".
- **Broadcast graphics** (pre-race/grid presentation exists in `src/ui/grid-presentation.ts`):
  - **Lower-third speaker card** (086): `x 0.82–0.995, y 0.87–0.935`, `rgba(10,12,18,0.85)`.
    It holds an audio-wave glyph, then the name (weight 700, 1.9 vh) over the role (weight 400, 1.6 vh), then a 4.8 vh portrait square on the right.
    Use it for engineer radio lines and team-principal briefings.
  - **Grid walk cards**: driver name card with a team-colour bar, starting position, tyre compound and a qualifying time.
- **Replay highlight tags**: "OVERTAKE", "FASTEST LAP" (purple), "INCIDENT" (yellow) chips on the scrubber timeline.

---

## 4. Menus and front-end (refs 011–019, 040, 069, 031, 005)

### 4.1 Visual language
- **Backdrop.**
  - Either a full-bleed live 3D scene (HQ atrium 016/081, engineering bay 012, office 013, livery studio 031/005), or
  - the **"speed tunnel"** abstract: near-black `#07060a` with red-magenta light streaks (`#c8203c → #ff4a6a`, 2–6 % height, blurred 6 px) converging toward a vanishing point at about (0.62, 0.45), plus a faint teal floor glow `#1e5a5a` at the bottom 20 % (014, 017, 018, 019).
  - Build it as a full-screen Three.js plane shader (cheap). Use it for every modal that does not have a 3D room.
- **Left legibility gradient** over 3D rooms: `linear-gradient(90deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.25) 38%, transparent 55%)`.
- **Category tag**: a red pill `--fe-accent` (radius 3 px, padding 0.5 vh 0.8 vw), white text at 1.6 vh, weight 700, uppercase ("DRIVER SELECT", "ACCESSIBILITY OPTIONS", "FINANCES").
- **List menu**: items in uppercase, weight 800, stretch 115 %, **3.3 vh**, white at 92 %, with 1.3 vh spacing.
  - The selected item gets a **white 2 px outline pill**, radius 1.2 vh, fill `rgba(255,255,255,0.10)` and padding 0.6 vh 0.9 vw (012, 013, 019).
  - Attention badges: a yellow `--fe-warn` diamond with "!".
- **Cards**: `rgba(38,39,46,0.78)`, 1 px `rgba(255,255,255,0.14)` border, radius 8 px, inner header strip `rgba(0,0,0,0.25)`.
  A selected card gets a 2 px white border.
- **Corner brackets** (017, 018, 019): L-shaped corners, 1.2 vh legs, 1.5 px, `rgba(255,255,255,0.7)`, around focal stat blocks. Dotted leader lines connect help text.
- **Hatch fill**: `repeating-linear-gradient(135deg, rgba(255,255,255,0.06) 0 2px, transparent 2px 7px)` inside stat panels. In green or yellow for progress (014 hiring bar).
- **Numbers**: weight 800, stretch 125 %. Money with a boxed "$" glyph. Positive values `--fe-income`, negative values `--fe-outgoing`, each with an ↑/↓ boxed icon (014, 015).
- **Outlined display type** (018): `color:transparent; -webkit-text-stroke:1.5px #fff` (yellow `#f0e030` for rival states).
- **Button prompt bar**: bottom-right, `y 0.955`. Glyph circle (2.2 vh) plus label (1.8 vh, weight 500) per action, with 1.6 vw spacing. Shows keyboard glyphs when no gamepad is present.
- **Resource / profile bar** (012, 013): top-right, `x 0.72–0.95, y 0.02–0.08`, `rgba(20,21,26,0.9)`. Contents:
  - a 0.5 vw red hatch strip on the left edge (`#d83060`);
  - a green hex badge with week/day `5d`;
  - `$ 21.68M`;
  - `⊕ 5,931` resource points;
  - team name (weight 700, 1.7 vh) and team emblem (4.4 vh).

### 4.2 Main menu / paddock (`interface.ts` L135–150; `style.css` L141–200, L2665–2810)
- Keep the 3D car hero on the right (it is already good). Replace the form grid with a **left list menu**:
  RACE, MY TEAM, CHAMPIONSHIP, TIME TRIAL, DRIVING ACADEMY, CUSTOMISATION, PHOTO MODE, SETTINGS.
  Items use the §4.1 list style and start at `x 0.052, y 0.22`.
- Session setup (circuit, weather, laps, grid, tyres, assists) becomes a **"Race Setup" sub-screen** of option rows.
  - Row pattern from 040: label on the left and `‹ › value` on the right. Row height 3.0 vh, alternating fills `rgba(255,255,255,0.03)`.
  - The selected row has a 1.5 px white outline.
  - A right-side info card (`x 0.655–0.95`, title with a red 2 px underline, description, icon) explains the focused option.
- **Hide developer/evidence entries** (REFERENCE REVIEW, SESSION 146 EVIDENCE, PERFORMANCE CAPTURE, FULL-LAP VISUAL REVIEW in pause L559) behind `?dev=1`.
  They must never appear in the player-facing menu.
- Footer stats ("120 HZ SIMULATION…") move to Settings › About.

### 4.3 My Team HQ and facilities (`src/ui/team-hub.ts`, today a modal; CSS `style.css` L1514–1640; 3D `src/rendering/headquarters-stage.ts`)
- **Full-screen department template** (012, 013):
  - Background is a live 3D room render (HQ atrium, engineering bay with the car on a rotisserie, office).
  - Top-left block at `x 0.05, y 0.16`:
    - **Phase badge**: a 6.6 vh rounded square (radius 1.4 vh) with a 0.6 vh progress ring in the department colour. "PHASE" at 1.6 vh weight 700, "2" at 4.4 vh weight 800.
    - **Title**: 5.5 vh, weight 800, stretch 125 %, in the department colour (Engineering `#a8fccc`, Personnel `#a884cc`).
    - Workforce counter "👥 135 / 347" (3.0 vh, weight 800, with the "/ 347" in the department colour) and the note "Phase 3 unlocks at Workforce 405" (2.0 vh, weight 400).
  - Menu list below at `y 0.33` (§4.1). Sub-items:
    - Engineering: Research, Development, Assign Upgrades, Progress History, Component Management.
    - Personnel: Drivers, Workforce.
  - A divider, then "FACILITY IMPROVEMENTS" with a department-colour cog glyph.
- **HQ hub** (016/081/011): an exterior plaza or atrium. Cameras dolly between departments (1.2 s ease-in-out) when the department changes.
  Staff NPCs in team polos idle in the atrium. A hung show car, wood-slat walls, linear LED ceiling strips, polished tile floor with SSR/probe reflections, a team-colour dado stripe, glass partitions and a living wall.
- **Workforce** (014):
  - Left card `x 0.052–0.344, y 0.185–0.87`: "Facility Management", headline "ADJUST YOUR WORKFORCE LIMIT", income/outgoings, three department rows (`‹ › 151 / 387` plus cost).
  - Right stage: "YOUR WORKFORCE" (4.0 vh, weight 800) and a green status pill "CURRENTLY HIRING" (`#2fd33a`, corner brackets).
  - A hatch progress bar `x 0.46–0.835` with a flag marker. Stat footer: Weekly Cost, Resource Points, Research Time, Development Time.
- **Finances** (015):
  - Tab bar at `y 0.133–0.165`: active red pill and inactive dark `#2b2c33`. Tabs: Finances, Finance History, Cost Cap.
  - Three cards spanning `y 0.185–0.865`:
    - Team Balance `x 0.052–0.268` with weekly and season-progress sub-cards;
    - Next Contract `x 0.279–0.571` with driver cards: flag, first name light, SURNAME bold, rating 4.8 vh, and an EXP/RAC/AWA/PAC/FOC ladder with a bracket line plus a perception smiley;
    - All Transactions `x 0.581–0.948`: income/outgoing split bar, coloured-square ledger lines.
- **Team Rivalry / fan rating** (018): a character on the left. On the right, a yellow-bracketed card containing:
  - an "INTENSITY INCREASED!" yellow gradient pill;
  - the status "HEATED";
  - team points (6.0 vh) with an outlined "BEATING RIVAL" headline;
  - a rival card with a yellow hatch.

### 4.4 Driver select and driver icons (017, 019)
- The speed-tunnel backdrop. Two characters, three-quarter view, centred (`x 0.27–0.83`). Key light warm 5200 K at about 35° high. **Red rim light `#ff2a4a` from behind left, cyan `#5ad0ff` rim from the right.**
- A vertical repeated "RACE WEEKEND" text strip at the left edge (1.8 vw wide), in a gradient from red `#e8304a` to blue `#3f6bff`.
- Driver cards at `x 0.052–0.225` (left) and `0.775–0.948` (right, mirrored):
  - flag plus first name (2.0 vh, weight 500), SURNAME (2.6 vh, weight 800);
  - a bracket-framed rating block: "65 RTG" at 6.0 vh;
  - five stat rows at 3.5 vh with a hatch background. The best stat is green `#3fd04a`.
- Driver Icons list (019): the list menu on the left, a help box with corner brackets and a dotted leader at `x 0.045–0.37, y 0.70–0.92`, and a right-side summary list with red checkbox squares.

### 4.5 Customisation, livery and decal editor (031, 005, 032, 033; `src/ui/decal-editor.ts`, `src/ui/photo-studio.ts`)
- **Studio stage**: a black cyclorama `#050506 → #1c1c1f` with a 1.2 m soft key from the top-left, a rim light and a dark glossy floor reflection (005).
  The car is shown at a 3/4 front view by default and in orthographic-like side views (long lens, vertical FOV 14°) while editing (031).
- **Decal slot rail** (031): `x 0.052–0.117, y 0.11–0.88`, header "Slot 9/10" with ˄/˅.
  Tiles are 6.5 vw × 9.5 vh, radius 6 px, `#2a2a2e` with a 1 px `#4a4a50` border. The selected tile has a 2 px white border and is 8 % lighter. Each tile holds a sponsor-logo thumbnail.
- **View selector**: bottom centre, "SIDE (LEFT)" (weight 700, 1.9 vh) with a 3 vw × 2 px red `--fe-accent` underline at `y 0.807`,
  and pagination dots (0.7 vh, white 35 % / active 100 %) with ‹ › at `y 0.857`.
  Views: Front, Rear, Top, Side L/R, Nose, Engine cover, Rear wing, Front wing, Sidepod L/R…
- Livery stack: base pattern, then 3 colour zones (primary, secondary, accent with metallic/matte/gloss/chrome/iridescent finish), then sponsor slots (title, secondary ×4), driver number font and colour (032), helmet, suit, gloves.
  Finishes map to `src/rendering/paint-finish.ts`.

### 4.6 Photo mode UI (refs show results only, 075–080; this is pattern-derived)
- The left panel `x 0.02–0.24` is a tabbed vertical list: CAMERA, LENS, FOCUS, EXPOSURE, EFFECTS, FRAME, using the 040 option-row pattern.
  - Controls: FOV/focal length (12–300 mm), aperture f/1.4–f/22, focus distance with an auto-focus-on-car toggle, exposure ±3 EV, shutter-speed motion blur (1/30–1/2000 s), roll, vignette, grain, colour filter, letterbox and frame overlays.
  - Hide all HUD. Show a rule-of-thirds grid at 15 % white while moving the camera.
- Bottom-right prompts: "Take Photo", "Hide UI", "Reset", "Exit".
- **Rendering features the refs demand**: wheel-rotation blur, pan blur at 1/60 s, background compression and bokeh (075–080).

### 4.7 Leaderboards and accessibility (069, 040)
- Time-trial leaderboard (069):
  - Tabs: GLOBAL (red pill) and FRIENDS (dark), with LB/RB glyphs.
  - Title "GREAT BRITAIN (R)" at 4.6 vh, weight 800; subtitle the circuit name.
  - Table on a dark translucent card. Columns: POS, DRIVER, TIME, DATE, TEAM, CUSTOM SETUP, ASSISTS.
  - Row height 3.6 vh. The own row is pinned at the bottom with a lighter fill.
  - Footer: "Total: 31371 Players  Leaderboard Ranking: Top 97%".
  - **Local-only implementation**: scores are stored on the device.
- Accessibility (040) is the canonical settings-list pattern:
  - section header in weight 700 with a 1 px underline;
  - dependent rows are dimmed (`#e8a7a0` text at 55 % for disabled children);
  - slider value bars are 6.5 vw × 0.6 vh white with a numeric value;
  - right info panel with a title, red underline and description.

---

## 5. Gameplay features visible in the references

Status in this repo: **Y** = exists, **P** = partial, **N** = missing.

| # | Feature | Seen in | Repo status / note | Priority |
|---|---|---|---|---|
| 1 | Formation-free standing start with 5-light gantry plus HUD lights | 094 | Y (`H.LIGHTS`, physical gantry); HUD restyle needed | High |
| 2 | Clutch launch (hold, then reach optimal RPM) | 094 | P (`F.CLUTCH_*` exist, no prompt UI) | High |
| 3 | ERS modes: harvest / reduced / balanced / overtake button | 094, 095, 089 | P (3 modes; no overtake button or labels) | High |
| 4 | DRS zones, detection and activation, DRS pill | 089, 097 | **N** (no DRS in the sim) | High |
| 5 | Tyre compounds S/M/H/I/W in tower and MFD | 085, 089, 095, 097 | P (compound in sim; not per car in the tower) | High |
| 6 | Sector timing purple/green/yellow | 084, 085, 089, 094, 095, 097 | P (`F.SECTOR_1..3`; no colour UI) | High |
| 7 | Fastest-lap indicator (purple row) | 097 | N | Med |
| 8 | Pit stop: pit lane timer, stop time, box mini-game, crew animation | 095, 004, 071, 092 | P (pit phases, crew, `F.PIT_CLOCK`; no timing mini-game or panel) | High |
| 9 | Pit limiter | — (convention) | P (sim pit speed) | Med |
| 10 | Flags (yellow, double yellow, blue, chequered) | — | Y (sim); banner UI needed | High |
| 11 | Safety car / VSC | — (F1 25 core) | **N** | Med |
| 12 | Flashback / rewind | — (F1 25 core) | **N** (the replay buffer exists → reuse it) | Med |
| 13 | Formation lap | — | N | Low |
| 14 | Time trial: ghost, personal best, delta, leaderboard | 069, 070, 072, 074 | P (programme, delta; **no rendered ghost car**, no leaderboard) | High |
| 15 | **Reverse layouts** (Silverstone R, "GREAT BRITAIN (R)") | 069, 070 | N (cheap: reverse the spline direction plus the grid) | Med |
| 16 | Weather: wet, changeable, full-wet tyres, spray, rain light | 068, 082, 093, 096 | Y/P (weather exists) | High (visual) |
| 17 | Night races (floodlights, LED structures) | 087, 039, 079 | P (night presentation exists) | Med |
| 18 | Career / **My Team**: departments, phases, workforce, finances, rivalries, driver market, icons | 011–019 | P (team hub modal) | Med |
| 19 | **Braking Point** story: objectives, scenarios, cutscenes, presenters | 089, 097, 020, 086 | P (team-media script); objective HUD missing | Med |
| 20 | F2 / support-series HUD variant | 084 | N | Low |
| 21 | Replay with full tower, broadcast cameras, highlights | 039, 041, 042 | P | Med |
| 22 | Photo mode | 075–080 | P (`photo-studio.ts`) | Med |
| 23 | Livery editor, decals, driver number, sponsors | 005, 031–033 | P (`decal-editor.ts`) | Med |
| 24 | Racing-line assist (colour-graded) | 089, 097 | P (`driving-guide.ts`) | Med |
| 25 | On-wheel MFD setup changes (brake bias, diff) | 070, 088 | P (data exists in the drawer) | Med |
| 26 | Name tags over cars | 085, 094 | N | High (cheap) |
| 27 | Accessibility audio cues (braking, turn, wrong way, track limit) | 040 | P (`audio-accessibility.ts`) | Low |
| 28 | Wheel-peripheral support | 048, 049 (articles) | P (device calibration; no native FFB) | Low |
| 29 | Damage and debris, off-track dust/gravel clouds | 041 | P (debris; dust visual weak) | Med |
| 30 | Team radio / engineer channel icon | 085, 089 | N (UI plus a few scripted lines) | Low |

---

## 6. Visual notes that the official shots don't show

1. **Exposure and colour.**
   - Review frames are bright and neutral. The clear sky is `#90caf3` at the zenith and `#c5daed`–`#e3e3e1` at the horizon (044, 089). The overcast sky is a flat `#f1f1ef` (085).
   - The baseline sky reads `#385160`–`#577583` at the top. That is darkened by the HUD scrim and has a teal cast, so remove the scrim and cut the teal.
   - **Sunlit asphalt is a warm mid-grey `#7d7369`** (066). Baseline asphalt is `#3d3e42`–`#404045`: too dark, too cold and too uniform.
   - Luminance means: refs 087–167/255 (074 day = 167). Baseline driving = 67–106.
   - Raise the day key. Asphalt albedo should be about 0.18–0.22, not about 0.08.
2. **Asphalt detail.**
   - Darker rubbered racing line, about 2.5 m wide at roughly 15 % darker.
   - Braking-zone skid streaks (066, 085). Marbles off-line.
   - Repaired patches. Painted grid boxes with worn edges (046).
   - Dappled tree shadows across the road on forested sections (089): high-frequency foliage shadow needs a ≥2048 shadow map, or a projected cookie for tree canopies.
3. **Kerbs and run-off.** Every venue has a signature painted run-off: Miami teal `#3fb6b8` with white/red kerbs (066), Bahrain blue/teal stripes (039), Spa red/yellow/black bands (076), Imola green-white-red (044). Aurel should get its own signature run-off pattern; it currently uses red/white only.
4. **Trackside density.**
   - Continuous sponsor hoardings on every wall face (TAG-style navy, DHL-yellow `#ffcc00` with red, Pirelli yellow).
   - Overhead branded gantries (088).
   - Catch fence with poles every ~4 m, three tensioned cables, mesh visible in close-ups (087, 095).
   - Armco triple rail (033). TecPro barriers with branding (066).
   - Marshal posts and photographers (043).
5. **Crowds.**
   - Dense, multicoloured, packed tiers. Hand-held national flags waving (044). Hillside general-admission crowds (078).
   - Grandstand roofs with a deep shadow under them (076).
   - Under pan blur, a crowd reads as a colour smear, so cheap impostors work in motion shots.
6. **Wet racing** (068, 082, 093, 096).
   - Flat white-grey sky. A reflective dark road with sky reflection (Fresnel).
   - **Spray plumes 2–4 car lengths long** from the rear tyres and the diffuser, white `#e8ecef` at 0.35 alpha.
   - Rain light: a 4×5 LED grid with emissive intensity 6, flashing in the wet with a bloom halo.
   - Droplets beading on bodywork and the halo in the cockpit cam. Mist reducing contrast beyond 150 m.
   - Full-wet tyres have a **blue/teal sidewall band `#1f9fc4`**.
7. **Night** (039, 087, 079).
   - Pools under floodlights with a cool 5600 K key. Emissive boards and LED structures.
   - Car paint picks up multiple specular highlights. The sky is a deep `#0b0d14`, not pure black.
8. **Cars.**
   - Saturated liveries with a crisp clear coat and sharp environment reflections (047, 090, 077).
   - Exposed carbon weave on the floor, wing endplates and halo (070, 077).
   - Soft-compound sidewalls are pink-red `#e85a78` in many shots (078, 080).
   - Wheel covers are team coloured. Tyre sidewall branding is readable.
   - Rotation blur on wheels at speed, plus contact shadows and AO under the floor.
9. **Characters** (043, 017, 018, 086). Skin with SSS and pore detail. Hair cards. Suits with patch embroidery and fabric weave. Caps.
   Three-point lighting with a coloured rim in menus, and shallow depth of field with bokeh in paddock shots.
10. **Atmospherics.**
    - Dust and gravel clouds are volumetric, sunlit and long-lived (2–3 s) (041).
    - Heat haze behind the exhaust on the grid.
    - Aerial perspective on distant hills toward a blue-grey `#b9c7d6`. The current fog is FogExp2 `0xb9c7c1` at 0.00044 (`renderer.ts` L326): shift it slightly bluer to `#b8c6d4`.

---

## 7. Ranked: the 15 highest-impact UI, feature and visual changes

1. **Re-skin the in-race HUD to the F1 25 language.** Upright type, glass panels with a light outline and rounded corners. Remove the italics, skews, orange flame accents, the top scrim, the APEX/position/session chips and the bottom action bar during driving.
   (`style.css` L2513–3300, L370–376; `interface.ts` L153–164; `race-day-hud.css`.) *Biggest single perceived-quality jump; low risk.*
2. **Bottom-centre binocular cluster**: ERS arc, gear, speed/RPM, 15 rev LEDs, DRS pill and mode text, replacing the bottom-right block (§1.5).
3. **Raise the daylight key and fix asphalt albedo and sky colour** (§6.1–6.2): warm mid-grey asphalt with a rubbered line and skid marks, neutral blue sky. Currently the frame is dark and teal.
4. **Cockpit and chase camera framing** to the measured targets: cockpit vertical FOV 64 → about 52 with the eye 8 cm forward; chase FOV 50 at distance 4.8 m (§2.1). The car and wheel then read at F1 25 scale.
5. **F1-style timing tower**: surnames, team logos, tyre icons, interval column, 5-row player window, purple fastest-lap row, light player row (§1.2).
6. **Sector panel with purple/green/yellow tabs**, position "6 / 20", current/best lap and a progress line, using the existing `F.SECTOR*` data (§1.3).
7. **Full-colour steering-wheel LCD plus physical rev/flag LEDs** with emissive bloom (§2.2). This is the cockpit hero element.
8. **Mini-map rebuild**: sector numbers, DRS zones, chequered S/F, outlined team dots, yellow player triangle, local-snake option (§1.6).
9. **Start-light HUD, clutch-launch prompt and race-control flag banners** (§1.9), replacing the 18 px dots and text-strip messages.
10. **Front-end overhaul**: speed-tunnel backdrop shader, left list menu with a pill selection, red category tags, option rows with an info card. Hide all dev/evidence buttons behind `?dev=1` (§4.1–4.2).
11. **DRS system** (simulation zones, detection, activation, HUD and mini-map) and an **overtake button** for ERS. These are the two most visible missing F1 mechanics (§5 #3, #4).
12. **Name tags and edge chevrons for proximity** (§1.8). Cheap, and they immediately read as "F1 game".
13. **Pit-lane experience**: PIT LANE / STOP TIME panel, box-entry timing mini-game "TURN-IN OPTIMAL", pit-limiter state, crew animation polish (§1.9, §5 #8).
14. **Replay and broadcast presentation**: full-field tower, REPLAY badge, auto-hiding transport, letterboxed cinematic cameras with pan motion blur and dust, highlight tags (§3).
15. **My Team full-screen department screens** in the live HQ 3D stage (phase badge, coloured titles, workforce and finance cards), plus a driver-select screen with rim-lit characters (§4.3–4.4).

Honourable mentions: time-trial ghost car with a local leaderboard and reverse layouts (§5 #14–15), flashback rewind built on the replay buffer, and a virtual rear-view mirror overlay.
