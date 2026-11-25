# Assignment 46 — camera lifecycle and recorded flight origins

## Result and owned changes

The independent lifecycle review found and repaired an existing flight-timer observation defect. A touchdown and relaunch can occur between two displayed airborne samples. The camera retained the preceding flight's maximum duration and could consequently give a very short new hop an inappropriate landing kick.

The production correction changes one assignment in `src/rendering/offroad/chase-camera.ts`: an advancing airborne observation now owns the current recorded `AIR_TIME`, including a restarted timer. It does not reset the camera pose, alter camera tuning, change physical contacts, or invent the time of an unobserved impact. A three-case regression file, `tests/motocross-camera-flight-origin.test.ts`, covers both isolated observations and an actual simulation recording. All three tests fail before the correction and pass afterward.

Final focused acceptance is **88/88 tests in six files**, including all 85 existing cases. Focused ESLint, new-test Prettier and the owned-file whitespace check pass. No renderer call site, camera setting, model, environment, course, material, physics threshold or vehicle specification was changed. No git commit or publication operation was performed.

## Natural reproduction and correction

The bounded observation sweep ran ordinary clear-weather practice sessions for MX250/MX450 at Valley Ridge/Arena Nord, with the existing AI demonstration enabled and seed 60724. Each session advanced through 30 seconds of 120 Hz world steps and retained every fourth actual `Simulation.makeFrame()` result: **901 frames per case, 3,604 total**. This is an observation test of camera inputs; it is not player-physics or GPU acceptance.

Only Arena/MX450 exposed a hidden ground interval in this matrix:

| Observation | Recorded value |
| --- | ---: |
| Presented time of the newly observed flight | 27.562265396 s |
| Previous displayed flight duration | 0.237499997 s |
| New displayed flight duration | 0 s |
| Next presented touchdown time | 27.595598221 s |
| New hop's final duration | 0.004166667 s |
| Old camera duration retained at the new origin | 0.237499997 s |
| Corrected camera duration at the new origin | 0 s |

The rider remains `riding`, has zero crashes, and the preceding landing is recorded as clean. This is not a crash, remount or explicit placement fixture. The header's presentation time and the adapter's landing clock have their existing separate origins; they are not equated in this analysis.

The old camera treats the previous duration as sufficient to trigger its existing minimum-flight landing response. At the new touchdown its spring offset becomes **−0.020306317 m**. The independently calculated continuation of the existing spring, with no new impulse, is **−0.000783305 m**. The correction produces that continuation exactly, removing **19.523012 mm of falsely added displacement** while preserving previously accumulated recoil and its ordinary decay.

The natural regression runs the real session, recognizes a flight-clock restart between two airborne samples, and checks the next short landing against the analytical critically damped continuation of the observed spring state. It never changes rider inputs, physical state, camera history or contact outcomes. The observation-only spring-state access separates a new kick from legitimate settling motion.

A separate controlled sequence, `0.70 s → 0.02 s → grounded at 0.05 s`, reproduces the same timer defect in both the original `b527a7e0` camera and the pre-correction task camera. It previously added a **65.217265 mm** landing offset; the corrected camera adds none and matches the otherwise identical short-flight reference pose exactly. This establishes that the faulty retention rule predates this task. It does not assert that the original baseline's different physical trajectory visits the same natural rebound.

## Per-flight history and continuity

The old maximum was unnecessary for uninterrupted flight: authoritative `AIR_TIME` is already nondecreasing within one flight. A decrease identifies a different origin. The update remains inside the existing `h > 0` branch, so held-time redraws still do not consume a new observation.

The repair deliberately keeps the continuous heading, heave, roll, gaze and landing-spring state. No camera cut is introduced. The existing world-velocity path already refreshes `flightHeading` whenever its finite horizontal speed exceeds 2 m/s. At the natural restart the measured speed is **3.123623 m/s**, and the bearing refreshes from **−1.193170505 to −1.192439946 rad**. No extra heading reset is required for this case. Near-stationary airborne fallback retains its existing policy.

The camera cannot reconstruct the exact time or severity of every impact hidden between two samples. This correction prevents an old flight from qualifying a later hop's kick; it does not synthesize the missing earlier touchdown. The three new cases also verify identical poses before and after the new touchdown against a reference with the same currently observed flight, then continue through sixty additional frames to expose any retained hidden-state difference.

## Live caller and lifecycle review

The actual renderer call sites were inspected alongside the controller:

