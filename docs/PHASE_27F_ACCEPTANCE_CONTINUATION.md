# Phase 27F — implementation, measured evidence, and open acceptance

Base: `ea08a6754667b256709e7c4bff9263b3d033a209` on `main`.
The base's Build and validation run `35601740008` passed validation, scenarios,
all three browser shards, wet presentation, and publication. The narrow-screen
hash-wrapping correction and its original assertion are retained.

This is a **development candidate**, not a final-art sign-off, completion of
Section 146, fulfillment of all 148 sections, or a Steam release candidate.
Implementation, numerical/component validation, complete application validation,
human visual acceptance, and hardware measurements are distinct gates.

## Scope correction: game development continues after 27F

The next milestone is **not automatically Steam productization**. The owner's
remaining scope explicitly includes more genuinely different game modes,
substantially better cars, drivers and spectators, stronger atmosphere, and
**at least 16 distinct playable maps**. The existing circuit, its weather states,
and camera views do not count as 16 maps. These are open requirements, not
features implemented by this source increment. The original directive and
reference ledgers remain authoritative and unclosed.

## Implementation and acceptance by workstream

| Workstream | Changes in this source | Acceptance still required |
| --- | --- | --- |
| 27F.0 | Work began from the all-green `ea08a67` baseline; retained all CI assertions, budgets and workflows. | The new candidate needs its own full remote CI. An earlier commit's green run cannot certify it. |
| 27F.1 | Closed seven-station floor skins and rising twin tunnel/diffuser surfaces; closed dished wheel covers with actual bores; the same envelopes at all three LODs; shaped multi-element wings and endplates retained at distant LODs. | Independent whole-car proportions, intersections, thickness, underside, materials, moving suspension and full-race LOD art review. The reference-level car standard is not reached merely by these geometric corrections. |
| 27F.2 | Original non-spherical helmet crown/chin/cheek/brow, conformal visor and seal, separate pivots; existing driver IK, control contacts and cockpit instruments preserved. | Complete head/neck/harness/suit/hand anatomy and close-camera artistic acceptance. Existing shoulder, hand and suit work has not been replaced by a fully new scanned/rigged human asset. |
| 27F.3 | More anatomical instanced spectator silhouettes and consistent hair treatment in near/far/depth paths; five authored planting districts and four canopy silhouettes in the existing atlas and tree budget. | Full venue authorship, complete vegetation/terrain/crowd artistry, all lap sightlines, and the future multi-map requirement. Billboards remain billboards. |
| 27F.4 | A real night-skydome shader with shared cloud fields, authored moon/halo and cloud fill; night-specific environment lighting capture with correct day/night cache identity. Existing wet-contact and spray physics remain unchanged. | Wet asphalt/reflection/exposure calibration, motion and full-lap four-weather review. No new physical volumetric scattering or measured moon model is claimed. |
| 27F.5 | Occlusion tests against selected actual solid roof/wall meshes before batching; blocked shots may select an existing adjacent fixed camera rig, with unresolved occlusion exposed diagnostically. | Whole-race event cinematography, cars/fences/vegetation/terrain occlusion not covered by the solid registry, and start/battle/pit/finish shot acceptance. |
| 27F.6 | Source-identified 1920x1080 production-renderer component capture workbench, all-100 comparison manifest, original hashes/duplicates/exclusions retained, explicit missing-counterpart and needs-work states. | Every applicable unique complete-image counterpart, relevant UI/actors/events, and genuine human discrepancy/approval records. A component photograph is not a full application screenshot. |
| 27F.7 | Explicit local browser hardware/input observations in review exports: renderer strings when exposed, platform, heap observation, device axes/buttons and trusted/untrusted key-event counts. | Real Windows CPU/GPU/frame-pacing/loading/memory/VRAM and physical gamepad/wheel measurement. VRAM stays null; browser platform strings and input events cannot certify physical hardware or a human. |
| 27F.8 | Bounded whole-session read-only worker-snapshot/UI-event observation; final accepted results snapshot retained; automation, pauses, restart, visibility loss, limits and errors exposed. Optional real post-compressor game-audio tap for the existing bounded video review recorder. | One genuine continuous human audiovisual Section 146 drive from application startup through results, replay and telemetry. The observer explicitly does not certify this scenario. |
| 27F.9 | Source/dependency/ownership review, retained-marker review, numerical scenarios/endurance, protected visual regressions, explicit defect findings, and reproducible source handoff. | Full independent engineering, player-experience and audiovisual audits; representative hardware and a candidate-specific completely green full application run. |

## Ownership and measurable budgets

`car-floor.ts` owns shared floor stations, tunnel section and wheel-cover geometry;
`car.ts` and `lod.ts` consume the same shape definitions. `helmet-shell.ts` owns
the original shell and visor parameterization; moving mechanical ownership is
unchanged. Geometry tests verify finite vertices, normals, closed edge counts,
positive signed volumes and cross-LOD bounds, rather than accepting mesh names.

