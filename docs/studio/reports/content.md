# Content Design (tracks and events) — Wildcard series report

Everything below comes from commands run in this worktree (branch `worktree-agent-ab1c5bb86a15196ba`);
anything not run is labelled "not run" or "not verified".

## Scope

The mission was the game's signature hook, a WILDCARD SERIES of events that pair a machine with a venue it
was never meant for, built on the existing event machinery (`EventDefinition` / `eventSession` / rulesets /
the career's `settleRace` and `Medal`), validated by real seeded AI sessions, with no UI.

## Integration contract (for the UX Director)

Everything a menu needs is in `src/career/wildcard-series.ts`. No new store, no UI, no change to `EVENTS`
(see "Why the events are not in `EVENTS`").

```ts
import {
  wildcardSeries, wildcardEntry, wildcardSession, wildcardKey,
  wildcardMedal, wildcardMedalFromRecord, wildcardCareerEvent, wildcardDiscipline,
} from '../career/wildcard-series.ts';

wildcardSeries(): readonly WildcardEntry[]      // menu order, frozen
interface WildcardEntry {
  id: string;            // kebab-case; career record key is wildcardKey(e) === `wildcard.${id}`
  title: string;         // UPPERCASE menu title, <= 48 chars
  pitch: string;         // one line, <= 140 chars
  kind: 'cross-discipline' | 'class-mismatch';
  rules: ('no-assists' | 'time-attack')[];   // flavour the session applies
  lighting: 'day' | 'sunset' | 'night' | null; // ADVISORY: same vocabulary as rendering/daylight LightingMode
  ladder: { metric: 'position' | 'best-lap'; gold: number; silver: number; bronze: number };
  stakes: number;        // career pay multiplier
  event: EventDefinition; // circuit, vehicles, ruleset, weather, laps, opponents, compound, seed, aiSkill
}
```

* **List**: `wildcardSeries()`. Venue name `CIRCUITS[e.event.circuit].name`; machine names
  `VEHICLES[id].name` for `[e.event.vehicles].flat()` (a string means the whole grid); `e.event.weather` is
  `clear | rain | changeable`; grid size is `e.event.opponents + 1`.
* **Start**: exactly like the `event:` handler in `main.ts`, with `wildcardSession` in place of
  `eventSession`: `const options = wildcardSession(entry, { ...DEFAULT_OPTIONS, setup: settings.setup });
  void this.start(options)`. It throws with the engine's own message if the pairing is not allowed.
  `wildcardSession` applies the flavour rules (`no-assists` -> `assist: 'raw'`; `time-attack` events are
  already `time-trial` sessions).
* **Machines are loaned**: the entry names the player's machine (slot 0) and the field. No ownership needed.
* **Results / pay**: `settleRace(save, wildcardCareerEvent(entry), outcome)` (career/economy.ts) pays,
  books reputation to the machine's discipline and records `save.results['wildcard.<id>']`
  (`bestPosition`, `bestLap`, `starts`). No save schema change.
* **Medals**: result screen `wildcardMedal(entry, { position, classified, bestLap })`; list/badge
  `wildcardMedalFromRecord(entry, save.results[wildcardKey(entry)])`. Same `Medal` type as licences
  (`bronze | silver | gold`). Position ladders: gold 1st, silver top 3, bronze every place but last.
  Best-lap ladders (time attack): gold 1% under the AI benchmark, silver within 3%, bronze within 10%.

## The roster: 19 events, 12 genuinely cross-discipline

`kind` is computed, not asserted: `tests/wildcard-series.test.ts` derives the mismatch from the engine's own
data (terrain venue that does not admit the class, road motorcycle on a circuit not assessed bike-safe, dirt
motorcycle or off-road car on a paved circuit) and requires the label to agree for every entry. 12 are
`cross-discipline`, 7 are `class-mismatch` (a circuit machine on the wrong circuit). 17 machines, 13 venues,
weather: 13 clear, 4 rain, 2 changeable (the engine only has those three presets). One time attack, one raw
(no assists) event; the flavour rules are the only two the engine already supports.

| # | Event (id) | Kind | Machine | Venue | Weather | Laps x cars | Rules | Ladder (gold / silver / bronze) | Pitch |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | **THE DESCENT IN THE CLOUD** (`descent-in-the-cloud`) | class-mismatch | APX-01 FORMULA (`apx01`) | COL D’ARGENT / DESCENT (`alpine-pass-reverse`) | rain | 2 x 6 | - | P1 / P3 / P5 | A formula car runs a mountain pass downhill in a storm: stacked switchbacks, rock on one side and a long drop on the other. |
| 2 | **FORMULA ON THE WALL** (`formula-on-the-wall`) | class-mismatch | FX-26 FORMULA (`fx26`) | MESA SPEEDBOWL / OVAL (`speedbowl`) | clear | 3 x 6 | - | P1 / P3 / P5 | Downforce cars on a 31-degree banked oval: three laps near 300 km/h with a safety wall at the mirrors. |
| 3 | **HYPERCARS IN THE HARBOUR TUNNEL** (`hypercars-in-the-harbour`) | class-mismatch | HY-9 HYPERCAR (`hy9`) | RIVIERA / HARBOUR STREETS (`riviera`) | clear | 2 x 6 | - | P1 / P3 / P5 | Prototype hypercars squeeze through a curving tunnel and between 2.6 m walls on a harbour street circuit. |
| 4 | **KARTS AFTER DARK** (`karts-after-dark`) | class-mismatch | SK-125 SHIFTER KART (`sk125`) | NEON CITY / NIGHT STREETS (`neon-city`) | rain · night | 3 x 6 | - | P1 / P3 / P5 | Shifter karts take a floodlit city circuit in the rain: two tunnels that stay dry, a riverside blast and a plaza corner. |
| 5 | **KNOBBLIES ON THE BANKING** (`knobblies-on-the-banking`) | cross-discipline | MX-450 MOTOCROSS (`mx450`) | MESA SPEEDBOWL / OVAL (`speedbowl`) | clear | 3 x 6 | - | P1 / P3 / P5 | Motocross bikes on a 31-degree banked tri-oval: knobbly tyres, safety walls and 110 km/h of pure nerve. |
| 6 | **PROTOTYPES AND THE FLYOVER** (`prototypes-and-the-flyover`) | cross-discipline | GP-R1 PROTOTYPE (`gpr1`), GP-R2 PROTOTYPE (`gpr2`) | IRON QUAY / DOCKLANDS (`dockyard`) | clear | 3 x 6 | - | P1 / P3 / P5 | Prototype grand-prix bikes thread a docklands street circuit: concrete walls, a 9.9 m flyover and no bike-safe run-off. |
| 7 | **RED CANYON SCRAMBLE** (`red-canyon-scramble`) | cross-discipline | MX-250 TWO-STROKE (`mx250`) | RED MESA / CANYON CIRCUIT (`desert-canyon`) | changeable | 2 x 6 | - | P1 / P3 / P5 | Two-stroke motocross bikes on a tarmac circuit through a slot canyon, with rain due mid-race: 100 km/h dry, 70 wet. |
| 8 | **SUPERMOTO AFTER DARK** (`supermoto-after-dark`) | cross-discipline | SM-450 SUPERMOTO (`sm450`) | GANTRY POINT / NIGHT TERMINAL (`gantry-point`) | changeable · night | 3 x 6 | - | P1 / P3 / P5 | Supermotos under the cranes of a floodlit container terminal, with rain due: a figure-eight with a flyover, built for cars. |
| 9 | **SUPERMOTO MEETS THE JOKER** (`supermoto-meets-the-joker`) | cross-discipline | SM-450 SUPERMOTO (`sm450`) | KESTREL / RALLYCROSS (`kestrel-rx`) | clear | 4 x 6 | - | P1 / P3 / P5 | Supermotos on a rallycross circuit: tarmac, rolled gravel and a crest jump; the joker road is for cars, not for them. |
| 10 | **THE FOREST STAGE ON SLICKS** (`forest-stage-on-slicks`) | cross-discipline | SM-450 SUPERMOTO (`sm450`) | PINEWOOD / GRAVEL STAGE (`pinewood-stage`) | rain | 2 x 5 | - | P1 / P3 / P4 | A full lap of a gravel rally stage in the rain on supermoto tyres: crests over the ridge, a hairpin and a watersplash. |
| 11 | **THE LONG WAY ROUND** (`the-long-way-round`) | cross-discipline | MX-450 MOTOCROSS (`mx450`) | HOCHWALD / FOREST RING (`hochwald`) | clear · sunset | 1 x 4 | - | P1 / P3 / P4 | One lap of a 20.8 km forest ring on a motocross bike: twelve minutes, 33 corners, blind crests and a banked hairpin. |
| 12 | **GRAND TOURERS ON GRAVEL** (`grand-tourers-on-gravel`) | cross-discipline | GT-8F FRONT-ENGINE GT (`gt8f`) | KESTREL / RALLYCROSS (`kestrel-rx`) | rain | 3 x 6 | - | P1 / P3 / P5 | Front-engine GT cars on a wet rallycross circuit: tarmac, mud, a crest and a hairpin they were never tuned for. |
| 13 | **RALLYCROSS ON THE GRAND PRIX GRID** (`rallycross-on-the-grid`) | cross-discipline | RCX-6 RALLYCROSS (`rcx6`) | PARCO REALE / AUTODROMO (`parco-reale`) | clear | 2 x 6 | - | P1 / P3 / P5 | Rallycross cars on a full grand-prix circuit: built to slide, they now face two long tarmac straights. |
| 14 | **TROPHY TRUCKS ON NEON STREETS** (`trophy-trucks-on-neon-streets`) | cross-discipline | DX-8 TROPHY TRUCK (`dx8`) | NEON CITY / NIGHT STREETS (`neon-city`) | clear · night | 2 x 5 | - | P1 / P3 / P4 | Desert trucks on a floodlit city circuit: long-travel suspension, concrete walls and two tunnels. |
| 15 | **ROOF DECK HATCHBACKS** (`roof-deck-hatchbacks`) | class-mismatch | HH-2 HOT-HATCH RACER (`hh2`) | LEVEL NINE / MULTI-STOREY (`level-nine`) | clear | 4 x 6 | - | P1 / P3 / P5 | Hot-hatch racers in a multi-storey car park: roofed ramps, pillar slaloms and two tight hairpins. It never rains inside. |
| 16 | **SUPERMOTO ON THE ROOF DECK** (`supermoto-on-the-roof`) | cross-discipline | SM-450 SUPERMOTO (`sm450`) | LEVEL NINE / MULTI-STOREY (`level-nine`) | clear | 4 x 6 | - | P1 / P3 / P5 | Supermotos take a car park flat out: 4% ramps, pillar slaloms and a 1.4 km lap done in under a minute. |
| 17 | **GRAND PRIX BIKES ON THE RUNWAY** (`grand-prix-bikes-on-the-runway`) | cross-discipline | GP-R1 PROTOTYPE (`gpr1`), GP-R2 PROTOTYPE (`gpr2`) | BRIGHT BASIN / SALT FLAT AIRBASE (`salt-flat`) | clear | 2 x 6 | - | P1 / P3 / P5 | Prototype grand-prix bikes on a salt-flat airbase: a two-kilometre runway, sweepers across the salt and a 230 km/h lap average. |
| 18 | **HYPERCAR ROOF DECK ATTACK** (`hypercar-roof-deck-attack`) | class-mismatch | HY-11 HYPERCAR (`hy11`) | LEVEL NINE / MULTI-STOREY (`level-nine`) | clear | 3 x 1 | time-attack, no-assists | 40.96 s / 42.61 s / 45.51 s | A solo hot lap of a multi-storey car park in a hypercar with no ABS and no traction control, and walls 1.4 m off the asphalt. |
| 19 | **ROAD MACHINES ON THE FOREST RING** (`road-machines-on-the-forest-ring`) | class-mismatch | RR-4 RALLY-BRED ROAD CAR (`rr4`), RM-8 MUSCLE COUPE (`rm8`), SC-7 SUPERCAR (`sc7`), RD-2 ROADSTER (`rd2`) | HOCHWALD / FOREST RING (`hochwald`) | clear · sunset | 1 x 4 | - | P1 / P3 / P4 | A rally-bred road car, a muscle coupe, a supercar and a roadster take one lap of a 20.8 km forest ring as the light goes. |

Ladders: position ladders are win / podium / every place but the last (P1 / P3 / P(cars-1)); the single best-lap
ladder is built from the AI's best lap in the evidence run (41.37 s): gold 40.96 s, silver 42.61 s, bronze 45.51 s.
`lighting` is advisory for the front end (nothing in the simulation reads it).

## Evidence: seeded AI races (`npm run test:wildcard`)

Each event was run exactly as the player loads it (`wildcardSession` over `DEFAULT_OPTIONS`) with the AI
driving every car including the player's slot, at 120 Hz, by `scripts/wildcard-races.ts`. Criteria per event:
no exception, no non-finite rigid state, the race finishes inside its time limit, every entrant classified and
none retired, nobody below 1 m/s for more than 8 s (cars) / 20 s (riders), no marshal recovery, nobody more than
12 m beyond the road edge or off it for more than 20 % of racing time, best-lap average speed between 6 % and
105 % of the machine's own envelope, slowest best lap within 1.6x of the fastest, at least half the field with a
valid lap (every lap valid in the time attack), riders at most 0.5 falls per rider-lap and no rider falling more
than half the laps. A single seed per event. Machine: a shared 4-CPU box at load 14-21, so wall times are
inflated 3-5x and only comparable to each other.

| Event | Venue | Machine | Weather | Laps × cars | Best lap | km/h | Worst stop (s) | Max stray (m) | Falls | Max impact | Wall (s) | Result |
|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| `descent-in-the-cloud` | alpine-pass-reverse | apx01 | rain | 2 × 6 | 3:15.5 | 134 | 0.0 | 0.0 | - | 0 | 138.3 | PASS |
| `formula-on-the-wall` | speedbowl | fx26 | clear | 3 × 6 | 0:48.7 | 296.3 | 0.0 | 0.0 | - | 0 | 63.6 | PASS |
| `hypercars-in-the-harbour` | riviera | hy9 | clear | 2 × 6 | 1:42.1 | 117.6 | 0.0 | 0.0 | - | 0 | 78.3 | PASS |
| `karts-after-dark` | neon-city | sk125 | rain | 3 × 6 | 2:54.7 | 100.4 | 0.0 | 0.0 | - | 0.043 | 121 | PASS |
| `knobblies-on-the-banking` | speedbowl | mx450 | clear | 3 × 6 | 2:04.8 | 115.5 | 0.0 | 0.0 | 0 | 0 | 31.5 | PASS |
| `prototypes-and-the-flyover` | dockyard | gpr1/gpr2 | clear | 3 × 6 | 1:39.0 | 167.2 | 9.9 | 4.0 | 3 | 1 | 35.1 | PASS |
| `red-canyon-scramble` | desert-canyon | mx250 | changeable | 2 × 6 | 4:06.5 | 81.8 | 0.0 | 0.1 | 0 | 0 | 48.8 | PASS |
| `supermoto-after-dark` | gantry-point | sm450 | changeable | 3 × 6 | 3:09.9 | 102 | 0.0 | 0.1 | 0 | 0.003 | 43 | PASS |
| `supermoto-meets-the-joker` | kestrel-rx | sm450 | clear | 4 × 6 | 0:56.5 | 60.4 | 0.0 | 5.5 | 0 | 0.097 | 57.6 | PASS |
| `forest-stage-on-slicks` | pinewood-stage | sm450 | rain | 2 × 5 | 2:58.1 | 57 | 0.0 | 0.5 | 0 | 0 | 23.6 | PASS |
| `the-long-way-round` | hochwald | mx450 | clear | 1 × 4 | 11:53.1 | 105.2 | 0.0 | 1.2 | 0 | 0.006 | 35 | PASS |
| `grand-tourers-on-gravel` | kestrel-rx | gt8f | rain | 3 × 6 | 1:13.6 | 46.4 | 5.5 | 1.5 | - | 0.364 | 147.5 | PASS |
| `rallycross-on-the-grid` | parco-reale | rcx6 | clear | 2 × 6 | 2:22.8 | 146.1 | 0.0 | 0.0 | - | 0 | 77 | PASS |
| `trophy-trucks-on-neon-streets` | neon-city | dx8 | clear | 2 × 5 | 2:46.4 | 105.5 | 0.0 | 0.0 | - | 0 | 69.3 | PASS |
| `roof-deck-hatchbacks` | level-nine | hh2 | clear | 4 × 6 | 0:52.3 | 98 | 0.0 | 0.0 | - | 0.009 | 163.4 | PASS |
| `supermoto-on-the-roof` | level-nine | sm450 | clear | 4 × 6 | 0:54.2 | 94.6 | 0.0 | 0.0 | 0 | 0 | 42.8 | PASS |
| `grand-prix-bikes-on-the-runway` | salt-flat | gpr1/gpr2 | clear | 2 × 6 | 1:44.9 | 233.4 | 0.0 | 0.8 | 0 | 0 | 19.7 | PASS |
| `hypercar-roof-deck-attack` | level-nine | hy11 | clear / raw | 3 × 1 | 0:41.4 | 123.9 | 0.0 | 0.0 | - | 0 | 16 | PASS |
| `road-machines-on-the-forest-ring` | hochwald | rr4/rm8/sc7/rd2 | clear | 1 × 4 | 9:24.1 | 133 | 0.0 | 1.9 | - | 0.084 | 122.4 | PASS |

Reading the table: "Worst stop" is the longest a machine stood below 1 m/s while racing; "Max stray" is the
furthest a machine's centre got beyond its road edge; "Falls" sums rider falls (bikes only). Honest notes:

* `prototypes-and-the-flyover` is the roughest passing event: 3 falls in 18 rider-laps and one rider standing
  9.9 s; it passes the bounds but a human will see a fall or two. Its 2-lap probe had 1 fall.
* `grand-tourers-on-gravel` in the rain averages 46 km/h and had one 5.5 s stop and a 0.36 contact peak.
* `supermoto-meets-the-joker`: bikes ignore the joker road (there is no joker rule in the series rulesets),
  and one rider ran 5.5 m beyond the road edge on the gravel.
* Lap times are AI pace, not records. Single seed: not a statistical claim about every seed.

Stability evidence for the engine changes (not part of the series): the six existing suites that touch circuits,
events, DRS and the catalogue (`circuit-catalogue`, `events`, `catalogue-menu-events`, `drs`,
`career-catalogue-growth`, `vehicle-catalogue-growth`) and fourteen more (`venue-kit-wave2`, `circuit-catalogue-wave2`,
`circuit-catalogue-wave2-review`, `career`, `career-session`, `career-hub`, `team-career`, `offroad`,
`bike-session`, `motocross-venue-integration`, `event-cards`, `venue-kit`, `frontend-menus`, `offroad-meeting`)
were run: all pass except one test that fails identically on the untouched baseline (see Status).

## How an event works today (what I learned first)

* An event is `EventDefinition` (`simulation/events.ts`): circuit, mode, ruleset, laps, opponents, weather,
  vehicles (one id per entrant or one id for the field), compound, seed. `eventSession()` resolves it to
  `SessionOptions` and refuses it with every message from `sessionIncompatibilities()`; `validate:content`
  resolves every built-in event the same way. `Simulation` (`world.ts`) builds it; the headless harnesses
  (`catalogue-races.ts`, `bike-race.ts`, `offroad-races.ts`, `integrated-driving.ts`) drive it at 120 Hz.
* A **ruleset** admits vehicle classes. Ordinary rulesets keep a discipline at home: the motorcycle rulesets
  race only on `bikeSafe` circuits and cleared classes; terrain venues (motocross, supercross, rallycross,
  stage) admit only their own machines (`venueAdmits`); cars and motorcycles never share a grid. Practice,
  qualifying and time trial admit every class anywhere on paved circuits.
* The career lists events by `rulesetsFor(registry, class)` (fewest admitted classes first), takes
  `registry.events` for authored invitationals, and settles a race with `settleRace(save, event, outcome)`.

## What I added

| Piece | File | Notes |
|---|---|---|
| Wildcard rulesets | `src/simulation/wildcard-rulesets.ts` (merged into `RULESETS`) | `wildcard-machines` (cars, any class), `wildcard-riders` (road, dirt, supermoto bikes, no bike-safe gate), `wildcard-time-attack` (solo timed). `crossVenue` allow-list of evidenced terrain pairings. |
| `crossVenue` rule | `src/simulation/events.ts` | A ruleset can admit named classes at a terrain venue of a given course kind. Absent everywhere else, so every ordinary ruleset behaves exactly as before. |
| `aiSkill` option | `config.ts`, `world.ts`, `events.ts` | Optional `SessionOptions.aiSkill` / `EventDefinition.aiSkill` (0.8-1, default `AI_BASE_SKILL` 0.92, unchanged for every session that does not name one). The brief asked for per-event AI skill; there was none. |
| Series data + accessor | `src/career/wildcard-series.ts` | `WildcardEntry`, `wildcardSeries()`, `wildcardSession()`, medals, `settleRace` adapter. Light: no validation imports. |
| Series validation | `src/career/wildcard-validation.ts`, `scripts/validate-content.ts` | ids/seeds/titles unique, machines/venues/rulesets exist, pairing resolves, copy (title <= 48, pitch <= 140, one line, uppercase title, no protected circuit/series/brand names), ordered ladder. Runs inside `npm run validate:content`. |
| Race harness | `scripts/wildcard-races.ts`, `npm run test:wildcard` | Loads each event as the player does, drives it with the AI, writes `docs/wildcard-races.json` (merges, hashes each event so stale evidence is caught). |
| New venue | `src/simulation/circuit-catalogue/wildcard-venues.ts` | Level Nine, a fully roofed multi-storey car park (see below). |
| Banked/sloped grid fix | `src/simulation/vehicle.ts`, `src/core/math.ts` | Root-cause fix found by the speedbowl events (see "Engine finding"). |
| Tests | `tests/wildcard-series.test.ts` | See "Verification". |

### Why the events are not in `EVENTS`

`EVENTS` feeds the EVENTS hub, the career's authored invitationals and several suites that assert, for example,
that every built-in motorcycle event is on a bike-safe circuit with a bike-clearance record
(`circuit-catalogue-wave2*.test.ts`, `bike-race.ts`). A GP bike on a docklands street is exactly what those
assertions forbid. The series therefore has its own list and its own evidence, and reuses the same
`EventDefinition` / `eventSession` / `settleRace` / `Medal` machinery. The wildcard rulesets are in `RULESETS`
(the simulation needs them there) but the career's class lookup ranks them last and the tests assert that
`rulesetsFor` still returns each ordinary ruleset first for every class they touch.

## What does not work (probed, not shipped)

Exploratory runs with the same production simulation (`autoPlayer`, seed 1234 unless noted; 4-6 entrants, 2-3
laps). These are the reasons for the `crossVenue` allow-list and for the roster. They are probe results, not
saved evidence files.

| Pairing | What happened | Decision |
|---|---|---|
| GT-8F, Valley Ridge motocross, 4 cars, 2 laps | 30 km/h lap average, one car had 1 of 2 laps after 294 s, 5 s standstills, 32 incidents, contact at the limit | refused (not in `crossVenue`) |
| GT-8F, Valley Ridge motocross, solo time attack in rain | 0 laps in 306 s | refused |
| DX-8 trophy truck, Arena Nord supercross, 4 cars | 25 km/h, a marshal recovery, 63 incidents, 10-20 s penalties | refused |
| DX-8, Arena Nord, solo time attack | 3 laps (best 73.0 s, 30 km/h) but contact at the limit and 14 incidents | refused |
| GT-10M, Pinewood forest stage as a lap race, 4 cars | cars parked 12-21 s, one safety car, 5 incidents | refused (supermoto is fine there) |
| GP-R1 prototype, Riviera harbour streets | every rider fell 4 times in 2 laps, no valid lap | left out |
| GP-R2, Lantern Bay | 3 of 5 retired, one rider stuck for 467 s, safety car | left out |
| SBK-1000, Cap Lumiere cliff road | 5 of 6 riders fell once; AI skill 0.86 did not change it | left out |
| SS-600 up the Col d'Argent hairpins | 2-4 falls per rider; AI skill 0.86 did not change it | left out |
| GP-R1, Neon City | 1-2 falls, 2 riders without a valid lap | left out |
| GP-R1, Mesa Speedbowl | 249 km/h but one fall with an 11.3 m run onto the verge | left out (marginal) |

Pattern: **motorcycles are the robust crossover.** Dirt and supermoto bikes finished every paved circuit I
tried with zero falls (Speedbowl, Speedbowl infield, Bright Basin, Red Mesa Canyon, Neon City, Gantry Point,
Level Nine, the 20.8 km Hochwald ring). Road bikes are fine on wide, flowing, fast venues (docklands,
container terminal, salt flat) and fall on tight street hairpins and the corniche, which is the same AI
braking-lag limit `docs/CIRCUIT_CATALOGUE.md` already records for the classic class. Cars are robust on any
paved circuit and on the two car-built terrain venues (rallycross, forest stage), but not on the bike-built
motocross/supercross courses (7-20 m radius berm corners on a 8-10 m wide course, 2 m tabletops): a cause I inferred from the lap speeds and incident counts, not one I isolated.

## New venue: Level Nine (multi-storey car park)

`src/simulation/circuit-catalogue/wildcard-venues.ts`, id `level-nine`, registered after wave 2 in
`CATALOGUE_CIRCUIT_IDS`. No renderer code: every metre of the lap is a `tunnel` span, which the venue kit already
builds as concrete walls, a slab roof, strip lights and (for the `neon-city` theme) a plaza block overhead,
and which `Track` already shelters from rain. 1424 m, 8 corners (two 20 m hairpins, six pillar slalom bends), an
8 m ramp up and down (4% maximum grade, 2.3 km crest radius), concrete walls 1.4 m off the asphalt, compact paddock.

* Geometry: `validateCircuitDefinition` and `trackGeometryReport` clean; closure adjustment 10.6 m of 1424 m;
  covered by `tests/circuit-catalogue.test.ts` (definition, geometry, racing line, pit side, doc evidence) and
  `tests/venue-kit-wave2.test.ts` (terrain/plaza plan from data) which both iterate the new id: pass.
* Seeded Formula race through `scripts/catalogue-races.ts level-nine --merge` (6 cars, 2 laps): PASS, best lap
  36.44 s (140.6 km/h), contact 0.011, no one stuck. Merged into `docs/circuit-catalogue-races.json`; I added a
  `--merge` option to that script so one layout does not need the 40-layout, ~hour-long full rerun, and it
  keeps the other layouts' recorded source hashes untouched.
* The first authoring (130 m ramps, 16 m hairpins, 14 m elevation smoothing) is a good example of why the
  generic race harness exists: formula cars left the crest (98 car-seconds airborne) and jammed in the hairpins.
  Gentler ramps and larger smoothing fixed it; that is why the lap is a car park a formula car can survive.
* Not bike-safe (walls 1.4 m away, a roof). Motorcycles run it only in the series.
* Not verified: how it looks. No browser capture was taken (software GL, shared machine); the kit tests build it
  from data in Node only.
* Second new circuit: not built. The shared machine was at load 14-21 for most of the session and one new
  layout already costs about 15 CPU-minutes of validation.

## Engine finding fixed: banked and sloping grids read as a jump start

Found because the Speedbowl events showed `+5 s` on every car at the lights. Cause: `Vehicle.place()` only
yawed the chassis, so on the Speedbowl grid (7-13 degrees of banking) the car was dropped flat onto a tilted road,
bounced to 0.7-1.0 m/s in two steps and tripped the jump-start check (speed > 0.8 m/s before green). All four cars
got `5J` at t = 0.02 s. Fix: when the road slope (banking or gradient) exceeds `PLACE_ALIGN_SLOPE` = 0.03,
`place()` builds the chassis orientation from the road's own frame (`Quat.fromBasis`); below it the placement is
the old yaw-only one, so every flat grid is bit-for-bit unchanged (Aurel never exceeds 0.018; the test asserts it).
Grids that were above the threshold: Speedbowl and its infield layout (0.17), Col d'Argent ascent (0.072),
Cap Lumiere (0.055). After the fix the Speedbowl grid has no penalty and no settle (speed 0.02 m/s at t = 0.01 s)
and race pace is unchanged (formula best lap 48.66 s before and after). Bikes are unaffected (their body is
rewritten from the bike dynamics each step). Caveat: Vellamar's grid is under the threshold, but 146 of its 400
stations (10 m apart) are above it, so a marshal recovery or test placement mid-lap on Vellamar now tilts the
chassis onto the road; I did not find a test that depends on the old flat placement there.

## AI skill

`SessionOptions.aiSkill` was added because the brief lists AI skill per event and the engine hard-coded
`0.92 + (id % 4) * 0.014` in `world.ts`. Absent, behaviour is identical (a test asserts the four skills of a
default field). Every series event states 0.92 explicitly. Finding: a lower skill (0.86) did not stop the road
bikes falling at tight corners (SBK-1000 on the corniche, SS-600 on the hairpins, GP-R1 in Neon City), so the
dial is not a fix for the road-bike AI braking limit; it is available for tuning.

## Verification (commands run in this worktree, results as observed)

| Command | Result |
|---|---|
| `node --experimental-transform-types scripts/validate-content.ts` | `Content valid` (includes the series: ids, seeds, copy, ladders, pairings) |
| `npx tsc --noEmit` | exit 0, no output |
| `npx eslint` on every file I added or changed under `src`, `scripts`, `tests` | no output (clean) |
| `npx prettier --check` on my new/changed files | clean (the repo has 146 other files already unformatted; untouched) |
| `npx vitest run tests/wildcard-series.test.ts` | 38 passed (data, rulesets still strict, evidence current and passing, medals, `settleRace` adapter, AI skill, banked grid, every event steps 2 s finite) |
| `scripts/wildcard-races.ts <19 events>` (in three runs; changed events re-run after edits) | 19 PASS, `docs/wildcard-races.json` |
| `scripts/catalogue-races.ts level-nine --merge` | PASS, report merged into `docs/circuit-catalogue-races.json` |
| `scripts/catalogue-races.ts speedbowl,speedbowl-infield,alpine-pass,coastal-cliff` (no write) | 4 PASS after the grid-placement fix (best laps 48.49 / 79.67 / 151.86 / 89.05 s against 48.53 / 80.04 / 153.67 / 89.82 s recorded) |
| `npx vitest run` on 20 existing files (`circuit-catalogue`, `circuit-catalogue-wave2`, `-wave2-review`, `events`, `catalogue-menu-events`, `drs`, `career`, `career-session`, `career-hub`, `career-catalogue-growth`, `team-career`, `vehicle-catalogue-growth`, `offroad`, `offroad-meeting`, `bike-session`, `motocross-venue-integration`, `event-cards`, `venue-kit`, `venue-kit-wave2`, `frontend-menus`) | all pass except `tests/bike-session.test.ts` "finishes a mixed GP/superbike race" |

Not run: `npm run build`, `npm run lint` over the whole tree, the full vitest suite (forbidden by the brief),
Playwright/e2e, any browser capture, `npm run test:bikes`, `test:offroad`, `test:endurance-events`,
`test:catalogue-races` over all 41 layouts, `test:bike-clearance`. The existing evidence documents
(`bike-race.json`, `offroad-races.json`, `bike-clearance.json`, `endurance-event-races.json`) are untouched.

## Status: what is broken, unverified or open

* **Pre-existing failure, not mine:** `tests/bike-session.test.ts > finishes a mixed GP/superbike race with
  bounded incidents and no stuck rider` fails on untouched `HEAD` (`ebf691d`) with the same numbers
  (GP best lap 83.281 s is not faster than the superbike's 83.123 s). I reproduced it in a clean `git archive`
  of `HEAD` with only `node_modules` linked. Left alone.
* **No UI.** The UX Director gets the accessor and contract above. I did not mount a list anywhere: the EVENTS
  hub is built from `EVENTS` (`event-cards.ts`), which the series deliberately stays out of.
* **Road bikes are only reliable on wide, fast venues** (docklands, terminal, salt flat). Tight street
  circuits and the corniche make the bike AI fall (existing AI braking limit, not touched). The `prototypes-and-the-flyover`
  event is the marginal one.
* **Single seed per event.** A different seed or a human driver will not match these numbers.
* **Visuals not checked.** Level Nine, the speedbowl banking start, and every pairing were validated headless;
  nobody has looked at a frame. The tunnel plaza block over Level Nine, the camera inside a roofed lap, a car on a
  supercross-style berm, rain on a car park (it should stay dry) are all unseen.
* **`lighting` is a hint** (nothing sets the sky). "Dusk" on the forest ring only exists if the front end maps
  `sunset` to the lighting control. Time of day is not part of the simulation.
* **Medals persist only through the career save's existing `results[key]`** (best position and best lap), so the
  list can show a medal but a clean-race or contact condition cannot be stored; the series has none.
* **Time attack is a solo AI-benchmarked lap.** The ladder uses the AI hot lap as a reference; with a human the
  lap would also set the usual ghost, which the harness does not exercise (the AI drives, so laps are flagged assisted).
* Branch: the worktree branch is `worktree-agent-ab1c5bb86a15196ba`, not a `studio/...` name; the PM merges.

## Recommended next tasks (ranked)

1. UX Director: add a WILDCARD board that reads `wildcardSeries()`; show `title`, `pitch`, a kind badge, the
   venue/machine/weather line and the medal from `wildcardMedalFromRecord`. Start through `wildcardSession`,
   settle through `settleRace(save, wildcardCareerEvent(entry), outcome)`. (Needs the player's slot-0 machine
   to be the entry's first vehicle, as `eventSession` already does.)
2. Environment Art: map `lighting` (`night`, `sunset`) to the lighting control on start; confirm rain is
   suppressed inside Level Nine and under the Neon City tunnels in the Karts event.
3. QA: look at `knobblies-on-the-banking`, `the-long-way-round`, `grand-tourers-on-gravel` and `roof-deck-hatchbacks`
   in a browser (real frames, camera in the roofed lap, bike on 31 degrees, mud on a GT).
4. Fix the road-bike AI braking limit on tight corners (reaches hairpins above its target speed). It would open
   Riviera, Lantern Bay, the corniche and the Col d'Argent hairpins to bikes: four more strong pairings, and
   the `aiSkill` dial does not touch it.
5. Make a car drivable on a motocross course (a car line that avoids berm faces, or a wider "car lane" on the
   course data) to unlock the original brief example "GT car on a motocross rhythm section in the rain".
6. A second unexpected venue (the brief allowed two): Level Nine took about 15 CPU-minutes of validation, the
   machine was overloaded, so I stopped at one. Candidates the DSL supports without renderer code: a dam-crest
   causeway (`drop` spans on both sides), a salt-flat oval, a pit-lane-only service-road circuit.
7. Add `docs/wildcard-races.json` to the release gate G6 check ("at least 12 wildcard events, at least 6
   weather states"): the series meets 12+ events (19) and uses all three weather presets the engine has; the
   weather count needs Environment Art's new states to reach 6.
