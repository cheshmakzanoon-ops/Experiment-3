# Road contact, floor support and recorded skid work

## Source and scope

Continuation from published `318a170a32cbd5aad0848e204472ad258785f420` (tree
`a50ca942d8ca4b8fe060a60c08cecd280a6e835c`). Its full build, native scenario,
three browser-shard and playable-publication jobs passed in run `35439434324`.
The original **Pasted markdown(6).md** remains byte-identical at 59,242 bytes,
148 numbered sections, SHA-256
`f508a1b9be8e8a19a2ccc39d744e82d774cf95ecc773c12482efbcb9fb89f75c`.
This work extends sections 6, 8, 10, 13–14, 33, 56, 70, 80–82, 101 and 120;
it is not certification of all qualitative requirements in the directive.

## Functional pass: forces and velocities agree

`RoadContactFrame` projects the steered wheel-forward axis onto the sampled road
plane, then constructs its perpendicular lateral axis. Both contact-point
velocity components and reconstructed tire force use this **same orthonormal
basis**. Up/down suspension travel therefore cannot become lateral tire slip on
a bank. A degenerate tangent has no traction direction rather than an arbitrary
fallback. The force application point is the actual suspension-ray intersection,
not a horizontal point under the wheel hub. Engineering probe points use the
same intersections.

The chassis convention remains +Z nose, +Y up, +X driver's left, with wheel
ordering FR/FL/RR/RL. The existing signed setup camber approximation remains;
this is not an unsprung-mass or full steering-axis multibody solver.

`SkidContact` supplies four unilateral compliant supports over the floor
footprint. Each support casts against the production contact ribbon, resolves
its point velocity against the real surface normal, and adds normal/friction
force **at that point**. A strike near a front or side edge now creates the
corresponding pitch/roll moment. It does not set chassis position or velocity.

The four pads share total spring stiffness 1.1 MN/m and damping 14 kN s/m.
Normal force is `max(0, k * penetration / 4 - c * normalVelocity / 4)`.
Tangential friction opposes sliding with coefficient 0.06. Its stopping-impulse
bound includes inverse mass and world-space rotational inertia; sharing that
bound among the four simultaneous requests avoids friction-induced reversal at
rest. Scratch vectors are owned by each vehicle and reused.

Sliding power is friction force times tangential speed. Normal damping power is
tracked separately. Integrated dissipated work abrades the floor but cannot heal
collision damage already below the abrasion limit. These are original reduced
engineering calibrations, **not measured skid material or manufacturer data**.
Four discrete probes are not a swept, continuously deforming chassis mesh and
do not certify inverted-car or arbitrary obstacle collision handling.

## Engineering pass: state survives recording

Protocol **9** retains all previous per-car offsets and appends 17 skid values
at offset 232. Each car now occupies **249 floats**; header/wheel/debris layouts
are otherwise unchanged. Channels contain support count, normal load, sliding,
damping and spark power, actual hard-contact position/normal/point velocity, and
three cumulative work counters. Existing incompatible private replay pages are
rejected by their version rather than reinterpreted.

The CSV has **228 columns**. All original 211 names and positions are unchanged;
SHA-256 of their comma-joined header is
`3d0fa8ee4003197268344b84889f8fcc85849b5c5d027b830aec8440ffae1f89`.
The original four pickup columns remain at 199–202 and all eight wheel-alignment
columns at 203–210. The 17 skid columns follow at 211–227. Header hashing and
actual production-strike exports are under test. Both replay recorders retain
these skid channels; presentation interpolation never modifies captured values.

Only hard-surface **sliding** work produces sparks. Grass/gravel abrasion and
normal impact damping do not become metallic sparks. A retained real contact
anchor and cumulative work keep a short strike visible even when it occurs
between rendered snapshots. First frames, repeated paused frames, rewinds,
disabled effects and explicit seeks do not manufacture catch-up bursts. Anchors
are not blended from the world origin. Particle velocity follows the recorded
contact tangent and normal, within the existing bounded particle pool.

## Integration repair: pit-approach priority

The first full driving run exposed a rain/wet-compound queue that did not finish
service within the unchanged 420-second gate. The advancing car yielded to a
rear car nearer the pit-entry lane while that follower braked for the leader in
the same three-metre following corridor. Both targets reached zero; subsequent
stationary-hazard flags did not resolve their priority cycle.

