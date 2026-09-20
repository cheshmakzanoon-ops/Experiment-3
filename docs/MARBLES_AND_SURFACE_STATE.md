# Connected tire contamination, track state and worker portability

This continuation implements concrete gaps in the unchanged 148-section master
directive, especially 22, 37–39, 57, 67, 80–82, 99, 103–117 and 133–146. The exact
original remains `MASTER_DIRECTIVE.md`, protected by a byte-hash and heading test.
It is not a declaration of complete commercial-game fidelity.

## Physical ownership and units

`contamination.ts` integrates bounded tread coverage under the rates held during
one physics substep. Road pickup is proportional to local loose-rubber coverage
and longitudinal speed; rolling sheds contamination. The exact first-order
coverage update uses `expm1`, avoiding a linear update's subdivision dependence.
It accounts separately for incoming and shed coverage when both occur. Pickup is
bounded by available cell coverage. Grass/gravel contamination does not become
fictional road-marble pickup, and airborne or stationary contact cannot accumulate
it. The numerical constants are an original reduced model, not measured tire data.

`dirt` remains a dimensionless covered fraction. `marblePickup` counts cumulative
**tread-cover equivalents** since that tire was fitted. One full cell contains
100 such equivalents in this model; both collection and cell debit use that same
conversion. These are not kilograms, and the implementation does not claim a
mass-calibrated granular-material simulation. Detached render chips are an effect,
not a second physical material inventory.

The actual `Vehicle` wheel solve measures each tire's counter change and debits
the actual loaded road cell. Positive slip work still generates edge marbles.
Loaded moving road contacts lay rubber. Stopped tires no longer manufacture
rubber merely because they carry weight, and off-road/pit contacts cannot modify
or sample the adjacent asphalt cell's rubber/marbles through index clamping.
Contamination continues to reduce tire grip after returning to clean asphalt;
rotation progressively removes it. The existing physical tire replacement path
creates clean tires and resets the fitted-tire pickup counter.

## Presentation and recording

The existing 512 × 7 GPU surface texture now uses its blue channel for local
marble coverage, alongside water/red and rubber/green. No additional texture or
per-frame texture allocation is introduced. Derivative-filtered road flecks tend
toward mean coverage at distance rather than shimmer. Each high-detail wheel has
its own dirt/wear/blister/grain uniform, supplied by the same live or replayed wheel
state. Its grain pattern is fixed to spinning tread UVs, with mean coverage retained
when individual grains become sub-pixel. Distant LODs omit fine tread detail.

Marble chips share the existing 1,800-particle pool. A cumulative pickup delta,
not a pedal, render count or session timer, supplies the birth budget. The visual
sampling density is 320 chips per coverage equivalent; each wheel can emit at
most 64 chips per update, dropping overload rather than accumulating an unbounded
backlog. Repeated snapshots, first observation, rewind, tire replacement and
disabled/re-enabled effects do not create catch-up bursts. Clearing the pool uploads
zero opacity immediately, including a paused frame with no subsequent update.

Protocol **7** retains the 224-float car stride and all wheel/debris offsets. Spare
car slots 90–93 carry FR/FL/RR/RL pickup counters. The four CSV fields are appended
after the pre-existing 199 columns; a frozen header SHA-256 test protects the old
positions. The total is 203 actual-state channels at 60 Hz.

The worker sends local marble cells with water/rubber at the existing 2 Hz surface
cadence. Full-session replay stores three-channel 16-bit water/rubber/marble tuples
and restores the correct historical cells on backward seeks. New private cache
pages carry version 7; old/incompatible/corrupt records fail explicitly rather than
being reinterpreted. Current-page surface bytes are included in the memory counter.
The incremental raw transfer is 14,336 bytes per surface update and replay storage
is 7,168 additional bytes per surface record, before object/storage overhead.

## Production worker construction

Both physics and CSV export now use Vite's `?worker&inline` packaging, retaining
real dedicated workers. A script loaded from an external asset host no longer
passes that host's worker URL directly into the document's Worker constructor.
The self-contained worker is created from a document-origin blob URL. This does
not turn off the same-origin policy or run simulation on the UI thread.

