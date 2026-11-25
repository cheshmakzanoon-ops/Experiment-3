# Assignment 51 — final protected-source audit

## Result

**Pass: no authored model, character, geometry, material, texture, course, terrain, environment, vehicle specification or source asset changed.** This finding is based on independent inspection of every changed/new runtime module and a byte-for-byte comparison of **1,772 protected files / 264,155,763 bytes**, including their Git file modes. The protected set includes **708 rendering files**, of which **116 are offroad rendering files**. `src/rendering/bike.ts` is checked separately: reversing only its permitted reader/import changes produces the entire original file exactly.

The final source was read on **25 November 2026 at 20:00 UTC**. Task baseline is `b527a7e01ea247f0233a2ec4f2850639bafbd887`; observed HEAD is `f3b39eb8e1b02fc0677086819fc384b6ceacefc2`. The task runtime remains uncommitted at this audit. This is a source-scope acceptance, not a claim that gameplay behavior is unchanged or that an integrated test run has passed.

Assignment-owned deliverables are this report, `../evidence/51-protected-scope.py`, and `../evidence/51-protected-scope.json`. No production, test, configuration, asset, index or ref was changed by this assignment.

## Independent inventory and comparison method

The audit independently enumerated baseline tracked files with `git ls-tree -rz`, inspected `git diff` against the task baseline and current HEAD, and enumerated the actual filesystem under every protected root with `Path.rglob`. That last enumeration includes ignored files, so a newly generated or ignored asset cannot disappear from this check merely because `git status` omits it.

For each protected file, the script streams the original blob through `git cat-file --batch`, reads the current filesystem bytes, and compares the two directly. It also checks regular/executable/symlink mode. Every file passed. The compact JSON manifest records each path, mode, baseline Git blob ID, common baseline/current SHA-256, and byte count. It therefore preserves both a reproducible inventory and per-file content evidence.

All baseline `src/` files other than the 14 explicitly reviewed runtime modifications are protected wholesale. This is deliberately broader than filename searches for words such as “model” or “terrain.” It covers procedural construction, embedded geometry/manifests, shaders, model/character assembly, materials, and course/specification definitions wherever they occur in source. All scripts other than the single modified benchmark are protected as well, including asset generators; all `tools/` files are protected.

| Protected root | Exact files | Result |
| --- | ---: | --- |
| `src/`, excluding the 14 reviewed modifications | 1,108 | Identical bytes and modes |
| `public/` | 231 | Identical bytes and modes; no extra files |
| `authoring/` | 22 | Identical bytes and modes; no extra files |
| `assets/` | 2 | Identical bytes and modes; no extra files |
| `reference/` | 1 | Identical bytes and mode; no extra files |
| `scripts/`, excluding the modified display-cadence benchmark | 339 | Identical bytes and modes |
| `tools/` | 33 | Identical bytes and modes; no extra files |
| `playable/` | 9 | Identical bytes and modes; no extra files |
| `lookdev-tmp/` | 2 | Identical bytes and modes; no extra files |
| `screenshots/` | 13 | Identical bytes and modes; no extra files |
| `scratch-tmp/` | 11 | Identical bytes and modes; no extra files |
| `3dmodels.md` | 1 | Identical bytes and mode |
| **Total** | **1,772** | **All identical** |

The only new files anywhere inside those roots are the four reviewed runtime modules and three new benchmark modules. No new authored/model/environment files were found. Documentation and generated acceptance receipts are outside this protected source inventory; the complete task change inventory was reviewed separately.

The protected-row digest, computed from the manifest's compact JSON row array, is:

```text
49a448d918d0db165240c05976fadfaa4b50ff42aea633d30fc308b7696c42fd
```

## Exact model-construction proof for bike.ts

The entire baseline `src/rendering/bike.ts` is **121,243 bytes**. The current file is **121,082 bytes**. The independent verifier performs exactly these three inverse substitutions in memory, each requiring one occurrence:

1. Remove the added `sampleMxFootField` import.
2. Restore the removed `hasMxFootControls` import beside `MX_MOTION`.
3. Replace the three `shiftAngle`, `shiftCover`, and `shiftClear` sampler reads with the original four-line `hasMxFootControls` / linear-interpolation block.

The reconstructed bytes equal the entire baseline file. Nothing else was normalized, ignored, reformatted or masked. This proves that every other byte, including its procedural model construction, character/bike meshes, material/geometry definitions and existing rig transforms, remains unchanged.

