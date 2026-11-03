# Trailer storyboard (75 s main trailer + 30 s cut-down)

Every shot is a moment the build can already produce, named with its real venue, vehicle and
weather so it can be captured, not mocked up. Ids refer to the catalogue in
`src/simulation/circuits.ts` and `src/simulation/vehicles.ts`; the weather presets that exist
today are *Clear / Dry*, *Dry → Rain* and *Heavy rain* (`src/simulation/config.ts`), and the
festival world is the Solvane Coast region (`src/simulation/open-world/region-data.ts`).
Shots marked **[PENDING]** depend on content other studio departments are still building and must
not be captured until it exists; shots marked **[CURRENT]** can be recorded from the packaged
desktop build today.

## Rules for capture

- Record from the **desktop build on a real GPU** at 1920x1080 60 fps minimum (4K if the
  machine holds 60). Software-GL captures (all evidence in this repository so far) are not
  representative and must never reach a store page.
- Use only in-game cameras, the in-game replay and photo mode. No post-composited effects that the game cannot show, no mock UI. Honest rule
  (Steam also requires it): the trailer shows gameplay footage; any pre-rendered or edited
  material is labelled.
- Audio: the game's synthesised engine/tyre audio plus an **original or CC0/CC-BY-credited**
  music bed. No licensed tracks. Music licence goes into `LEGAL_CHECKLIST.md`.
- Keep HUD on for at least half the shots; Steam reviewers and players want to see what they
  will actually play.
- Lower-third captions use the game's own typography (see `CAPSULE_AND_ART_BRIEF.md`): uppercase,
  letter-spaced, vermilion accent.

## Shot list

| # | Time | Shot | Discipline | Venue (id) | Vehicle (id) | Weather / light | Camera | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 0:00-0:04 | Cold open on the paddock showroom: slow orbit of the car, title fades in over it. | Circuit | AUREL / GRAND CIRCUIT (`aurel`) | APX-01 FORMULA (`apx01`) | Clear, day | Menu showroom orbit | CURRENT |
| 2 | 0:04-0:09 | Start lights go out; low chase through the first corner with the pack. | Circuit | `aurel` | `apx01` + 7 rivals | Clear, day | Chase, then grid-presentation cut | CURRENT |
| 3 | 0:09-0:14 | Night street run, the car's lights and the venue's lighting carrying the frame; look for a slide past a barrier on a clean lap. Caption: *CIRCUITS THAT DON'T LOOK LIKE CIRCUITS.* | Circuit | NEON CITY / NIGHT STREETS (`neon-city`) | GT-10M MID-ENGINE GT (`gt10m`) | Clear, night | Low front 3/4, then T-cam | CURRENT |
| 4 | 0:14-0:19 | Harbour streets in heavy rain: spray and low grip, ending in the cockpit view. Caption: *WEATHER THAT CHANGES THE RACE.* | Circuit | RIVIERA / HARBOUR STREETS (`riviera`) | FX-26 FORMULA (`fx26`) | Heavy rain | Chase, then cockpit | CURRENT |
| 5 | 0:19-0:24 | Lean angle through a coastal corner, knee near the kerb, rider's head turning in. | GP bike | VELLAMAR / COAST CIRCUIT (`vellamar`) | GP-R1 PROTOTYPE (`gpr1`) | Clear, day | Trackside pan, then rider cam | CURRENT |
| 6 | 0:24-0:29 | Superbikes on a long road circuit, grid start then the first corners; the rain arrives in the second half (Dry → Rain preset). | GP bike | HAARVELD / TT CIRCUIT (`haarveld`) | SBK-1000 SUPERBIKE (`sbk1000`) | Dry → Rain (second half) | Helicopter, then chase | CURRENT |
| 7 | 0:29-0:35 | Gate drop, holeshot, then the first big hillside jump; hang time, landing on both wheels. Caption: *MOTOCROSS. REAL JUMPS.* | Motocross | VALLEY RIDGE / MOTOCROSS (`valley-ridge-mx`) | MX-450 MOTOCROSS (`mx450`) | Clear, day | Rider cam into trackside slow-mo at the lip | CURRENT |
| 8 | 0:35-0:40 | Floodlit rhythm section, roost lit by the floods, riders stacked. Caption: *SUPERCROSS.* | Supercross | ARENA NORD / SUPERCROSS (`arena-nord-sx`) | MX-250 TWO-STROKE (`mx250`) | Floodlit night | Low trackside, then chase | CURRENT |
| 9 | 0:40-0:46 | The hook: a machine that does not belong at the venue, and it is brilliant. Caption: *WILDCARD: WRONG CAR. RIGHT TRACK.* Candidates once the series exists: trophy truck on the supercross tabletops; GT car on the gravel stage; superbike on the dirt-bike course. Until then the nearest real pairing is DX-8 on the rally stage below. | Wildcard | **[PENDING G6]** | **[PENDING G6]** | any | Chase | PENDING |
| 10 | 0:46-0:50 | Trophy truck through the forest, gravel and loose surface kicked up. | Rally / off-road | PINEWOOD / GRAVEL STAGE (`pinewood-stage`) | DX-8 TROPHY TRUCK (`dx8`) | Clear, day | Chase, hood | CURRENT |
| 11 | 0:50-0:56 | Open-world: coast road at golden hour, the supercar flat out past the lighthouse. Caption: *THEN LEAVE THE TRACK.* | Festival | Solvane Coast, Coast Highway | SC-7 SUPERCAR (`sc7`) | Clear, golden hour | Chase, bonnet, drone | CURRENT |
| 12 | 0:56-1:01 | Drift zone: the roadster hangs the tail through the hairpins, score counter climbing. | Festival | Varda Hairpins Drift Zone (Solvane Coast) | RD-2 ROADSTER (`rd2`) | Clear, day | Trackside, T-cam | CURRENT |
| 13 | 1:01-1:05 | Airfield showcase: the car launches off the runway edge on a jump; skill chain banks. | Festival | Kestrel Airfield (Solvane Coast) | RD-2 ROADSTER (`rd2`) | Clear, day | Side-on slow-mo | CURRENT |
| 14 | 1:05-1:08 | Photo mode: freeze on a livery, depth of field, the shutter UI visible. | Photo | `aurel` pit straight | APX-01 (`apx01`) with a custom livery | Clear, dusk | Photo studio | CURRENT |
| 15 | 1:08-1:12 | Podium and results card, then a rapid montage (one second each) of shots 2, 5, 7, 11. | Mixed | various | various | various | Replay cuts | CURRENT |
| 16 | 1:12-1:15 | End card: MOTOBOUND logo on the charcoal panel, "Wishlist now" and the release window. | | | | | | Design |

## Cut-down (30 s, for the store autoplay and social)

Shots 2, 7, 5, 11, 9, 15 at 4-6 s each, no captions except the first and last. Autoplay on a Steam
page is muted: the first three seconds must be understood without sound (the lights going out,
a jump, a lean).

## Gaps before this can be filmed honestly

- Shot 9 needs the Wildcard series (gate G6). Without it the trailer's own promise is missing.
- Weather: only three presets exist. A fog/storm/snow shot is not storyboarded until those states
  are in the game (gate G6 asks for six).
- Any shot that includes menus must be re-captured after the UX/UI pass; today's menu is in
  transition (gate G5).
- The trailer needs a real GPU capture machine (gate G8); none was available to the release
  department.
