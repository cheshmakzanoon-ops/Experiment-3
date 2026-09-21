# Phase 27E — presentation implementation and acceptance tooling

Base: `6279ac7139a9f8abf4291470aa35c08358bd3fdf`, `main`, 21 September 2026.

This is a source increment across 27E.1–27E.10, **not completion of all ten acceptance gates**, the 148-section directive, visual parity with the reference title, or Steam readiness. In particular, implementation of a capture/approval system does not mean a person has approved the captures. No reference image or extracted commercial game asset is shipped.

## Implementation by workstream

| Workstream | Delivered in this increment | Remaining acceptance |
| --- | --- | --- |
| 27E.1 — car exterior | Shared original nose, sidepod and engine envelopes; real open cooling slots with inset inner surfaces; conformal identity patch; suspension inboard attachments terminate on the actual tapered shell; wheel-cover depth correction; mid/far bodies use the same envelopes instead of reverting to swollen silhouettes. | Independent whole-car silhouette, seams, intersections, underside and all aero surfaces still need art review. This is not a scanned or licensed car. |
| 27E.2 — materials | Distinct nonmetallic painted-composite response and filtered pigment roughness, including livery material clones. Existing carbon/rubber/metal and physically driven wetness remain. No extra texture, pass or animated noise. | Final multi-light material/exposure calibration and every near/far material transition remain open. |
| 27E.3 — driver/cockpit | Shaped shoulder/chest/clavicle transition, shorter neck/support, flattened closed harness webbing, finer sleeve folds and an original glove colour. Bone anchors, IK, control contacts and instrument ownership are retained. | Nearby hands, helmet, anatomy, suit and cockpit still require independent artistic acceptance. |
| 27E.4 — venue | All six existing service sites gain authored access spurs, closed gates, pedestrian paths/bollards, roof drainage/grates and facade/service detail. Access planning checks both edges of the strip against the circuit, terrain, stands and camera sites. | Complete venue/landscape architecture, facilities and distant repetition remain open. Gated scenery does not introduce a new physically drivable road. |
| 27E.5 — wet spray | Connected core/entrained mist and derivative-filtered filament variation; bounded red scattering from actual presented rear-lamp positions/signals. Existing pool, emission, advection, lifetimes and recording remain authoritative. | Still an unshadowed bounded billboard scattering approximation, not resolved volumetric turbulence or a complete wet-weather art approval. |
| 27E.6 — night | Continuous authored cloud/rain night profile for fill, environment and exposure, preserving the four-light spatial system and unchanged daytime path. | Complete wet-night exposure/black-level review around the lap remains open. These are authored values, not calibrated photometry. |
| 27E.7 — temporal review | In-app, source-identified rendered-frame recording plus optional silent WebM. Real forward circuit travel AND the lap counter are required for a full-lap completion. Pauses, view/configuration changes and visibility loss interrupt rather than disappear. | No new full continuous human-driven four-weather/four-camera lap acceptance is claimed. The short GPU regression is explicitly partial. |
| 27E.8 — broadcast | Per-shot pan/zoom/lead styles; smooth proximity-based battle framing; safe immediate widening and filtered tightening; single-car fallback when the pack cannot fit. All twenty physical rig sites remain fixed. | Full-race start/battle/pack/pit/final-lap cinematography and continuous occlusion review remain open. Proximity is not a fabricated overtaking event. |
| 27E.9 — references | All 100 rows retain catalogue provenance, exclusions, duplicates, implementation and reproduction routes. Added actual PNG hash/source/configuration attachment, reviewer/note decisions, stale-source invalidation and bounded import/export. A new PNG never inherits an old approval. | Applicable unique rows begin at NEEDS WORK. No bulk acceptance is granted. Actual UI screenshots and all high-resolution comparisons still need human review. |
| 27E.10 — performance | Raw frame/render/physics/GPU observations, resource counts, LOD/camera/exposure discontinuity indicators, CLI revalidation and explicitly proposed frame-time targets. Missing GPU data is unmeasured, never a zero-time pass. | Consumer hardware, loading, physical controllers and VRAM remain unmeasured. Resource counts are not VRAM. The earlier plan's 20-car example is outside the existing protocol/configuration; this increment does not raise its capacity. |

## Engineering ownership and limits

Geometry/material work lives in `car-surfaces.ts`, `bodywork.ts`, `car.ts`, `car-livery.ts`, `paint-finish.ts`, `driver-anatomy.ts`, `driver-materials.ts` and `lod.ts`. Existing moving controls, mirror ownership, wheel poses and damage-driven component visibility remain.

Wet/night/camera work lives in `rear-signal.ts`, `spray-clouds.ts`, `effects.ts`, `daylight.ts`, `trackside.ts` and `renderer.ts`. Rear signals use a fixed twelve-source uniform field, not twelve new Three.js light passes. Their signal phase comes from simulation time. No wall-clock animation, secondary emitter or fake replay state is added. The analytic field can tint nearby mist but does not compute light occlusion through cars.