Deployment must still serve the HTML, JavaScript and CSS with correct types and
asset CORS permissions. A restrictive Content Security Policy must permit the
intended script/style origins and `blob:` in `worker-src`. This source change alone
does not retroactively replace an older already-published application bundle.

Reference contracts: Vite's official Features / Web Workers documentation and
MDN's Worker constructor documentation. The locked Vite 7.1.7 build and the real
browser oracle are the compatibility gates, rather than an assumed latest API.

## Executable evidence

`tests/marbles.test.ts` adds 25 focused cases. They exercise physical pickup,
lasting grip, clean-line recovery, exact-rate subdivision, finite local material,
reverse symmetry, no airborne/stationary pickup, no pit/grass edge contamination,
actual tire replacement, four telemetry counters, fixed-budget particle emission
at 24/30/60/120/144 Hz, repeated/rewound/disabled snapshots, immediate GPU-opacity
clearing, historic page seeks, malformed surface rejection and all 199 prior CSV
column positions. The checkpoint has 314 total unit/property tests.

`e2e/00-marbles.spec.ts` runs actual Three.js road/tread/particle shaders on a real
WebGL context, reads changed pixels, checks per-wheel uniforms against unmodified
production-physics state, and tests a clear without a following frame update. It
attaches the measured JSON and actual rendered tire image. The declared initial
marble-filled track is a component fixture, not evidence of a naturally evolved
whole-race track.

`e2e/01-worker-portability.spec.ts` serves the compiled fixture under a different
origin from its document, runs the actual physics worker and production CSV
export class, checks finite advanced snapshots and marble transfers, verifies
exact CSV values, then requires both workers to terminate. Routing supplies HTTP
bytes only; worker responses are not mocked. All prior application/browser tests
remain required, including real IndexedDB and 60 Hz CSV spacing.

`npm run test:journey` adds a continuous six-car changing-weather race to the
physics gate. The fixed seed, setup and normal input requests exercise launch,
gears, wake, brake lock/release, kerb/grass, dirty-tire recovery, thermal wear, ERS,
real intermediate service, rejoin, deliberate glancing contact and classification.
Read-only evaluation of the same aero function isolates the physically measured
front-wing damage's downforce/balance consequence; it does not mutate the car or
claim that a human has perceived understeer. Numeric replay seeks and exact CSV
checks consume recorded snapshots from that same run. Its page-store adapter is
in-memory; the separate browser gate covers IndexedDB.

The retained `integrated-driving.json` records 14 named checks, chronology, source
and script fingerprints, 39,755 telemetry rows and 9,938 replay frames. In that
run the six cars finished with one tire stop each; the deliberately delayed and
excursion-driven player was classified one lap down (seven laps versus the
winner's eight), not relabeled as an eight-lap finisher. Front damage was about
3.58%, with a matching front-wing downforce loss under the shared read-only aero
comparison. A lapped finish and intentional impact are expected in this fixture.

Existing dry/changing/rain, wet-pit, marshal, rotational integration, vehicle
dynamics and whole-field classification gates remain. Dry 50-/100-lap reports
identify their exact source and simulation/core fingerprints; presentation-only
edits after a run do not justify relabeling its all-source hash. See
`CONSTRUCTION_AND_ENDURANCE.md` for the refreshed results.

## Remaining acceptance boundaries

Local lint, TypeScript, production build and native tests can run in this
workspace; local Chromium cannot create WebGL. Real GPU and complete browser
acceptance must be read from the GitHub workflow for the published source. The
source-update workflow refuses to commit/push a candidate if those gates fail.
A software-rendered CI run is not representative-device frame-rate certification.

The continuous native journey is a substantial connected part of section 146,
not its whole human-played audiovisual sequence. Camera/UI/audio integration,
perceived handling and presentation still need the complete combined acceptance.
Three complete project-wide quality passes, three final independent audits,
consumer-device performance targets and AAA visual/audio fidelity are not claimed
by the marble subsystem or its automated tests.