The existing hero fixture records **100,561 triangles**, compared with the
27E base's **96,009**, at unchanged **95 draw calls, 96 geometry resources and
nine textures**. This is an approximately 4.7% triangle increase, not free detail
or a measured FPS improvement. The physical pit fixture remains **99 draw calls**
against the unchanged `<100` gate. The near/mid/far crowd budgets remain
**600/360/120 triangles**; distant impostors remain two triangles. Planting uses
the existing atlas and 650-tree cap, not a second vegetation renderer.

`broadcast-sightlines.ts` stores at most 256 immutable oriented solid bounds.
Selected actual grandstand/service roof and wall meshes register before merge.
No empty stand-volume is used to pretend the whole structure is opaque. The
20 physical rig sites remain fixed. This is conservative solid-bound occlusion,
not GPU depth visibility of every object. Unresolved obstruction is reported.

`daylight.ts` preserves the original daytime branch and restores temporary sky
uniforms after environment capture, including failures. Night clouds use the
same recorded weather field; no wall-clock or secondary physics weather state
is introduced.

## Session, audio, and hardware evidence behavior

From the paddock, open **SESSION 146 EVIDENCE**, provide the requested identity
labels, and arm before choosing a race. It samples the actual accepted player
worker frame at up to 2 Hz, with an additional final results snapshot, for at
most two hours / 14,400 rows / 4,096 UI events. It neither drives the car nor
alters tire, weather, damage, lap, pit, AI or replay state. Stop and export JSON
through the same dialog. This is sparse observation, not every physics tick.

The final results snapshot is captured even when the application changes to its
results state between render frames. The application's retained demonstration
flag is observed even if the user pauses immediately after enabling automation.
Mid-race pauses and visibility loss remain visible. Restart, rewind, invalid
state, capacity, clock failure and application failure do not become silent
passes. Reports keep `section146Accepted`, `humanVerified`, `startupCaptured`
and `audioVideoAttached` **false**. Opening an already running app cannot prove
application startup, and metadata alone cannot attach a video.

The existing **FULL-LAP VISUAL REVIEW** now optionally includes **GAME AUDIO**
when video is requested. The tap is taken from the actual post-compressor game
bus. No microphone permission is requested, no audio is fed back to playback,
and disposal disconnects only the tap and stops its owned tracks. A supported
WebM encoder is still required; failures, missing data and the 64 MiB limit are
reported. This bounded lap recorder is not a two-hour race/startup AV recorder.

Hardware/input information is collected for the explicit local review export.
No hostnames, typed key values or microphone audio are collected. Missing GPU
identity/heap data stay unmeasured. Browser-visible device ranges are bounded to
8 devices, 32 axes and 64 buttons at up to 5 Hz. They cannot establish that an
actual wheel was physically operated. Representative Windows evidence remains
an independent outstanding task, not an inferred PASS.

## Validation and evidence boundaries

The delivered evidence archive distinguishes final-source component results,
failed/intermediate attempts, normal-navigation failures, and untouched
historical reports. The main application source fingerprint is
`827b170829faaedae6c1596631a1eae7a023a22c75aa26730cbd06bcbf612d5a`.
This uses the existing Vite fingerprint algorithm; native scripts have their
own recorded fingerprint scope, not an interchangeable identifier.

- `npm run check`: **799 tests in 78 files**, ESLint, TypeScript and Vite build
  passed. The existing large-chunk warning remains. An initial concurrently
  loaded run timed out in the unchanged pit-release test and RPC; that failed
  log is retained. The same unmodified command/assertions passed in isolation.
- **16 protected real-rendering tests passed**, including seven hero views,
  81 circuit survey views, physical cockpit/wheel state, crowds/LOD, pit service,
  wet production-renderer views and the unchanged axial/diagonal spray limits.
- **Three new real component tests passed**: night/cloud/environment continuity,
  actual game-bus video/audio lifecycle, and production evidence-dialog layouts
  at 320, 390, 720 and 1280 px. The decoded recorded Opus track is stereo,
  132,480 samples, finite and non-silent (RMS 0.01803637, peak 0.03689039).
  This validates captured signal, not a human judgement of sound quality.
- All **eight native driving/race scripts passed**. The integrated journey's
  fourteen checks are numerical, not the complete human audiovisual scenario.
- The fresh **100-lap, 10-car, seed-73021 clear endurance run passed**: all
  cars completed at least 100 laps over 7,040.34 simulated seconds; zero recorded
  impact, minimum component health 1.0, and no recorded failures. This is an
  autonomous practice stress fixture with its explicit 113 kg initial fuel,
  not a human race or a Windows performance benchmark. The fresh acceptance
  JSON is separate from the unchanged historical report.
- Both existing full-app review journeys and the new session journey were
  invoked through the normal Playwright configuration. All three failed at
  navigation with `net::ERR_BLOCKED_BY_ADMINISTRATOR`, before application
  assertions. None is reported as passing. The execution environment was not
  bypassed. Full application and current-candidate remote CI remain required.