| Version | SHA-256 |
| --- | --- |
| Baseline | `775c708bd852f503d5129c5674ecb41e2348956260aa2e62900ad2c638427b29` |
| Current | `63363c3e43e471398a55267188a791a81bfb9c58fba7a85eb5d51cc59aeae748` |
| Current after the three exact inverse substitutions | `775c708bd852f503d5129c5674ecb41e2348956260aa2e62900ad2c638427b29` |

This reader change feeds the existing rig its recorded physical foot trajectory. The rig and its authored construction are unchanged. In particular, `src/rendering/rider.ts`, `offroad/dirt-bike-model.ts`, the motocross rider-motion/contact/equipment/boot modules, bodywork, axles, chain drive, and foot-control construction all belong to the byte-identical protected set.

## Semantic classification of every runtime change

The task has **18 runtime paths: 14 modified and four new**. Every changed hunk and the complete four new modules were independently read. None introduces model assets, mesh/material construction, terrain/course definitions or vehicle specification edits.

| Runtime path | What changes; why it is engine work |
| --- | --- |
| `src/core/session-identity.ts` | Simulation identity 39 → 40, recording the changed deterministic simulation behavior. Fixed tick rate remains 120 Hz. |
| `src/rendering/bike.ts` | Exactly three sampled foot-state consumers and associated imports; full model-source reversal proof above. |
| `src/rendering/frame-state.ts` | Validates optional recorded motion at endpoints and held samples before publishing presentation state. |
| `src/rendering/offroad/chase-camera.ts` | Integrates measured heading, roll and gaze targets over time; uses the current flight timer at a hidden touchdown/relaunch. This changes camera response, not scene construction or terrain. |
| `src/rendering/offroad/mx-machine-pose.ts` | Reconstructs bounded suspension/steering extrema from recorded rates and rejects invalid optional motion. Existing vehicle travel specifications are read, not changed. |
| `src/rendering/snapshot-interpolation.ts` | Routes optional recorded standing/dab/body fields through posture interpolation with reset/contact boundaries. |
| `src/simulation/offroad/ai.ts` | Removes one discontinuous front-load cutoff from the existing supercross AI shoulder guard; exact scope proof below. |
| `src/simulation/offroad/contact-impulse.ts` | Adds a coupled unilateral two-stop impulse solver using mass, inertia and sampled contact geometry. This is physical contact mathematics; no authored geometry changes. |
| `src/simulation/offroad/dirt-bike-vehicle.ts` | Integrates analytic flight and swept player contact, coupled stops, bounded support refinement, finite automatic posture, reset lifecycle, and synchronized suspension telemetry. Terrain is sampled through its existing API. |
| `src/simulation/offroad/mx-gear-stroke.ts` | Serializes accepted shift initial conditions and evaluates bounded position/rate-continuous trajectories. Existing isolated stroke timing/envelopes remain the trajectory basis. |
| `src/simulation/offroad/mx-ground-physics.ts` | Replaces energy-injecting explicit coordinate terms with the exact yaw-frame rotation; tyre shear law is unchanged. |
| `src/simulation/offroad/rider-weight.ts` | Adds a smooth local neutral body-pose blend and its analytic derivative. Manual stroke stepping/momentum remains unchanged. |
| `src/simulation/protocol.ts` | Assigns optional posture and accepted-foot-trajectory metadata within existing reserved contact-tail slots. |
| `src/simulation/wheel-contact-state.ts` | Publishes those optional controller states, including their rates and split local clock. |
| `src/rendering/offroad/mx-foot-pose.ts` — new | Pure numerical reader for recorded accepted shifts, with finite/range/continuity validation and legacy fallback. No rendering-library import or construction. |
| `src/rendering/offroad/mx-rider-pose.ts` — new | Pure bounded Hermite posture reconstruction. No rendering-library import or construction. |
| `src/simulation/offroad/air-drag.ts` — new | Analytic quadratic-drag speed and distance step with input checks. |
| `src/simulation/offroad/mx-rider-posture.ts` — new | Fixed-step critically damped automatic standing, dab and body response with continuous targets. Response settings are engine/controller values, not measured human physiology or character specifications. |

The manifest contains baseline/current SHA-256 for every runtime path. Its separately defined runtime-row digest is `35a15a118f35fcd42f701eba881296ec640faa38f35c37a72113066f6a5bcf2e`; this digest is an audit inventory digest, not the build or A49 test-source digest.

## AI integration and unchanged gameplay limits