| Boundary | Existing ownership and behavior |
| --- | --- |
| Presentation time | `RacingRenderer.draw()` supplies `CameraClock.step(presented[H.TIME], ...)`; camera integration is not driven by the wall-clock frame-rate estimate. |
| Paused frame | Repeated presented time gives zero camera duration. Inertia and measured target history hold; explicit free look or camera changes remain separate user actions. |
| Motion disabled | Zero motion immediately clears roll and landing motion, including on a paused redraw. Restoring motion uses the existing step response. |
| Camera mode change | `changeCamera()` resets the camera clock, inertia, view orientation and motocross controller, and clears renderer initialization. |
| Scene/session reset | `resetPresentationState()` resets the same history. Main also resets on worker/session replacement, replay seek, retained-page return and return to paddock. |
| Rewind or long gap | `CameraClock` marks a rewind or gap over two seconds discontinuous; the renderer resets the controller before presenting that new baseline. Positive work is capped at two seconds. |
| Photo selection | `setPhoto()` clears renderer initialization; the next motocross chase path reseeds its controller. |
| Broadcast subjects | Main requests a replay-director subject only for trackside mode and otherwise requests the default subject. This assignment did not perform native UI testing of every follow/mode permutation. |
| Vehicle scope | The call site requires a bike with `classId === 'motocross'` and an offroad bike definition. The new controller is not substituted into the GP, car, cockpit or pod paths. |

The horizontal world-camera spring retains its existing feed-forward and bounded integration substeps. For motocross chase, the controller owns the vertical channel through `settleEye()`, preventing the outer world spring from adding a second response to chassis heave. Terrain clearance still samples the existing physical terrain. None of these paths change authored geometry.

## Independent numerical checks

The small task-local probe supplements the existing tests without adding another broad engine sweep:

- Three reset cases following an earlier flight and landing produce exactly the same public pose as fresh cameras, including a new airborne position and a disabled-motion case.
- **93 repeated zero-duration redraws** preserve those poses exactly.
- Eight clock observations cover initialization, advancing time, pause, menu entry/exit, rewind and a three-second jump. Discontinuous observations rebaseline to the corresponding fresh pose.
- Heading and lean ramps were run at 30/144/240 Hz and through nine irregular intervals totaling one second. Maximum heading error against the independent analytical response is **2.45e−16 rad**; maximum roll error is **7.29e−17 rad**. The heading crosses the angle wrap.
- The unchanged camera suites retain the ordinary takeoff/touchdown edge split, sideways-landing corridor handoff, motion disable/restore, terrain clearance, finite-input checks and curved-signal convergence tests.

Affine measured targets admit an exact first-order response. Curved terrain, nonlinear clamps, missed events, the outer horizontal spring and discrete observations still have sampling error. This report does not claim identical complete camera paths at every refresh rate, physical-GPU frame rate or subjective visual certification.

## Validation and provenance

| Command or phase | Result |
| --- | --- |
| Original four camera files | 54/54 passed |
| Existing common camera/clock file | 31/31 passed |
| New flight-origin file before production correction | 0/3 passed; all three reproduce the defect |
| Integrated six-file run after correction | **88/88 passed**, 13.53 s |
| Focused ESLint | Passed |
| New-test Prettier check | Passed |
| Owned-file whitespace check | Passed |

The source and test hashes are recorded explicitly rather than claiming a whole-repository freeze while other assignments work in parallel. Of the eight initial camera/caller/test inputs, only the owned camera source changes; the other seven retain their captured hashes.

| File | SHA-256 after acceptance |
| --- | --- |
| `src/rendering/offroad/chase-camera.ts` | `248bfb44b7f083fc6abc1389e0af9fafcda13db96f0e97c23c70312949a36917` |
| `tests/motocross-camera-flight-origin.test.ts` | `4f28295c2246ac79e9dbbb646dc6d0f067461aac2d04c9f4293553f554c4163b` |
| `src/rendering/camera-dynamics.ts` | `b0ab151fb4b06ca1ec2856860e00ba447f46bb9010a04af4316ac20e8a76c7bc` |
| `src/rendering/renderer.ts` | `9b7a48b6138290137372cd5981582d920e460fbd146944ae0ccd9c2c9bdd45ef` |

Reproduce the committed regressions from the repository root, without asset-generation hooks:

```sh
npx vitest run tests/motocross-camera.test.ts \
  tests/motocross-camera-ramp.test.ts \
  tests/motocross-camera-motion-ramp.test.ts \
  tests/motocross-camera-flight-origin.test.ts \
  tests/camera-dynamics.test.ts tests/camera.test.ts
npx eslint src/rendering/offroad/chase-camera.ts \
  tests/motocross-camera-flight-origin.test.ts
```

Task-local receipts are in `/workspace/scratch/e91efca799c8/validation/camera-lifecycle-a46/`: the before/after input manifests, original/clock/red/green Vitest JSON and logs, `probe.mjs` with its before/after results, and `natural-trace.mjs` with both natural observation results and the detailed riding-state witness. The scratch probe is supplementary; the lasting natural regression is in the new test file.

All validation processes have ended. Camera and test ownership are returned to the coordinator for final integration and publication.