The dependency versions and lockfile were recovered unchanged from a prior
successful GitHub toolchain artifact; this is not a new successful `npm ci`.
Local GPU evidence uses headed Chromium 144 under Xvfb/SwiftShader and real
Three.js 0.180.0. It is not a Windows consumer-GPU benchmark or the CI-pinned
browser. Headless GPU failures are preserved as execution limits, not relabelled
passes. No workflow, retry count, assertion, physics protocol or render budget
was weakened.

An intermediate audio-test attachment decoder split a MIME data URL at the
wrong comma in `vp9,opus`. The test now decodes after `;base64,`, checks actual
recorded byte length and the EBML signature, and the final clip was decoded.
That was an evidence-decoding defect, not a change to the game's Blob download.
The first high-resolution helper run also exposed Vite's array result shape;
the helper now validates an emitted entry chunk from single or array results.
Both failed attempts remain in evidence rather than being erased.

## Three audit passes — findings, not blanket approval

**Engineering:** the relative TypeScript value-import graph covers 132 source
files and 368 value edges, with 54 type-only edges classified separately. No
value-import cycles or unresolved relative TypeScript imports were found.
The largest executable orchestrator is `main.ts` at 1,639 lines; its growth is
an ownership/maintenance concern, not proof of a 5,000-line god class. The
2,506-line reference catalogue is data. A graph and marker scan cannot prove
absence of hidden mutable state or unmarked incomplete systems. The marker
review records all 75 pre-report matches: temperature/scratch identifiers,
HTML hints, test-spy usage, workflow temporary paths, or retained specification
and historical evidence language. No runtime release placeholder was found by
that particular token scan; this is not a global completeness certification.

**Driving/physics:** new geometry and presentation do not replace or retune the
vehicle/tire/AI integrator. Native traction, thermal, wet-pit, rotation,
classification and contact evidence was rerun. Actual hardware latency, steering
feel, tire saturation readability, human wet-race decision-making and the full
Section 146 sequence still require direct human driving. Passing autonomous
endurance is not that human drive.

**Visual/audio:** close views and lap surveys expose remaining primitive-looking
surfaces, incomplete cockpit/driver anatomy, low-detail venue massing and
vegetation, and a substantial gap from the commercial reference images. The
new floor/helmet/crowd shapes and night atmosphere are improvements to inspect,
not a declaration of reference parity. Selected solid occluders and generated
instancing cannot close complete-race cinematic or human-model quality gates.
See the all-100 reference findings for missing scenes, UI and counterpart
limits. The actual recorded audio signal is not a listening-panel sign-off.

## Reproduction and publication

Use the repository's supported Node version and original lockfile:

```sh
npm ci
npm run check
npm run test:physics
node --experimental-transform-types scripts/rotation-benchmark.ts
node --experimental-transform-types scripts/pit-integration.ts
node --experimental-transform-types scripts/race-classification.ts
node --experimental-transform-types scripts/acceptance.ts 100 10 73021 clear
npm run test:phase27c
npm run test:e2e
node scripts/phase27f-capture.mjs /new/evidence/directory
```

The last helper is explicit component photography, not a CI replacement. Set
`CHROMIUM_PATH` to an installed browser where necessary; `HEADED=1` chooses a
visible browser (under Xvfb on a headless Linux host). It refuses to overwrite an
existing output directory and keeps all 100 original gaps/classifications.
Do not ship the reference archive or its commercial image pixels with the game.

The connected GitHub actions available in this session are read-only; direct
GitHub networking also failed. Publication must be stated separately from local
commit creation. The source/bundle handoff preserves the exact remote parent
and refuses to discard divergent work. A local tested candidate is not an
already-pushed `main`, a deployment, or a green current-commit GitHub run.

`MASTER_DIRECTIVE.md` remains byte-identical (SHA-256
`f508a1b9be8e8a19a2ccc39d744e82d774cf95ecc773c12482efbcb9fb89f75c`).
`package-lock.json` remains byte-identical (SHA-256
`0ee732475bc70f3bec4bfa7787f904d51bc28c185534dff3762f2d18801bbc59`).
No existing all-148 ledger status is silently closed.

### Reference capture defect review

The first batch's GL/error and size checks alone did not detect an entirely
transparent PNG. Native camera inspection also exposed an empty readback and
one invalid GL result. Those images were rejected after pixel inspection, not
counted as valid visual counterparts. The helper now uses two identical held
production draws followed by synchronous PNG and pixel-content observation in
the same animation-frame callback, and rejects empty/black samples, context
loss, nonzero GL error and wrong dimensions. It does not retry failing views or
weaken an existing test. This follows the protected rendering fixtures' view
warm-up/readback ownership; it does not establish that every driver problem is
eliminated. Partial/failed batch records remain in the evidence archive.

Native cockpit, pod, chase and trackside views are now available in the helper
where an exterior orbit is an irrelevant comparison. `--ids=3,8,93` can limit a
new capture run without silently accepting the other numbered entries. This
improves diagnostic relevance, not missing HUD, actors, race events or the
original application's reference-navigation routes. See
[all-100 discrepancy findings](PHASE_27F_REFERENCE_FINDINGS.md).
