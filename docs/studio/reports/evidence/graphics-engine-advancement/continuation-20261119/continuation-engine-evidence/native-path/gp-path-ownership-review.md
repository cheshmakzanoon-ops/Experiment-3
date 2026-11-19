# Independent GP path ownership review

This is a causal and native-controller review, not an acceptance receipt for a race candidate. The selected-path composition failed the original mixed pace test; the subsequent relative-intent composition still needs its original race gates.

## Two distinct ownership defects

### A moving selected lane needs a moving reference course

For road-normal offset `d(s,t)`, centreline curvature `k`, physical ground speed `U`, and course `theta` relative to the centreline, remaining on the path requires

`U sin(theta) - [d_s / (1 - k d)] U cos(theta) = d_t`.

For the forward, feasible branch, write `q = d_s / (1 - k d)`. The reference course is

`theta = atan(q) + asin(d_t / (U sqrt(1 + q²)))`.

The temporal rate must use the realized selected target at one fixed station, with both previous and current raw lane values subjected to the same current width and local road clamp. Differences of published preview offsets at different stations would count ordinary travel along the authored path as lateral lane motion. Physical ground speed is `hypot(forwardSpeed, lateralSpeed)` because the controller tracks course including sideslip.

The independent oracle prescribes world velocity directly on `x(s,t) = a(s-s0) + u*t`, `z(s,t) = s`; it does not generate the expected course from the production inverse expression. At exact path position and velocity, the old controller produces about ±3.35–3.46 m/s² of false correction for `u = ±1.6 m/s` and slopes `a = 0, ±.25`. The selected-path consumer reduces this to less than 7e-14 m/s². At zero slope, the old false demand implies a steady tracking lag of about 2.4 m at the unchanged bandwidth and damping.

A second coordinate issue is that a clipped preview point does not determine the raw selected lane at another station. In the analytic test, the current selected point is 3 m, its preview clips to the existing 5.6 m road limit, and the old reconstruction falsely targets 1.52 m at the current station. Sharing the raw selected path preserves both points and removes the false −2.1312 m/s² correction.

At the supplied actual Montejaral onset, the existing spatial stencil has a stationary residual near −.7002 m/s² against an independently differentiated world path. The moving-reference correction removes the additional error: the +1.6 m/s case changes from −4.1543 to −.7026 m/s². This is evidence for the temporal term, not a claim that the authored spatial curvature or tangent reconstruction is exact. No feedforward-curvature stencil change was proposed by this review.

Evidence:

- `gp-moving-path-oracle.mjs`
- `gp-moving-path-oracle-before.json` — `gp-final-physics-candidate`
- `gp-moving-path-oracle-after.json` — `gp-selected-path-candidate`
- `gp-moving-path.test.ts` — seven native cases, including 120/240 Hz, realized edge-clamped motion, station-advance control, and sideslip representation
- `gp-moving-path-review/receipt.json` and `vitest.log` — 7/7, five relevant source hashes stable

### Traffic intent was sampled in one frame and retained in another

TrafficPlanner explicitly holds lane commitment relative to the authored line: `heldOffset = bestOffset - lineOffset`, and its future corridor uses the line's shift with station. AIDriver, however, retained the sampled absolute result as `desiredOffset` and at every 120 Hz update recomputed `desiredOffset - lineHere`. While the roughly 12 Hz traffic result was held, movement along an unchanged authored line therefore changed the requested tactical lane.

This does not require traffic, a pass, a fall, or a vehicle integration error. The independent generator oracle runs the complete native BikeAIDriver and TrafficPlanner with one rider prescribed exactly on a stationary straight diagonal world path. Over 120 updates, every decision is RACING LINE and there are ten native traffic samples:

| Authored slope | Old maximum invented tactical offset | Old maximum lane rate | Old rate sign reversals after the initial 20 updates | Old maximum false correction |
| --- | ---: | ---: | ---: | ---: |
| 0 | 0 m | 0 m/s | 0 | 0 m/s² |
| +.01 | .025 m | 1.6 m/s | 18 | 3.44427 m/s² |
| −.01 | .025 m | 1.6 m/s | 18 | 3.44427 m/s² |
| +.04 | .100 m | 1.6 m/s | 18 | 3.40207 m/s² |

The relative-intent candidate caches the road-relative goal at the evaluation station, after the existing lane override. All four cases then have exactly zero selected lane displacement, zero temporal lane rate, zero reversals, and less than 4e-14 m/s² correction. The exact three-case native regression passes on that candidate, while the old source passes its flat control and fails both mirrored slopes on the invented .025 m lane displacement.

The full selected-path race composition nevertheless failed before this generator correction. Local zero-error controller tests cannot establish closed-loop race acceptance. The observed first-fall trace is consistent with the upstream defect: it records many ±1.6 m/s selected-lane reversals while the decision remains RACING LINE and no blocker is selected.

Evidence:

- `gp-held-lane-oracle.mjs`
- `gp-held-lane-oracle-before.json` — `gp-selected-path-candidate`
- `gp-held-lane-oracle-after.json` — `gp-relative-intent-candidate`
- `gp-relative-intent.test.ts` — three full-native-update cases; asserts multiple tactical samples and held frames, without planner/controller mocks
- `gp-relative-intent-positive/receipt.json` and `vitest.log` — 3/3
- `gp-relative-intent-negative/receipt.json` and `vitest.log` — flat control passes; mirrored cases fail as intended

## Semantic review and limits

The bypass branch folds launch residual into tactical position before the new snapshot is captured. The relative goal is used consistently by both normal slew and the existing walking-speed bypass branch. Placement and handback rebase the current pose into launch displacement, so stale pose differences are not interpreted as reference velocity. The GP-specific opt-in preserves other vehicle families' existing lane semantics.

Pit/preparing branches retain absolute targets. Review identified a transition issue if an absolute preparing-pit result overwrote the cached road-relative goal and the request was then canceled before another traffic sample. The owner subsequently restricted relative-goal capture to ordinary road evaluations (`!preparingPit`); graphics owns its explicit transition regression. The positive three-case receipt predates that final restriction and is attributed to the hashes below. The owner is responsible for the final combined source guard and gates.

Positive native generator receipt: `ai.ts` SHA-256 `fb4c8a0929c43bf321f2af8a34d074589b1baf1d039c7a9bb5deb65f40b64995`, `bike-ai.ts` `da0508e3168914a2fdb402449ee23d438ea185465e17f3b894bc69fb38ef12b3`.

Negative native receipt: `ai.ts` `bf16ecc197eefcc687361b2f17baddd019a91e3a393246956f7cdd9dd4bce9d2`, `bike-ai.ts` `4db100553ec4ce1efc30647a82e2c10ae6da74b4aead8e5f158cad53ec9b2bd4`.

Both retain history-only `bike.ts` `8aaa0ede0ff7cd94ee627dee0f9ecebefdef5a83904490677dfd2c13135225de` and `motogp-physics.ts` `2a3bac376e45e7de10fdb06674cf4fbf145bbafc8058d62af7e0472d5881e22a`. No force, grip, gain, collision threshold, acceptance assertion, or race integration was changed by these review probes.