Venue work lives in `venue-service-plan.ts` and `venue-service.ts`. Small storage-bin bevel tessellation was reduced to make room for actual authored detail; no protected road clearance or existing render budget was increased.

Evidence/UI work lives in `presentation-review.ts`, `reference-evidence.ts`, `review-video.ts`, `reference-review.ts`, `photo-studio.ts`, `interface.ts` and `main.ts`. `scripts/phase27e-review.ts` verifies exported evidence. The new browser journeys use real application controls; controlled component fixtures are separately labelled and cannot stand in for them.

## Reproducible measurements

The identical hero-camera fixture changes **88,419 → 96,009 triangles**, while retaining **95 draw calls, 96 geometry resources and nine textures**. This is an approximately 8.6% hero triangle increase, not a claim of free detail or a measured FPS improvement. Other crops submit different subsets.

The existing physical pit-service fixture measures **99 draw calls**, retaining its original `<100` assertion. The six service areas retain **48 merged mesh submissions** and measure **26,880 triangles**, below the original **28,000** geometry limit. Access strips use seventeen longitudinal samples and protected full-width checks; the planning grade limit is twelve percent.

The isolated existing spray axial/diagonal GPU fixture retains a worst **one channel-level** difference against its unchanged maximum of two. Fog, occlusion, near-plane, clear, held and rewind assertions remain. A separate red-light diagnostic verifies real uniform upload, exact held/restored images, distance falloff and unmodified particle storage. These fixtures do not certify physical scattering accuracy.

## Validation record

Validation results and exact source hashes are recorded with the delivery. The unfiltered normal browser CI remains mandatory. No test is skipped or weakened in this source increment.

- Locked-toolchain `npm run check`: 773 unit cases in 73 files, ESLint, TypeScript and the Vite production build passed locally. The existing large-chunk warning remains visible.
- Existing component regressions: ten rendering tests passed, including seven hero close views, 81 circuit survey views, spectator colour/depth and LOD continuity, instruments, the physical pit snapshot, and retained spray GPU gates.
- The final expanded rendering subset passed all eight tests after capture hardening: the five new component tests, the original full-renderer wet-race test, the isolated rain GPU test and the existing changing-weather GPU test. Together with the ten existing regressions, eighteen distinct component/rendering tests passed. Final per-test results and captures are retained with the delivery.
- All eight native scripts passed: validation, dynamics, marshal integration, wet pits, integrated driving, rotation, physical pits and classification. The integrated changing-weather journey passed all fourteen checks. This is numerical input/physics/replay/CSV evidence, not the full audiovisual Section 146 scenario. No new 100-lap endurance claim is made.
- Full local navigation to the normal preview URL was attempted and returned `net::ERR_BLOCKED_BY_ADMINISTRATOR`. No bypass was used. Both new full-application journeys were also invoked through the normal Playwright configuration. Each failed at navigation with the same administrator-block error, before application assertions could run; neither is reported as passing. Their intended coverage is actual photo/audit export and live review/resize interruption.
- Real wheel/gamepad, consumer hardware, independent art review, audio perception and the three final full-project audits were not executed.

Real component rendering uses Three.js 0.180.0 and headed system Chromium 144 under Xvfb/SwiftShader. This is not a consumer GPU benchmark or the CI-pinned browser. Dependencies were recovered from the repository's earlier successful locked-toolchain artifact; no dependency version or lockfile was changed. An offline `npm ci` attempt was not a successful dependency install.

The native scenarios' executed core/simulation/script bytes are unchanged in final source. Fresh generated JSON is retained in delivery evidence rather than overwriting historical checked-in reports with newer all-source fingerprints. Report scope and module identity take precedence over a historical PASS label.

### Intermittent empty capture investigation

An intermediate expanded GPU run returned entirely transparent PNGs from the wet-race fixture despite positive draw counts and no reported WebGL error. The unchanged base and the candidate each passed the original test when run separately, so these observations do not establish a deterministic new shader or physics defect. The failed images and log are retained.

The fixture now submits its original two held draws and synchronous PNG readback inside a single animation-frame callback, matching the application's capture scheduling. Camera states, quality, particle history, draw count, image-content assertion and all other assertions are retained. No retries, empty-image fallback, mock renderer or permanent drawing-buffer preservation were added. The complete expanded eight-test subset passed after this hardening. This improves capture ownership; it is not proof that every intermittent GPU/driver issue has been eliminated.

The WebGL specification's drawing-buffer presentation section documents the default post-composition clear and recommends synchronous draw/readback ownership (`https://registry.khronos.org/webgl/specs/latest/1.0/`).

## Using the evidence tools

### Numbered image comparison

Open **Reference Review**, inspect a numbered entry, then export the current scene through **Photo Studio → DOWNLOAD PNG**. The studio shows the active reference link; **UNLINK REFERENCE** switches back to ordinary photo export. Frame/source/view identity is frozen in the same task as rendering, before asynchronous PNG hashing. PNG bytes remain an exported file; local storage contains only metadata.

