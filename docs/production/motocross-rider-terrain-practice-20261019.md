# Motocross rider, terrain and practice integration — 2026-10-19

This pass improves the rider's textile silhouette, outdoor shoulders, tyre contact
response and jump-practice feedback through Three.js geometry, shaders and code.
Selected work from the unpublished draft `b3b60fbb` was recovered into the latest
`main`, retaining the concurrent MotoGP, Festival and engine development. The recovered
files were integrated selectively and checked against the current implementation.

## Continuous garments and helmet

The jersey and trouser waist use separate, shaped textile surfaces. Each sleeve
and pant leg now spans its elbow or knee through a two-bone skin driven by the
existing rider IK. Broad fabric spans, gathered joints and continuous printed
wraps replace the intersecting rigid segments used by the earlier MX rider.
High, mid and far detail retain this construction at decreasing mesh densities.

The helmet has a longer chin profile, reshaped peak, curved goggles and side-strap
outriggers. Its revised height range also drives the shell UV mapping. Existing
textile, equipment and mud materials remain in use; the pass adds no image assets.

The skin uses explicit local bounds around the riding and recovery rig. Rigid
batching excludes these skins, and rider teardown releases their skeleton
resources. First-person sleeves retain the existing grip anchors and restoration
of the exterior arm pose when changing camera.

Code: `src/rendering/rider.ts` and `src/rendering/offroad/motocross-gear.ts`.

## Formed outdoor shoulders

Valley Ridge now combines bent grass, arching fern fans and broadleaf scrub in
shared patches, with bare gaps beside the worked soil. Three instanced plant
meshes share one material. The leaves are opaque geometry with fixed roots and
bounded tip motion; no alpha cards or new texture uploads are introduced.

Placement follows terrain height and slope, rejects clipped inside-turn areas,
and checks the complete plant footprint against riding lanes, padding, mechanics
access and stands. The footprint and culling sphere include maximum wind travel.
One uniform reads absolute simulation time so paused views stay still and reverse
seeks reproduce the same bend. Arena Nord retains its indoor presentation.

Code: `src/rendering/offroad/mx-shoulder-plants.ts`, `mx-course-dressing.ts` and
`src/rendering/offroad/index.ts`.

## Independently sampled tyre contact

Player-controlled MX250/MX450 now derive front and rear contact grip from the soil
under the respective tyre. Front braking and rear drive therefore receive their
own sampled surface capacities when the bike straddles a material transition.
The existing suspension-load and berm-support calibration remains in the mapping.
The rider's lean aid retains its smoothed grip signal over bumps and rut edges.

The wheel-speed pickup after flight uses the corresponding contact's remaining
friction capacity. Drive, braking and cornering demands still reserve grip before
that pickup impulse. AI riders and supermoto retain the calibrated shared mapping,
including when player control is handed over. This is a scoped contact correction
within the existing simulation; still photographs do not establish its force
coefficients, tyre model or calibration.

The integrated solver uses physics **v9**, following the separately published
engine v8 update. Earlier records keep their original category; journal and snapshot formats are unchanged.
Code: `src/simulation/offroad/dirt-bike-vehicle.ts` and the shared bike dynamics.

## A measured learn-and-retry loop

Solo practice keeps a bounded history for each authored downslope target. Each
settled attempt records its observed takeoff speed and signed distance outside
the landing pocket. Every clean point inside the pocket counts equally.
Repeatedly clearing one feature cannot inflate the distinct-target checklist.

The HUD shows **SHORT OF TARGET**, **PAST THE TARGET** or **TARGET LANDED**, with
**CLOSER THIS TIME** when a clean attempt improves the previous best placement.
The next approach recalls that feature's last takeoff speed and placement while
retaining the surveyed advisory speed. A short hard contact receives advice to
reach and match the downslope; caution and immediate riding cues keep priority.

A provisionally clean first contact shows **SETTLING** until the 0.25-second
suspension window completes; rough contacts retain their specific warning. The
HUD retains the worst observed touchdown grade, so a fading bottom-out cannot
turn into a clean landing or a landed-whip reward. A short rebound interrupts the
clean result with **LANDING BOUNCE**. Even a longer unsettled rebound cannot earn
fresh rhythm or whip credit.

