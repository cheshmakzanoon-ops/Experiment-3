# Solvane / Horizon R4 — road surfaces and repeatable activities

This pass improves the existing Three.js festival with more coherent road lighting, weather-responsive car finishes, live activity goals and a reliable retry loop. It also fixes two gameplay defects found during actual driving and event-lifecycle checks: the initial departure occupied the oncoming lane, and leaving a finished race could issue an abandoned result for the same run.

## What the player sees

| Area | Result |
| --- | --- |
| Banked and climbing roads | Asphalt, markings and shoulders light according to the crown, bank and grade of the existing driving surface. |
| Asphalt construction | Sparse resurfacing patches, narrow seals, edge deposits and restrained wheel-path polish use metre-scaled detail and the existing photographic aggregate. |
| Rain and dirt on cars | Rain and loaded tyre contacts affect the followed road car's paint and glass. Lower panels and wheel wakes carry a restrained dirty film; sparse close-range beads and runoff retain cabin visibility. |
| Speed and drift activities | The event panel shows provisional stars, the next target and remaining measured distance. Average-speed zones also show the average needed from the current point. |
| Kestrel's first milestone | The introductory drift zone awards its first star at 50 points. Its higher targets remain 300 and 600. |
| Another attempt | Race results offer **TRY AGAIN**. The last completed passive activity remains available for retry in the pause menu. |
| Departing the harbour | The east-facing car starts in the eastbound lane, so an oncoming traffic car no longer blocks a straight launch after an idle start. |

## Rendering implementation and cost

`festival-road-surface.ts` computes an upward differential frame from the same sampled road height used to build the existing ribbons. This covers asphalt, dirt, paint, runway markings and shoulders, including changing banks. The complete road network retains identical position and index bytes: **124 chunks, 439,160 triangles, 240 lamps and 774 guardrail posts**. Lane/edge metadata adds **3,246,752 bytes across 202,922 vertices**, with no new geometry batches or triangles.

The asphalt shader uses real lane widths, fades wear at junction mouths, and omits wheel-path polish on runways. Sparse repair cells skip their detailed calculations when absent. The existing wet material response remains connected; the standing-water component is reduced on sloped or banked surfaces. Pixel-footprint filtering limits unresolved surface noise.

`festival-car-finish.ts` owns at most three cloned material roles on the followed closed road car: paint, accent and glass. It retains the original paint, reflection and glazing shader hooks. Rain is read in mm/hour; loaded tyre water is read in mm; tyre dirt is recorded coverage. Signed chassis-relative velocity orients the runoff. The controller reconstructs presentation from the supplied snapshot and does not accumulate a second weather simulation.

The car finish adds no draws, triangles or texture assets. Fine water relief is disabled at Low quality and fades with distance and pixel footprint. Binding a replacement closed body restores the previous material slots and disposes its owned clones. Other vehicle representations leave the previous finish inactive until rebinding or session cleanup. Shared source materials and borrowed textures retain their existing ownership.

## Activity and retry behavior

`FestivalActivityProgress` reports the current metric, provisional stars, next threshold, margin and remaining legal distance. Rolling entry offsets and the braking run-out are excluded consistently, so a completed activity reaches 100% and its displayed average agrees with the final result. The live display can lose provisional progress after an invalid slide or route departure. Actual forward velocity through the entry gate is required; facing the route while reversing no longer starts a skill activity.

The Kestrel calibration is backed by [a retained physical driving trial](horizon-drift-validation.json) and [its reproducer](../../scripts/horizon-drift-validation.ts). With RD2 and Raw assist, normal scripted controls produce **69 points in 46.4 seconds**, with zero off-road time, contact samples or recovery replacements. This is externally scripted assistance, explicitly labeled in the report. It demonstrates the introductory milestone; it does not establish human usability or attainment of the two mastery targets.

Retry holds the worker and driving input, removes stale result actions, waits for the worker to acknowledge travel, streams the destination, and waits for the new event-start acknowledgment before resuming. Failed acknowledgment or terrain readiness returns to a usable paused menu. The guard remains active across the asynchronous handoff. Closing a session clears outstanding command timers.

