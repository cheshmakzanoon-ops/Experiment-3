# 27H.6 — populated-race presentation candidate

Baseline: `12f38b1917a1ad398fc6ef3aa92c7c479a8f948d`, exact tree
`0f311ab1a414686c77d462ecaf37da046462f8d9`.
This is a presentation/validation increment, **not closure of 27H.6**.
Publication and exact-commit hosted CI must be verified separately. See
[the machine-readable validation record](PHASE_27H6_VALIDATION.json).

## Inspected evidence and visible corrections

The inspected baseline comes from successful GitHub run `36123363094`, browser
artifacts `10859801855` and `10859852830`, not an older development screenshot.
Its ordinary-app clear, sunset, wet-day and wet-night recordings were retained.
The review sampled their captures and compared original reference entries
002, 003, 004, 008, 010, 032, 085 and 097. The supplied archive SHA-256 is
`4a3934002ee98335764b37a01c6ceb2a781857c117757080b453010894a510be`.
This is a focused review, **not a new all-100 image inspection**. Reference
artwork stays outside the game and the delivery's shipped application.

The baseline pod/chase captures place the main telemetry over the lower-centre
car. At desktop widths of at least 1400px and heights of at least 800px, the
complete panel now occupies a two-column upper strip. Gear, speed, RPM, pedals,
ERS, fuel and optional guidance remain visible. Start lights have separate
clearance. Smaller/touch layouts and cockpit telemetry positions are retained.
Actual twelve-car standings are capped above the minimap; row spacing adapts to
the grid and scale, with native scrolling when needed. Navigation keydowns in
that focused panel do not also drive the car; keyup still reaches the existing
input listener so held input can be released. Escape remains available.

The start gantry and control-tower base/roof were absent from the existing
broadcast solid-occlusion set. Their actual unchanged meshes now contribute
five immutable oriented bounds before spatial batching. The open gantry aperture
and glazed observation room are not converted into fictitious walls. Existing
camera selection can reject a rig obstructed by those solids; no camera is
teleported and no geometry is hidden to manufacture a clear view. This is a
conservative geometry correction, not a pixel-visibility certificate.

No car, driver, crew or crowd asset is relabelled as final art. Their remaining
anatomy/material/animation and full-lap visual gaps still need rendered review.

## Strengthen the existing recorder, not a parallel review system

`PresentationReview` keeps its existing thirty-column version-1 observations,
source identity, traversal, pause/focus/discontinuity and bounded-frame rules.
New captures attach a versioned seventeen-column racing companion built from
the **same presented snapshot**. The renderer and recorder remain read-only
observers of simulation state.

* **Grid start:** observe populated lights and then three continuous seconds of
  actual racing motion with at least two active opponents.
* **Close racing:** five continuous seconds near the same moving rival. Heading,
  height, pit/retirement state and cyclic track progress exclude bridge traffic,
  adjacent unrelated road sections and stationary cars.
* **Wet following:** three continuous seconds behind the same eligible car,
  with real rainfall, loaded wet contacts for both cars and live spray entries
  attributed to that leader. A wet label or particles from a different car do
  not qualify. Emission does not certify camera-frustum or pixel visibility.
* **Pit service:** road, legal entry, stopped/jacked wheel removal, installation,
  release with the same stop counter increment, and moving road exit. The
  fifteen recorded crew actors must belong to the followed car, not another bay.

Timed scenes still need at least thirty seconds. A full-lap request additionally
retains the existing complete-traversal/lap-crossing requirement. Advancing
observations separated by more than one second break continuous-duration runs;
held snapshots and unrelated encounters cannot accumulate an event. The existing
ten-minute limit interrupts an unqualified run instead of awarding completion.
The viewer can export this failure evidence.

Import reconstructs qualification from raw rows rather than trusting an edited
summary. Historical captures remain readable, without inventing racing proof.
The budget comparison treats unqualified historical racing labels as unmeasured.
The original performance recorder/comparator is retained; neither synthetic
observations nor this session's software environment establish minimum-PC FPS.

## Executable checks and their limits

The complete local lint, 1,083 tests in 104 files, strict TypeScript and production
build pass. There are 42 added unit cases, including actual emitter ownership,
invalid rivals, pit sequencing, legacy reports and actual mesh/director geometry.
The original tests and CI thresholds are not removed or weakened. All eight
existing numerical validation scripts also pass; their current reports are
retained in the delivery evidence without rewriting historical reports.

`e2e/28-race-hud-layout.spec.ts` passes in Chromium across 36 combinations:
1440x800, 1440x900 and 1920x1080; pod/chase; 0.8/1/1.35 interface scale;
guidance on/off. It also checks twelve retained rows, scroll access and key
propagation. Its screenshot is explicitly **DOM-only, not gameplay**.

`e2e/29-populated-race-review.spec.ts` adds five ordinary-application cases:
twelve-car start, eight-car close racing, wet following by day and night, and
pit entry/service/exit. They use menus, the existing G demonstration control,
the real P pit request, continuous Playwright video and actual recorded replay.
No pose, physics, clock, snapshot or completion override is injected. These
functional CI workloads use the low graphics preset; wet cases explicitly
restore particle density to 1 through the normal settings control. The prior
higher-fidelity full-lap suite remains intact and separate.