`pitApproachTrafficSpeed` now retains the leader's longitudinal priority in that
shared following corridor. Genuinely separate adjacent lanes still use the
existing entry-lane priority. Swept lane-change rejection, real brakes, local
cautions and collision avoidance remain active. No timer releases a car through
traffic, no pose is edited, and no test time/impact threshold is relaxed. The
corrected wet-compound trial completed all ten stops in 209.34 simulated seconds;
the deliberately wrong medium-compound trial completed in 221.56 seconds. Both
reported zero impact. See `wet-pit-results.json` for the exact physics identity. Tests
cover both directions, array order, and the lap seam.

## Verification and presentation pass

The two production regression cases were run against the recovered **unchanged
baseline Vehicle**: both failed (normal heave generated nonzero tire slip; the
raised front strip generated zero additional pitching moment). They pass after
the repair. Additional tests cover front/side support, symmetric force balance,
normal damping, separating contact, bank normals, low-speed energy bounds,
soft-ground exclusion, prior damage, numeric guards, actual exports, both replay
paths and page eviction. Temporal spark tests cover 0.5–144 display updates/s.

The unit suite expands from 460 to **497 tests**, without removing existing
assertions. The former weather emitter oracle now supplies actual recorded skid
work instead of assuming any bottoming power must produce sparks. A new browser
oracle uses controlled initial conditions with production physics, recorded
poses, the actual car mesh and production shaders. It checks rendered spark
pixels, original-frame preservation, pause and replay equivalence. It joins the
full suite; it does not substitute for the existing application browser tests.

Run the focused and full checks:

```sh
npm run check
npx playwright test e2e/03-skid-contact.spec.ts
npm run test:physics
node --experimental-transform-types scripts/rotation-benchmark.ts
node --experimental-transform-types scripts/pit-integration.ts
node --experimental-transform-types scripts/race-classification.ts
node --experimental-transform-types scripts/contact-benchmark.ts
node --experimental-transform-types scripts/acceptance.ts 100 10 73021 clear
```

`contact-benchmark.json` measures actual ten-car CPU simulation and a real
low-clearance initial-condition strike. CPU measurements under concurrent local
verification are **not** representative GPU, 1080p frame-time or hardware input
latency certification. The ten-car local probe measured a 1.123 ms mean and 1.530 ms p95 simulation
step; its scope and runtime are recorded with the raw strike trace. Local
Chromium failed to create WebGL; read the new
oracle and complete browser results from the GitHub run for the published
revision. Generated historical reports retain their own source identities;
a report for an older physics hash is not a pass for this revision.

The single combined human-driven section-146 experience, independent handling
and audiovisual assessment, representative hardware profiling, and full
three-pass certification across every subsystem remain open.

## Completed continuation evidence

The checksum-verified candidate tree `a12e347716a00008a596b21120d8558c5aa75277`
was tested independently in GitHub run `35441759750`: lint, all 497 unit tests,
strict TypeScript, production build, the new rendered skid-contact test, and the
existing wet-weather rendering test passed. Both browser cases passed on their
first attempt without retries or skipped assertions. Runtime changes were then
published as `7e458fd0fcda1065e3ba2fa71e87e668e21a6d0a`; the temporary candidate
workflow was removed. These two selected cases do not substitute for the normal
full browser CI on the final published revision.

A fresh `acceptance.ts 100 10 73021 clear` run completed 100 laps for every car in
7,040.342 simulated seconds: zero impact, zero off-track time under the declared
track-width threshold, no retirement, no invalid numeric state, no exhausted
fuel, no prohibited track/pit stall, and one actual pit stop per car. Minimum
component health was 1.0 throughout. The fixture initializes 113 kg of fuel before
running and uses the production AI in practice mode; it is not a human driving
trial, a rain-endurance result, or representative GPU-performance evidence.
Its full source fingerprint is
`09e7f61e495a3c71d7458096365fde473d4c998b391df08be9e6181d84d19a89`, and its
version-2 simulation fingerprint is
`dbbe435febb71e818df3298c026f896bae0822be939ba0dd18dfb30df504d1b5`.
See `acceptance-10cars-100laps-clear-73021.json` for all per-car measurements.
The refreshed dry pit-service and clear/changeable classification reports are
also for this implementation. The continuous journey's intentional collision
remains distinct from the zero-contact endurance and pit-service trials.