Reopen Reference Review, compare the original image with the exported counterpart, enter a reviewer and meaningful discrepancy note, and select NEEDS WORK or ACCEPTED. The latter is a human declaration, not a software-generated quality score. Changing source code or replacing its PNG invalidates the prior approval. Duplicate and unrelated/supplementary classifications remain governed by the original catalogue.

**EXPORT ALL 100 COMPARISONS** includes both the reviewer records and the original implementation/reproduction/gap ledger. Keep its PNG files beside the JSON. Imports are transactional and bounded to 3 MB; counterpart PNGs are individually limited to 32 MiB. This permits all 100 maximum-length records without making the export impossible to re-import. No executable markup is evaluated.

### Temporal footage and frame observations

During a session, pause and open **FULL-LAP VISUAL REVIEW**. Enter actual machine details, choose a workload matching the current scene and choose a full lap or a separately labelled thirty-second scene. Recording does not change weather, move the car or enable autopilot. Optional WebM has no audio, uses a real browser encoder and is bounded to 64 MiB. Encoding cost remains inside the observed frame intervals.

Resume and drive. A full lap needs actual signed road progress at least equal to circuit length and an increased completed-lap count. Merely crossing the finish line, jumping a counter or driving the same section backward/forward cannot approve a full traversal. Invalid motion, pauses/configuration changes, the 30,000-frame capacity or ten-minute cap stop recording with an explicit reason. Normal ERS driving actions are not graphics-setting interruptions. The renderer records each submitted frame; requested video frames are not misreported as encoded video frames.

Pause again and export frame JSON and, when ready, the silent WebM. Review normal and worst intervals, cuts, shadow/reflection/LOD transitions and each reference discrepancy. Thirty-second or interrupted reports must not be described as full laps. A completed lap is traversal evidence, not automatic visual acceptance or proof that its racing lap was valid.

### Command-line verification

```sh
node --experimental-transform-types scripts/phase27e-review.ts presentation report.json SOURCE_SHA256
node --experimental-transform-types scripts/phase27e-review.ts presentation report.json SOURCE_SHA256 --strict
node --experimental-transform-types scripts/phase27e-review.ts references audit.json SOURCE_SHA256 /path/to/pngs
node --experimental-transform-types scripts/phase27e-review.ts references audit.json SOURCE_SHA256 /path/to/pngs --strict
```

Use the exact 64-character source fingerprint shown by the application/export. The presentation verifier recomputes summaries and completion from raw observations. The reference verifier hashes the actual PNG bytes and validates their dimensions/source and all 100 records. These are consistency checks, not authenticated hardware/reviewer identities or visual similarity judgements.

Exit 0 means the requested consistency checks succeeded; without `--strict`, incomplete records are still allowed and explicitly reported. Strict mode returns 1 for incomplete/unmeasured/failed target evidence. Invalid input, wrong source, missing files or mismatched bytes return 2. Proposed 60 Hz review targets are P95 frame ≤20 ms, P99 frame ≤33.33 ms, P95 render CPU ≤8 ms and P99 GPU ≤12 ms. They are neither Steam requirements nor measured minimum specifications. No GPU result is awarded without enough actual GPU samples.

## Directive/reference preservation

`MASTER_DIRECTIVE.md` remains byte-identical, SHA-256 `f508a1b9be8e8a19a2ccc39d744e82d774cf95ecc773c12482efbcb9fb89f75c`; `package-lock.json` remains `0ee732475bc70f3bec4bfa7787f904d51bc28c185534dff3762f2d18801bbc59`.

No core, simulation/protocol/worker, storage, input or audio source implementation changes. Existing directive/requirement ledgers and their unclosed statuses remain. This increment advances relevant graphics/material/LOD/camera, instrumentation and acceptance obligations; it does not mark all 148 sections complete or substitute a Phase 28 feature list for Phase 27 acceptance.

All 100 source files in the recovered reference ZIP were matched against the catalogue SHA-256 values. Contact sheets and focused high-resolution car/cockpit/wet/night references informed this work. File-identity verification is not a new high-resolution approval of every image. The original sixteen unrelated exclusions, two peripheral supplements and duplicate classifications are preserved. Original car/body/driver/circuit designs, not commercial likenesses, team marks or reference pixels, are delivered.

## Reproduction gates

```sh
npm ci
npm run check
npm run test:physics
node --experimental-transform-types scripts/rotation-benchmark.ts
node --experimental-transform-types scripts/pit-integration.ts
node --experimental-transform-types scripts/race-classification.ts
npm run test:phase27c
npm run test:e2e
```

The focused component subset is useful for diagnosis, not a replacement for the last unfiltered command. Publication, deployment, actual current-commit CI, final artistic acceptance, human Section 146 driving and Steam packaging/release approval remain separate gates.