The local ordinary-app attempt was **blocked at navigation** by
`ERR_BLOCKED_BY_ADMINISTRATOR`. The missing video executable was supplied from
installed system FFmpeg before that final attempt; no repository dependency was
changed. None of the five new gameplay cases is claimed to have passed here.
They must execute on the exact candidate in permitted WebGL-capable hosted CI.

`scripts/phase27h6-racing.ts` runs the unchanged real simulation at 120Hz and
samples actual rendering-component state at 30Hz. All four scenarios qualify:
grid 30.008s, close racing 35.342s, wet following 41.575s and completed pit exit
116.308s. These are **simulated event times**, not browser runtime or FPS. An
initial delayed-start experiment failed; the normal simultaneous launch is the
retained deterministic workload, with no reduced evidence thresholds.

## Costs, preservation and remaining acceptance

No new geometry, draw-owning mesh, light, shader or render pass is added. The
five static occluders add CPU ray/bounds work to existing camera selection.
Particle ownership uses 1,800 additional CPU bytes in the existing fixed pool.
The optional racing companion allocates at most 4,080,000 CPU bytes at the
existing 30,000-frame limit, plus bounded per-frame observation work. These are
storage bounds, not measured hardware performance. No GPU VRAM claim is made.

Physics, track/water rules, input modules, audio, storage/replay, workers,
authored/Blender assets, dependencies and GitHub workflows remain unchanged.
The exact 248-row matrix refreshes source/coverage links with **0 PASS / 230
PARTIAL / 2 FAIL required rows and 16 excluded references**. No human or
hardware receipt is fabricated.

Remaining gates: exact-source hosted browser CI; new gameplay footage and
reference inspection; representative physical Windows/GPU/controller captures;
measured frame-time regression comparison using the existing performance tool;
then visual corrections found in that review. Section 146 human end-to-end
acceptance, later game-feel/audit work and Steam readiness remain open.

```sh
npm ci --no-audit --no-fund
npm run check
node --experimental-transform-types scripts/phase27h-matrix.ts --check
node --experimental-transform-types scripts/phase27h6-racing.ts
npm run test:physics
node --experimental-transform-types scripts/rotation-benchmark.ts
node --experimental-transform-types scripts/pit-integration.ts
node --experimental-transform-types scripts/race-classification.ts
npm run test:e2e
```

The local full unit run used `--maxWorkers=2`. Physical performance comparisons
require matched machine/settings/workload reports; no download in this candidate
stands in for measurements on the user's computer.


## Retained complementary staged implementation

The following describes staged tree `90a5fbd3c5f90b7003033289cd45a8ee0353e4a9`,
now reconciled with the saved candidate. Its validation counts describe that
checkpoint only; see PHASE_27H6_RECONCILIATION.md for this integration.

# Phase 27H.6 — populated racing and presentation corrections

Baseline: `12f38b1917a1ad398fc6ef3aa92c7c479a8f948d`, source tree
`0f311ab1a414686c77d462ecaf37da046462f8d9`. Its complete normal CI run was
`36123363094`. This continuation implements targeted corrections and broader
ordinary-game evidence. It is **not final-art, all-reference, Section 146,
physical-hardware or Steam-release acceptance**.

## Review and the corrections it led to

The current-source `browser-validation-8-of-8` artifact from that run supplied
the baseline clear, sunset, wet-day and wet-night views. In particular, the wet
chase view `e34ee5d22ebedbac37c15e8f188469e1f18fdbab.png` motivated inspection
of the road's low-angle material response. Source review found that the shader
levelled every wet cell's aggregate normal by up to 90%, even without a puddle.
It also gave the thin water coat a geometric normal unrelated to the substrate.

The selected source references were individually reopened: R003 (cockpit and
grip), R004 (car/crew service composition), R010 (wet car/road separation), and
R039 (populated night broadcast). This is a targeted re-review, not a new claim
that all 100 images were inspected or matched. No reference artwork, logos,
vehicles or people were copied into the game.

### Damp asphalt retains aggregate; standing water still levels it

`installWetRoad` now distinguishes a conforming damp film from a deep puddle.
The thin-film substrate retains more of its existing bump detail and broader
roughness. The thin clearcoat follows that same normal; deeper water tends to
the geometric plane. Existing rain-driven ripples affect each lobe once, using
the presented snapshot. Coverage still comes from the actual spatial water field.
Pit-road deposits remain excluded. Dry diffuse colour, wet darkening, rain
ownership, water/grip equations and the physical clearcoat weight are unchanged.

There are no additional geometry, textures, lights, passes or uniform owners.
These are authored presentation coefficients, not a new water simulation or a
claim of photometric calibration. The isolated GPU probe retains physical-light
images and explicit diagnostic normal images; neither is called gameplay footage.

### The broadcast subject includes the crew and service equipment

