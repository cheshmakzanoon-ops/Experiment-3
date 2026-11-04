# Store page kit: MOTOBOUND

Working copy for the Steamworks store page. **Every claim below is limited to what the current
build contains**; items that depend on unfinished studio gates are marked **[after G#]** and
must be removed or kept out of the page until that gate is closed. Numbers that are not
measurements are labelled *assumption*.

## Short description (Steam allows 300 characters)

> Race circuit cars, GP bikes, motocross and supercross on 47 circuit layouts, then leave the
> track for an open-world coast festival. Changing weather, replays, a livery editor, licence
> tests and a career. Offline, single-player, built to be driven with a pad or a wheel.

(292 characters. Add "A Wildcard series pairs the wrong machine with the right track." only
**[after G6]**.)

## Long description

**About**

MOTOBOUND is a motorsport sandbox for people who like their racing varied. You start in the
paddock, pick a machine and a venue, and drive: single-seater and GT cars, GP motorcycles, and
dirt bikes on motocross and supercross courses, with real tyre, suspension and aerodynamic
models behind every one of them. Between races you build a career, a team and a livery, or
leave the circuits altogether and roam a coastal festival region full of races, speed traps,
drift zones and jumps.

**Four disciplines, one garage**

Circuit cars from entry formula to hypercars and GT, touring cars, prototypes, karts, rally and
rallycross cars, a trophy truck and road cars; GP and road motorcycles with lean angle,
trail-braking and brake fade; and motocross and supercross bikes with long-travel suspension,
deformable soil and real jumps. 57 machines in total, each with its own handling, setup and
sound.

**47 circuit layouts**

Street circuits, an airfield, mountain and desert roads, docklands, a night terminal, a salt
flat, forest rings, a speed bowl, a hillside motocross course, a floodlit supercross arena, a
rallycross track and a gravel stage. Layouts are original designs and approximations drawn from
public geometry; no real venue names are used.

**Weather and light**

Clear, dry-to-rain and heavy-rain sessions change grip, spray, braking and the line you must
take. **[after G6: six or more weather states and time of day.]**

**The festival**

Step out of the paddock into the Solvane Coast: a road network with a harbour town, an
airfield, a mountain pass and coastal highways. Join races against rivals, chase speed-trap and
speed-zone targets, score drift zones, land jumps and bank skill chains, discover new places,
and photograph it all in photo mode.

**Career, team and licences**

Earn licences with medal-graded tests (braking, cornering, wet control, lean, jump landing),
enter championships, buy and tune machines, and run your team from the Team HQ.

**For the obsessive**

Instant replay and a 30-second flashback, telemetry with export, time-trial ghost laps with
local leaderboards, a livery and decal editor, per-vehicle setups, wheel and pedal calibration,
gamepad rumble channels, colour-blind, high-contrast, reduced-motion and caption
options.

**Offline by design.** No account, no always-online requirement, no microtransactions, no ads.
Steam achievements (54) and Steam Cloud saves are supported **[after the Steam checks in
`desktop/STEAM.md` pass on a real client]**.

## Six feature bullets (for the "Key features" block)

1. **Four disciplines on one engine**: circuit cars, GP motorcycles, motocross and supercross.
2. **57 machines and 47 circuit layouts**, from karts and hypercars to dirt bikes and a trophy truck.
3. **Dry, damp and soaked**: weather that changes grip, braking and the racing line.
4. **An open-world festival** with races, speed traps, drift zones, jumps and a photo mode.
5. **Career, licences and a team** to build over many hours, plus a livery editor.
6. **Tools that reward practice**: replay, flashback, telemetry, ghost laps and 54 achievements.

## Tags (Steam allows 20; ordered by importance)

Tick these now: **Racing, Driving, Simulation, Motorbike, Open World, Singleplayer, Offroad,
Controller, Physics, Sports, 3D, Atmospheric, Sandbox, Automobile Sim** (and *Photo Mode* if the editor offers that tag).

Hold back until true: *Realistic* (qualifier needed), *Arcade* (only if playtests show the
assist mode plays that way), *Moddable* (only if a mod path ships; see `LAUNCH_PLAN.md`).
Never tick: *Great Soundtrack* (no soundtrack ships), *Co-op* / *Multiplayer* (single-player).
Check the live tag list in the Steamworks tag editor; names change.

Categories: Single-player; Steam Achievements and Steam Cloud **[after verification]**;
Partial Controller Support **until the menus are navigable by pad** (then Full); Family
Sharing on.

## Genre positioning (what the game honestly is)

A **sim-cade multi-discipline racer** with an indie scope: more breadth than the cheap arcade
racers, less authority and polish than the AAA simulators. The pitch is variety on one engine
and the oddball pairing of machine and venue, not simulation purity. Comparable shelf: indie
and mid-price racers with strong physics and community modes, not the big licensed series.
Do not describe it as "realistic" without a qualifier; do not compare it to licensed titles on
the page.

## System requirements

**Measured** (release engineer, packaged Linux x64 Electron 44 build, 4 shared CPU cores,
**software rendering** only; no physical GPU or Windows/macOS machine was available):

| Quantity | Measured | How |
| --- | --- | --- |
| Install size (game data) | 166.3 MiB (174,351,814 bytes, 249 files) | `desktop/web` staged without source maps |
| Install size (Linux unpacked, game + Electron) | 451.5 MiB (473,455,496 bytes); the Electron executable alone is 229 MB | `du -sb` of `linux-unpacked` |
| Download size (zip of that folder) | Linux zip 236.3 MB, Linux AppImage 243.7 MB, Windows zip 270.2 MB (built from Linux, never run) | `desktop/release/*` |
| Main JavaScript | 14.6 MB raw, 4.5 MB gzip | `dist/assets/index-*.js`, `gzip -c` (gate G7 wants <= 4 MB gz) |
| Memory at the menu | 1.42-1.45 GiB in total (browser 167 MiB, renderer 539-544 MiB, GPU process 637-659 MiB, utility 75 MiB); the GPU-process share is SwiftShader's software rasteriser and will differ on a real GPU | `app.getAppMetrics()`, all processes, working set |
| Memory in a practice session | not measured: on the loaded software-GL machine the session load stalled at 94% after the GPU process died (see the release report) | same, 5 s after the car was on track |
| Time to menu | 89 s (existing profile) to 100 s (fresh profile), packaged build, machine at load average 14-18; **not representative** of a GPU | software GL |
| Simulation cost | not measured (needs a running session) | physics step in the worker (`H.STEP_MS`), CPU only |
| Frame rate | not measurable | SwiftShader on shared CPUs gives single digits and says nothing about a GPU |

**Requirements text for the page** (the measured RAM includes the software rasteriser's
buffers, so the GPU-process share will be lower on real hardware: *assumption*; confirm on
three real machines before publishing):

- **Minimum:** 64-bit Windows 10 / SteamOS or Ubuntu 22.04-class Linux / macOS 12; 4-core CPU
  (*assumption: the simulation runs in a worker thread beside the render thread*); 8 GB RAM;
  a GPU with WebGL 2 / Vulkan 1.1 or DirectX 11 class support and 2 GB VRAM (*assumption*);
  4 GB of storage; a gamepad or keyboard.
- **Recommended:** 6+ cores, 16 GB RAM, a GPU in the class of a mid-range card from the last
  five years with 4 GB VRAM (*assumption*), SSD, a gamepad or wheel.
- Steam Deck: **unverified** (`STEAM_DECK_CHECKLIST.md`).

WebGL 2 is a real requirement (three.js r180's renderer is WebGL 2 only); the GPU class is not
yet measured (gate G8). Replace the assumptions with measurements from a minimum-spec GPU before
launch.

## Price recommendation (net-revenue arithmetic)

Source of the target and the 30% cut: [`RELEASE_GATES.md`](../RELEASE_GATES.md). Net US$5,000 per
month at a 30% Steam share needs gross revenue of 5,000 / 0.70 = **US$7,143 per month**.
Taxes (VAT/sales tax) are handled by Steam before the split and are ignored here.

Units per month needed to reach that gross, by list price:

| List price | Net per unit at list | Units/month at list price | Units/month if the average realised price is 75% of list (*assumption*: regional pricing and discounts) |
| --- | --- | --- | --- |
| US$9.99 | 6.99 | 715 | 953 |
| US$14.99 | 10.49 | 477 | 636 |
| US$19.99 | 13.99 | 357 | 476 |
| US$24.99 | 17.49 | 286 | 381 |

(Add refunds on top: at an *assumed* 8% refund rate, gross units must be about 1/(1-0.08) =
1.09 times these. The gate G14 target is < 10%.) A one-time Steam Direct fee (US$100 per app at
the time of writing) is recouped after US$1,000 of revenue; it is negligible against the target.

**Recommendation (an opinion, not a forecast):** launch at **US$14.99** with a 10% launch
discount for the first two weeks (US$13.49). Reasons: the product has not yet passed the
first-launch, front-end, Deck or performance gates (G3, G5, G7, G8), so the risk that matters
most is a poor first two hours and the refund window; a lower price makes the score easier to
earn and lowers the refund incentive, and the score (G14: >= 80% positive) drives discovery
more than the margin. Steam's regular sale windows will push the realised price below list in
any case, which is why the realised-price column is the one to plan on.

Raise to **US$19.99** only after (a) the Wildcard series and six weather states have shipped,
(b) at least 50 reviews are >= 80% positive, and (c) a content update has actually changed the
page (a price rise after launch with no new content costs goodwill). At US$19.99 the realised
need is about 476 units a month; at US$14.99 it is about 636. The plan to reach either figure
is in `LAUNCH_PLAN.md` and is unproven.

**Alternative to weigh:** Steam Early Access at US$12.99 while G12-G14 are open. It turns the
"not finished" problem into an honest label and a community loop, at the cost of a second
"launch" later and the Early Access stigma some players hold. This is a producer decision, not
an engineering one.

## Demo page (Steam Next Fest)

The demo is a separate Steam app built from the same source (`npm run build:demo`, content slice in
`src/release/demo.ts`, packaging in `desktop/README.md`). Everything below is what the demo build
contains; counts come from the catalogues, not from memory.

> **MOTOBOUND Demo.** Race a formula car on two circuits, take a GP bike round the coast circuit,
> ride a motocross bike over a hillside course, and try five Wildcard events that put the wrong
> machine on the right track: a formula car down a fogged mountain pass, a trophy truck on the iced
> col, GP bikes in the docklands. Then take an electric hypercar or a roadster onto the Solvane
> coast for 15 minutes. Weather, time of day, replays and the photo studio are all open. The full
> game has 48 more circuits, 53 more machines and 24 more Wildcard events (counts at merge time, 51 circuits / 57 machines / 29 events in total; the in-game demo plate computes them live and is authoritative).

- **Contains:** 3 venues (Aurel and Vellamar circuits, Valley Ridge motocross), 4 machines
  (APX-01 and FX-26 formula cars, GP-R1, MX-450), 5 Wildcard events, the first licence (braking),
  a 15-minute visit to the coast in 2 road cars. Locked content is listed on the board as FULL GAME.
- **Does not contain:** anything the page above does not name. Demo progress is not carried into the
  game.
- **Wishlist button:** opens the full game's store page through the desktop shell
  (`MOTOBOUND_STORE_APPID`, `desktop/STEAM.md`); the web build has no button and no network.
- **Open before Next Fest:** the demo's own Steam app id and depots; a real-client check of the
  wishlist button, Steam Cloud root `MOTOBOUND Demo/saves` and whether a demo may use achievements;
  Windows and macOS packages (built by `.github/workflows/desktop-packages.yml`, never run).

## Leaderboards: what may be claimed

Say **"local leaderboards, ghost laps and a records screen"**. Do **not** say "Steam leaderboards" or
"global leaderboards" yet: the upload path exists and is unit-tested with a fake client, but the
Steam binding in use (steamworks.js 0.4.0, the latest release) has no leaderboard calls, so nothing
reaches Steam (`desktop/STEAM.md` "Leaderboards" lists the options). Rich presence is wired with ten
statuses; it is unverified against a real client.

## Capsule, library and icon art

Built from real game frames and the original vector brand by `scripts/studio/tools/capsule-art.mjs` (identity and
rules: [`BRAND.md`](BRAND.md); the slot-by-slot Steamworks list: [`ART_UPLOAD_CHECKLIST.md`](ART_UPLOAD_CHECKLIST.md);
size, SHA-256 and source frames of each file: `art/manifest.json`; everything at a glance: `art/contact-sheet.png`).
The tagline on the capsules is `RACE THE WRONG MACHINE`. **All game frames are software-GL captures; retake them on a
GPU before upload (G8).** Alt text below is for the page's accessibility/alt fields and for the press kit.

| File | Steam slot | Alt text |
| --- | --- | --- |
| `art/capsule/header-920x430.png` (920x430) | Store page header capsule; library "recent games" header | MOTOBOUND key art: a motocross rider on the tarmac of a banked speed bowl with a rival ahead, beside the logo and the line RACE THE WRONG MACHINE on a dark board. |
| `art/capsule/capsule-small-462x174.png` (462x174) | Search results, "more like this", bundles | MOTOBOUND small capsule: the wordmark on a dark board beside a motocross rider seen from behind. |
| `art/capsule/capsule-main-1232x706.png` (1232x706) | Store front featured slot; Next Fest and sale placements | MOTOBOUND main capsule: the logo and tagline beside a motocross rider on a banked speed bowl, with four bands below for circuit, GP bike, dirt and festival. |
| `art/capsule/capsule-vertical-748x896.png` (748x896) | Store front and sale pages (portrait) | MOTOBOUND vertical capsule: the logo and tagline on a dark board above a motocross rider in the air in a forest, with bands below for GP bike, circuit and festival. |
| `art/library/library-capsule-600x900.png` (600x900) | Steam library grid (portrait) | MOTOBOUND library capsule: the original APX-01 formula car in a dark showroom above the logo and tagline on a dark board. |
| `art/library/library-header-920x430.png` (920x430) | Steam library "recent games" header (re-uses the header composition) | MOTOBOUND library header: the same art as the store header capsule. |
| `art/library/library-hero-3840x1240.jpg` (3840x1240) | Top of the library game page. NO text or logo (the logo is layered separately) | A white electric hypercar seen side-on on the Solvane coast road in low evening light, the sea on the horizon; the left of the picture is held dark for the logo. |
| `art/page/page-background-1438x810.jpg` (1438x810) | Behind the store page | A dark, blurred view of the Solvane coast road and a white hypercar, used behind the store page. |
| `art/library/library-logo-1280x720.png` (1280x720) | Layered over the library hero | The MOTOBOUND logo: amber roundel, chalk wordmark, three lane chevrons. |
| `art/library/library-logo-mono-white-1280x720.png` (1280x720) | One-colour fallback for the library logo | The MOTOBOUND logo in one colour. |
| `art/icons/community-icon-184x184.jpg` (184x184) | Steam community hub icon (JPG, no wordmark) | The MOTOBOUND roundel on dark asphalt. |
| `art/icons/client-icon-256x256.png` (256x256) | Steam client icon source and the desktop shell icon (replaces the placeholder in desktop/build/icon.png) | The MOTOBOUND roundel on dark asphalt. |
| `art/icons/icon-1024x1024.png` (1024x1024) | Master icon for ICO/ICNS conversion | The MOTOBOUND roundel on dark asphalt. |
| `art/event/event-banner-800x450.png` (800x450) | News and event posts (small event art) | MOTOBOUND event banner: the logo and tagline beside a motocross rider on a banked speed bowl. |

The animatic in `trailer/` is **not** the trailer: it is a silent film of stills (see `TRAILER_CAPTURE.md`). The store
page still needs a real-GPU gameplay trailer.

## Screenshots (store shot list)

Ten 1920x1080 JPEGs (quality 88) in [`screenshots/`](screenshots/), captured from the real game
by `scripts/studio/tools/store-shots.mjs` (headless Chromium, software GL, the FULL game build, render
preset High). `screenshots/manifest.json` holds the alt text and a per-shot note; `progress.log` the
run. Steam wants at least five; a trailer storyboard is in `TRAILER_STORYBOARD.md`. Order below is a
suggested page order: the board and the Wildcard hook first, then the disciplines and the weather.

| File | Shot | Alt text |
| --- | --- | --- |
| `menu-board.jpg` (217 KB) | The paddock board | The MOTOBOUND paddock board: four discipline plates, the venue sheet with its line-art map and the option dials, with the formula car under studio light. |
| `wildcard-board.jpg` (232 KB) | The Wildcard Series board | The Wildcard Series board: a list of mismatched machine and venue events beside the programme page of one event with its map, weather and medal ladder. |
| `gp-corner.jpg` (286 KB) | GP bike through a fast corner | A GP motorcycle rider hangs off the bike through a fast corner, seen from behind with motion blur, forested mountains behind. |
| `motocross-jump.jpg` (329 KB) | Motocross on the loam start straight | A motocross rider in a number 2 jersey accelerating up the loam start straight of a hillside course toward a grandstand, tyre ruts in the dirt and clouds above. |
| `festival-dawn.jpg` (362 KB) | The festival town in low sun | A white electric hypercar drives down a main street of the festival town, lined with brick and plaster buildings and shopfronts, a pink event beacon ahead under a low warm sun and a blue sky. |
| `snow-pass.jpg` (211 KB) | Trophy truck on the snow pass | A green trophy truck with an exposed roll cage and spare wheel driving away along a snow-dusted mountain road, snowy pines on both sides under a hazy blue sky. |
| `night-street-rain.jpg` (198 KB) | Wet street circuit under the lamps | A blue touring car with a rear wing drives down a wet city street circuit between lit office blocks and street lamps, its headlights glinting on the rain-slick asphalt. |
| `formula-fog-golden.jpg` (128 KB) | Formula car in fog at golden hour | A formula car at speed on the Vellamar circuit in dense golden fog, kerbs streaking past on the left and a grandstand fading into the haze. |
| `results-board.jpg` (185 KB) | The results board | The results board after a four-car race: second place highlighted with race time and gap, the classification table with lap times, the podium, a next-step card for the braking licence and buttons for replay, race again, share card and telemetry. |
| `photo-studio.jpg` (545 KB) | Photo mode and livery studio | The photo and livery studio on the Aurel grid: the formula car with two crew beside it, and the camera, filter, lens and exposure controls down the right. |

**Read before using them** (each was looked at, and these are the weak points):

- `motocross-jump.jpg` is **not a jump**: the rider is on the start straight at the crest of a
  roller. Do not caption it as a jump; retake on a GPU where the frame rate lets the poll catch the
  flight.
- `formula-fog-golden.jpg`: the fog preset is dense and flat, so it shows the weather more than a
  hero composition; replace it if a better frame is captured on a GPU.
- `results-board.jpg` comes from a race the in-game AI driver drove to reach the board: a layout
  shot, not a human result. `night-street-rain.jpg` reads as dusk with the lamps on.
- Software GL cannot show a GPU's frame rate, bloom or reflection quality. Retake the hero shots
  on a real GPU before launch (gate G8); the tool resumes and retakes by id
  (`--only gp-corner`).
- Rejected on review and retaken: the first fog frame (a replay seek that never left the start grid,
  then the car still rolling off the line on the Col d'Argent straight).
- Not captured: a Wildcard run in progress, a replay camera, drift or jump zones in the festival, and
  the demo's FULL GAME plates (those are in `docs/studio/reports/release-2-screens/`).

**Further 1920x1080+ frames** (marketing pass, `art/frames/`, framed with the game's photo studio, no HUD, same
software-GL limits; the table with the camera values and notes is `art/frames/manifest.json`): `mx-jump-side.jpg` is a
real in-air frame and replaces `motocross-jump.jpg` as the dirt shot (that file is still not a jump); `gp-lean-side.jpg`
(a GP bike at 0.61 rad lean, side-on, no environment); `night-gt-neon.jpg` (a GT car in the neon-city tunnel at night);
`wildcard-knobblies-banking.jpg` (the Wildcard hook: a motocross bike on the banked speed bowl, chase camera);
`apx01-showroom.jpg` and `apx01-portrait.jpg` (the hero car without the paddock board); `coast-eh3-wide.jpg`
(3840x1240, the EH-3 on the coast road; a parked traffic car intrudes bottom-left, taken before the tool learnt to
turn ambient traffic off). Lead the page with a HUD shot: the trailer keyframes in `trailer/keyframes/` (when captured) keep
the HUD on.

## Not for the page until true

- "Full controller support" (gap: menu navigation).
- "Steam Deck Verified".
- Any Wildcard, weather-count, or "live" claims listed above as **[after G#]**.
- Review scores, sales or wishlist numbers: none exist.
- Languages other than English: model-written drafts for de, fr, es, pt-BR, it, pl and tr are in
  [`localized/`](localized/); list a language in Steamworks only after a native review of the page
  **and** of the in-game dictionary (`docs/studio/reports/localization.md`).