Rhythm and whip recognition require an observed eligible human takeoff. Taking
control in midair after autopilot, replay, caution, pit, off-course or retired-rider
travel cannot award credit. Replay review preserves completed targets, per-feature
history and the rhythm session best while interrupting the active run. A new
course, machine/assist combination or backward simulation seek resets the run.

Code: `src/simulation/offroad/landing-challenge.ts`, `rhythm-coach.ts` and
`src/ui/offroad-hud.ts`. The objective uses snapshots and adds no simulation forces.

## Try it and controls

Choose **OUTDOOR MX** or **STADIUM SX**, MX250 or MX450, then **Learn the jumps**.
Valley Ridge has five downslope targets; Arena Nord has four. Ride the approach,
match the landing, let the suspension settle, and compare the same feature on the
next lap. The targets and history remain local to that practice session.

| Default keyboard   | Action                                             |
| ------------------ | -------------------------------------------------- |
| **W / S**          | Throttle / front brake (Sport may assist the rear) |
| **Left Shift**     | Independent rear brake                             |
| **A / D**          | Steer; bank or whip in flight                      |
| **Q / Z**          | Shift rider weight forward / back                  |
| **C / R / Escape** | Change camera / replay / pause                     |

Throttle raises the nose in flight; a brake lowers it. Release a held brake before
touchdown and release steering to square the wheels. Releasing a weight input
returns toward the normal posture. Standard gamepads use the right stick for
weight; touch uses **LEAN FWD** and **LEAN BACK**. Garage remapping remains supported,
and the menu and HUD display the actual assigned keys.

## Reference provenance

This integration reuses the existing [current-source reference audit](motocross-contact-reference-review-20261019.json)
and its [indexed observations](motocross-reference-review-20261019.json). The current-source
audit records **100 downloaded and decoded images**, reviewed on contact sheets,
with **zero SHA-256 matches to the indexed original archive images**. The original
archive was unavailable to that retrieval pass. Those current responses therefore
do not establish original-archive byte parity; older archive claims are not new
verification performed by this integration.

Cloth posture, helmet proportions, planted shoulder layers, contact placement and
readable landing corridors guide the changes. Images provide appearance and riding
context; they do not measure friction, inertia or scoring thresholds.

## Completed scoped development runs

These completed runs cover their named development scopes. They are not a combined
full-game, consumer-GPU, mobile-device or release acceptance result.

| Development scope |           Result | Coverage                                                                     |
| ----------------- | ---------------: | ---------------------------------------------------------------------------- |
| Gameplay          | **52/52 passed** | HUD 24; landing challenge 17; rhythm 11                                      |
| Contact dynamics  | **27/27 passed** | Scoped tyre-contact and pickup regression run                                |
| Scenery           | **15/15 passed** | Scoped environment/foliage run before the final instance-buffer teardown fix |

The gameplay command was `./node_modules/.bin/vitest run tests/motocross-rhythm-coach.test.ts tests/motocross-landing-challenge.test.ts tests/motocross-hud.test.ts --maxWorkers=1 --no-file-parallelism`.
Its final run took 35.85 seconds on stable gameplay files. Formatting and the
gameplay whitespace check passed. Browser specification `e2e/48-motocross-practice.spec.ts`
covers both venues at 390 and 1280 pixels, production text layout, control overlap,
retry feedback, caution priority and AI/replay exclusion; its final outcome belongs below.

## Final integration evidence

The implementation is integrated on engine commit `f476cee649cf1386bce659bf5eeacccb48fa4650`
and uses physics **v9**. The production build's source fingerprint is
`75b4fc0cd2b977e9f1e15d949459505657ea744c6d020ad914d037455306110b`.
An independent read-only hash of all 738 build-identity inputs reproduced that
fingerprint. The build ran on the integrated worktree and correctly records a
null commit label. Documentation and evidence added afterward do not alter those
application inputs.