Previously the pit composition returned the car-only radius, 3.1 metres. The
new car-local service envelope includes all fifteen actors, skinned clothing,
helmets, gloves, carried tyres, jacks and release equipment. Its bounds are
verified against actual skinned and transformed vertices over 24 service states,
not just against actor roots. Existing authored camera rigs must frame that
whole envelope; neither mechanics nor occluding scenery are hidden to fit it.

Framing widens smoothly as the real pit car slows, stays wide during service,
and tightens as the car departs. It reconstructs directly from recorded state,
without a second animation clock. The normal broadcast selector, physical
camera positions, occlusion tests and complete-pack framing remain authoritative.
Read-only diagnostics expose framing success and the **presented** pit state,
so a paused replay cannot be checked against an unrelated newer live frame.

### Avoid redundant pit animation and GPU updates

A bounded exact-value cache checks the fields actually consumed by pit poses:
car identity, active service phase/clock, pose, jack height, wheel contact state,
and camera-dependent visibility/detail. Identical paused/replayed poses, and
ordinary racing with no service actors, no longer rebuild and dirty the same
bone/instance data every rendered frame. A failed pose build cannot publish a
cache identity. Rewind, changed contact state, visibility and detail transitions
still rebuild deterministically.

Active instance attributes upload their used prefixes. Bone textures retain
their existing allocation and valid upload path; no unsafe multi-row texture
update-range optimization is used. Actor count, geometry, materials, service
poses, draw batching and LOD thresholds are unchanged. This reduces redundant
work; it is not a measured consumer-GPU FPS claim.

## Broader normal-application evidence

`e2e/28-race-pit-presentation.spec.ts` adds three distinct eight-car journeys
and a separate material GPU control. The existing four solo full-lap tests
remain enabled and unchanged.

* **Populated start:** actual lights and moving race field, continuous browser
  video, the existing timed-scene frame recorder, existing performance capture,
  and source-bound session observations.
* **Wet-night traffic:** real opponents are given a recorded head start through
  normal controls; the demonstration driver follows under the actual simulation.
  The test requires a moving car ahead with real wheel water and active spray,
  completes the existing full-lap recorder, measures another uninterrupted
  workload and checks actual replay rewind/camera views.
* **Pit journey:** a normal pit request made after the entry travels around the
  circuit to legal entry, stops, services and exits. The existing worker-observation
  recorder must contain phases 1–6. Those observations locate removal and
  installation inside the real replay. All four camera views, complete crew
  framing, wheel offset, held-pose reuse and rewind are checked and retained.

No teleport, injected snapshot, accelerated simulation, removed rival, synthetic
completion label or new general-purpose recorder is used. Default application
rendering settings are retained. Video starts at browser navigation; screenshots
supplement it rather than pretending to be an uninterrupted drive. Diagnostics
are read-only. No camera/driver/settings changes or screenshots are made during
the dedicated performance windows. The report retains warm-up and complete raw
frame intervals; polling and browser-video overhead remain part of this hosted
workload, not a controlled physical-hardware benchmark.

The material GPU test is explicitly an isolated production-material probe. It
checks thin-film/deep-water normal contrast, rewind/restoration and stable
resource counts. Exact shader-string expectations in two prior unit tests were
updated to the new equations; their other assertions are retained. Existing
CI jobs, test budgets, retries, thresholds and skipped-test policies are unchanged.

## Evidence, remaining discrepancies and reproduction

The local validation record is `PHASE_27H6_VALIDATION.json`. Consult the exact
published revision's normal CI and attached browser artifacts for hosted results;
older baseline videos are never relabelled as candidate evidence. Local Chromium
could not create the production WebGL context, so local numerical/geometry checks
are not represented as ordinary-game GPU validation. Physical Windows hardware,
wheel/controller driving, VRAM, asset-load behaviour on target machines, and
sustained target-PC frame rates still need independent captures.

R003's character/anatomy/material resemblance, R004's final crew/vehicle quality,
R010's full rain/motion/material fidelity, and R039's venue/population/night
quality remain discrepant or unaccepted. This increment does not rebuild all
character or circuit assets. R069's reverse/online/ghost functionality and R084's
separate vehicle-series target also remain absent. Every existing matrix row
retains its own disposition; **0 PASS / 230 PARTIAL / 2 FAIL required rows and
16 excluded references** are not converted into approvals by adding tests.

The original directive, authored Blender/GLB assets, dependencies, simulation,
inputs, storage, workers, audio and original GitHub workflows are preserved.

```sh
npm ci --no-audit --no-fund
npm run check
npm run test:physics
node --experimental-transform-types scripts/rotation-benchmark.ts
node --experimental-transform-types scripts/pit-integration.ts
node --experimental-transform-types scripts/race-classification.ts
node --experimental-transform-types scripts/phase27h-matrix.ts --check
npm run test:e2e -- e2e/28-race-pit-presentation.spec.ts
```

The existing performance report comparator should be used on matched physical
hardware/workloads before accepting performance closure. Full artwork review and
Phase 28–30 racing, game-feel and robustness work remain separate from this
implementation increment.