The AI change is precisely **four added lines and one removed line**: three explanatory comment lines, plus removal of `c.forceFront < d.mass * G * 0.38 &&` from the existing shoulder-guard condition. The verifier restores that condition and removes those three comment lines in memory; the entire resulting file is byte-identical to baseline.

The surviving guard still requires supercross, knobby tyres, the AI/legacy control model (`!d.p.independentRearBrake`), speed above 3 m/s, active racing, and completion of the existing launch period. The geometric swept-path threat calculation and all steering/throttle/brake formulas remain byte-identical. Front support continues to scale their existing authority continuously. This is the narrow integration repair for a finite body response that can restore front load while the outward lane threat remains; it changes when the existing guard is available, not the course or the bike's physical grip/crash allowances.

AI baseline/reversed SHA-256 is `9ba826f4d2b0c42d5f98e175ed58a3bdb47a6bae739d29d9a63e6619f2b3b440`; current SHA-256 is `c6b3279324d8f52c3d29208e466fb61862d63b800b4c89539f5515ebb3ec1a0e`.

The verifier separately compares byte-exact regions for the adapter's complete spring inverse/force/preload methods, its complete `judgeLanding` function, the ground solver's yaw inertia and complete tyre-shear law, and all protocol offsets/strides/version declarations. It also confirms the existing `RIDER_REACH`, `RIDER_AIR_LEVER`, `DEEP_CONTACT`, `STOP_COMPLIANCE`, `PLAYER_GRIP_GRACE` and `LANDING_NOSE_UP` declarations retain their exact values. The added support-refinement limits govern numerical integration accuracy; the existing spring law and verdict thresholds are unchanged.

Complete files defining the race, grip, bike dimensions/specifications and courses are protected and identical, including `race.ts`, `config.ts`, `tire-families.ts`, `bike-definitions.ts`, `vehicles.ts`, the entire vehicle catalogue, and offroad `dirt-bikes.ts`, `types.ts`, `riding-feedback.ts`, `suspension-geometry.ts`, `venues.ts`, `course.ts`, `course-terrain.ts` and `profile.ts`. The entire circuit catalogue and open-world source definitions are also included. Protocol stays **17**, header **24**, entrant stride **331**; the contact tail remains base **298**, size **33**.

## Task changes versus inherited receipts

`b527…` → `f3b…` contains **24 inherited CI receipt changes: 23 modified files and one deleted log**, all under `ci-reports/`. The manifest records their exact name/status list. No uncommitted change under `ci-reports/` was found. These receipts are not attributed to this engine development.

The task's source/tool/test work outside its documentation comprises **59 paths**:

| Kind | Modified | New | Total |
| --- | ---: | ---: | ---: |
| Runtime source | 14 | 4 | 18 |
| Benchmarks | 1 | 3 | 4 |
| Tests | 9 | 28 | 37 |
| **Total** | **24** | **35** | **59** |

The accumulating task reports, architecture/plan documents, roster and acceptance evidence are additional documentation. Their count is intentionally not frozen here because later assignments are still writing reports.

## Compatibility caveat and audit limits

Assignment 30's report was read, but its source conclusions were not accepted on authority: this audit independently inspected the current final runtime and compared protected bytes. Its gameplay evidence must retain its original qualification. A30 found nine exact 48-second non-MX scenario traces. In the two accepted MX-on-road practice scenarios, eight tyre compression/length telemetry values differ at initial placement, and optional foot-trajectory metadata also differs. Subsequent physical snapshots in those measured runs were exact. Simulation identity changes globally from 39 to 40.

Accordingly, this report does **not** claim every non-MX snapshot, every vehicle/mode combination or every record byte is unchanged. A30 ran before the subsequent final MX-only review fixes; this assignment did not rerun that gameplay matrix. Source equality of authored data proves the requested model/environment constraint, while dynamics and animation are intentionally different.

This audit does not establish all-course physical accuracy, hardware GPU performance, clinical/biomechanical realism, or passing final units/native races. Those are separate acceptance reports. No broad tests or build were rerun here. The frozen-source hashes identify exactly what was inspected; later runtime edits would require rerunning this audit.

## Reproduce

From the repository root:

```sh
python docs/engine/motocross-dynamics-2026-11-25/evidence/51-protected-scope.py
```

The script reads Git blobs and working files and writes only its sibling JSON manifest. It neither stages files nor changes refs, source, tests or assets. Its exact source allowlist intentionally fails if a later runtime path appears. It also fails if any protected byte/mode changes, any unexpected file appears within protected roots, either permitted inverse patch ceases to reproduce baseline, any separately protected runtime law changes, or inherited receipts acquire working edits.