| Gate                            | Final recorded evidence                                                                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TypeScript and production build | **Passed** with the source-stability guard intact; 719 Vite modules, Vite build 3m 17s. Existing generated LODs had been prepared by the earlier successful prebuild.                |
| Integrated regressions          | **203 passed, one timeout** across 204 tests in 20 files; 424.91s. Garments, GP rig compatibility, soil contacts, practice logic, foliage and instance-buffer teardown are included. |
| New retry-HUD browser case      | **Passed** at 390 and 1280 pixels in both venues, including long-note bounds, control clearance and caution priority. These use production HUD/CSS/fonts with synthetic snapshots.   |
| New foliage browser case        | **Passed**: actual soil and wind shaders, scanned map residency, visible motion, exact held/rewound pixels and stable renderer resources.                                            |
| Broader component browser suite | **Two passed, two timed out**, 17.1 minutes. The bike review and original multi-scenario practice-HUD case retained their five-minute limits.                                        |
| Normal menu-to-track journey    | **Startup-readiness timeout**: the menu stayed hidden during the original 180-second allowance, before quality selection or either motocross venue. No riding checks were reached.   |
| Earlier lint and content checks | **Passed** on the motocross changes before the incoming engine fast-forward; these are not a fresh lint/content claim for that incoming engine code.                                 |

The sole regression timeout is the existing seeded eight-rider stadium-start
case in `tests/motocross-collision.test.ts`: 37,579ms reported against its unchanged
30,000ms limit. No assertion mismatch or unhandled error was reported in the final
regression run. The timeout still prevents a completely passing result.

The bike browser review captured both MX bikes at high/mid/far detail plus
standing, bracing, inside-foot dab and rear-component views before its timeout
during the helmet close-up. The ten completed captures passed their geometry,
contact and draw-budget assertions. The remaining onboard, mud and drivetrain
browser checks were not completed by that run. Shared rig and cockpit regressions
are included in the separate unit results above.

Both browser runs observed **SwiftShader WebGL2**. In the menu journey's final
recorded frame the loader showed **Almost ready / 90%**, with hidden detail
**100% / Scene ready…**, while the menu remained hidden. The trace recorded 170
network resources, no HTTP errors or request failures, and no browser console or
page errors. This bounds the observed startup failure; it does not identify a
motocross defect or establish the cause of the delay. The requested Low setting
was never reached through the visible menu.

### Retained captures and measurements

| Evidence                                                                                                                                                                                                           | What it establishes                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Standing rider](motocross-rider-terrain-practice-20261019/standing-side.png) and [metrics](motocross-rider-terrain-practice-20261019/standing-side-metrics.json)                                                  | Actual production MX450 model, continuous clothing and a reachable standing pose in an isolated inspection scene. It is not a course-contact or gameplay capture.                     |
| [Shoulder plants](motocross-rider-terrain-practice-20261019/shoulder-wind-11.png) and [measurements](motocross-rider-terrain-practice-20261019/shoulder-plants.json)                                               | Actual production terrain strip, dressing and shaders. This fixture omits the outer world ground; the distant stones against the clear background are an inspection-scene limitation. |
| [390px retry HUD](motocross-rider-terrain-practice-20261019/valley-ridge-mx-retry-longest-note-390.png) and [layout measurements](motocross-rider-terrain-practice-20261019/valley-ridge-mx-retry-layout-390.json) | Production text and controls with synthetic retry samples. The 320px panel has zero horizontal overflow; the note's measured one-pixel vertical rounding tolerance is retained.       |
| [Renderer receipt](motocross-rider-terrain-practice-20261019/renderer-receipt.json) and [integration checks](motocross-rider-terrain-practice-20261019/integration-checks.json)                                     | Observed adapter, commands, scopes, identities, outcomes and unchanged timeout limits.                                                                                                |

The unchanged [last startup trace frame](motocross-rider-terrain-practice-20261019/startup-readiness.jpeg)
records where the normal-entry check stopped. It is retained as failure evidence.

The planting consists of 1,575 grass islands, 142 fern fans and 85 scrub instances:
**1,802 plants / 70,370 plant triangles**. The isolated terrain fixture submits 23
draw calls in total with 23 geometries, 18 textures and 14 programs. Those counts
stay fixed across its four wind samples, all with GL error zero. They are scoped
component measurements, not full-game frame-rate claims. No plant image textures
or new runtime dependencies are introduced.

The existing motocross review workflow now includes the retry-HUD and foliage
specifications. Exact final commands and the regression file list are retained in
the integration-checks JSON. Original deadlines, assertions and retry counts were
kept. Raw captures and measurements above are unchanged from their test artifacts.

Close inspection still shows procedural, somewhat angular elbow and shoulder
folds. Photographic parity, a completed menu-to-track play-through and physical
GPU/mobile performance remain unestablished by this pass.