Finalized results are immutable across retry, cancel and garage actions. Active abandonment emits one result before travel clears the old event and rivals. Distinct attempts use distinct `runId` values, which also identify the results DOM. Focused result buttons own their native Enter/Space activation. Escape and the controller's mapped pause action remain available while results own driving input.

## The original 100 references

[HORIZON_R4_REFERENCE_REVIEW.json](HORIZON_R4_REFERENCE_REVIEW.json) records exactly 100 individual visual reviews, source URLs, verified compressed-review SHA256 values, observations, application decisions and remaining work. The recovered compressed files were all rehashed. Original full-resolution hashes are retained as provenance only; those original bytes were not downloaded and verified again in this pass.

| R4 disposition | Images |
| --- | ---: |
| Partial technique transfer | 27 |
| Existing presentation preserved by the reference study | 14 |
| Reviewed without a new R4 implementation | 53 |
| Promotional material excluded from runtime | 6 |

The ledger distinguishes review from implementation. It does not claim that 100 photographed requirements, vehicles or scenes were rebuilt, or that this pass achieves commercial-game photorealism. The runtime additions are original code; the reference pack is not copied into the repository.

## Verification evidence

[horizon-r4-validation.json](horizon-r4-validation.json) records the repository gates, observed browser behavior, source identity and rendering limits. Rendering comparisons use actual production geometry and compiled WebGL materials with a verified SwiftShader adapter. Isolated car snapshots are explicitly synthetic; road comparison cameras and geometry are held constant. These checks are not hardware frame-rate measurements.

The driving evidence includes a real traffic-enabled idle/departure regression, a real browser launch/brake journey, an assisted race completion, and physical repeated-event/result tests. Keyboard/controller DOM checks are kept distinct from worker/physics checks. Screenshot failures and any incomplete browser phase are recorded explicitly rather than counted as a completed journey.

### Final gate outcomes

| Check | Observed result |
| --- | --- |
| Repository lint and content validation | Passed. The two final Horizon startup ownership lines also passed a scoped lint run. |
| Unit tests | 3,649 passed in the full 3,654-case sweep. Its five failures were missing local Blender source fixtures; after restoring the original tracked files, the exact five checks passed. All 3,654 unique cases are accounted for, with no unresolved failure. |
| Production build | TypeScript checking and Vite build passed. Vite retains its large-chunk warning. |
| Keyboard/controller and activity DOM checks | All nine passed. |
| Desktop/phone HUD layouts | Six samples passed overlap/clipping checks and final visual inspection. |
| Real retry lifecycle | Keyboard retry, an explicitly synthetic duplicate UI activation, distinct result identities, Continue and exit/disposal passed in the real session. Both attempts were deliberately abandoned; the separate longer journey supplies the observed assisted race completion. |
| Combined Medium scene | The current EH3 night/rain scene rendered ten full-scene frames and a final image with no page, shader, asset or fallback warnings/errors. |

The component reruns resolve the recorded initial failures; this is not presented as a single clean `npm run check` invocation. The combined scene is a paused software-GPU inspection. It verifies the stated visual integration without establishing hardware performance or commercial-reference fidelity.

### Concurrent main-branch integration

Publication preserves the newer MotoGP commit `31bc93d`. Its 44 changed files do not overlap the 30 Horizon files in this pass. The GP suit, lever and seamless-braking changes also serve Horizon motorcycles, so the combined branch was rebuilt and all **34 targeted motorcycle checks passed**. A real **EH3 → GPR1 → EH3 → exit** garage smoke also passed, including recorded keyboard brake values **0 → 1 → 0**, actual scene captures, and resource cleanup, with no page/shader errors, failed assets, GL errors or warnings.

The original 3,654-case sweep predates that upstream commit. Its source identity remains recorded separately from the combined build, targeted checks and garage smoke; a second full-suite run is not claimed.
