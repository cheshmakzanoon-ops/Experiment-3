# Engine dynamics and presentation — simulation v8

This change improves the existing vehicle model and its recorded-motion presentation. It corrects
three measurable errors while retaining the existing calibrated force laws and 240 Hz vehicle
substeps. It does not claim manufacturer-validated vehicle dynamics or complete physical realism.

## Changes

### Coupled suspension force balance

The previous solver performed two ordered left/right Gauss–Seidel sweeps. A stiff anti-roll bar could
leave the two corners with different force-balance errors, so a mirrored kerb strike produced
different loads. `HubSolver` now solves each axle's two hub travels together with an analytic 2×2
Newton step. Tyre compression is unilateral throughout the solve, and an active set enforces the
mechanical droop stops. A convex-work line search handles spring progression, bump stops, digressive
damping and changes in tyre contact. The solve uses reusable storage and a bounded iteration budget;
failure to converge is reported rather than silently accepting an imbalanced axle.

The model still uses **massless hubs**. This change does not introduce unsprung-mass inertia or wheel
hop. Setup spring and bar values retain their existing meaning as ride rates at the contact patch.

### Consistent wheel contact and suspension link forces

`RoadContactFrame` constructs the world wheel axle using the same steering/camber rotation convention
as the rendered wheel and wheel angular momentum. Its forward tangent is the intersection of the
wheel plane and road plane. Its inclination is derived from that axle and the road normal. The same
orthonormal frame resolves contact velocity and reconstructs tyre force, including on banked or
sloped surfaces. A wheel whose axle is normal to the road has no unique rolling tangent and supplies
no tread traction.

`Vehicle` also resolves the applied tread force onto chassis longitudinal/lateral axes before
computing roll-centre and anti-dive/anti-squat transfer. Steering therefore routes braking and
cornering forces through the correct suspension link directions. This projection includes the
rolling and ground drag already included in the applied force.

### Angular-velocity-aware presentation

Coherent snapshot pairs now use a spherical cubic quaternion curve with endpoint controls derived
from recorded **world angular velocity**. This reconstructs accelerating, slowing and changing-axis
rotation with the measured endpoint rates. The shared pose serves chassis roots, cameras, effects
and motorcycle presentation consumers. Evaluation depends only on the recorded pair and requested
time, so repeated paused frames and out-of-order replay seeks remain deterministic.

Exact snapshot endpoints remain exact. Contact or rider-state transitions, newly recorded impacts,
inconsistent/invalid angular rates, gaps above 0.5 seconds and ambiguous fast turns retain the
previous shortest-arc SLERP behavior. The guard also handles the existing GP bike telemetry's
approximate angular velocity when pitch or road-crown motion makes it inconsistent with the pose.
This change does not replace that telemetry with a new bike dynamics model.

## Controlled measurements

These are fixture-specific numerical improvements, not percentages of overall game realism.

| Measurement | Previous implementation | Simulation v8 / new presentation |
|---|---:|---:|
| Stiff-bar mirrored kerb: left/right mirrored load discrepancy | 3.30867 N | 0 N in the fixture |
| Same kerb: maximum unconstrained hub force residual | 18.76917 N | 9.084 × 10⁻⁷ N |
| Combined steer/camber/pitch/bank: rolling tangent direction error | 1.860719° | Axle and road-normal orthogonality within floating-point precision |
| Accelerating rigid-body rotation: maximum error between 15 Hz snapshots against 240 Hz solver samples | 0.763936324° | 0.0000109336° |

The suspension fixture uses a legal 55,000 N/m front ride anti-roll bar, a 330,000 N/m tyre, 350 Ns/m
radial damping, 0.03 m settled compression, a 0.085 m single-corner compression with 4 m/s contact
rate, and a 1/240 s timestep. `tests/suspension-coupling.test.ts` retains the mirrored and independent
force-balance oracles, including the undamped static solve and droop/contact transitions.

The contact fixture uses 0.32 rad steer, 0.08 rad camber, 0.12 rad chassis pitch and road normal
`normalize(-0.25, 1, 0.09)`. The old inclination was 18.565623°; the axle-derived inclination is
17.273216°. `tests/road-contact.test.ts` includes independent no-slip tread kinematics, mirrored
force/work checks and a production-car banked-turn check. `tests/suspension-link-forces.test.ts`
independently checks chassis-frame transfer for positive and negative steering.

The rotation fixture uses the production `RigidBody` at 240 Hz, a spherical inertia, an initial
angular speed of 0.8 rad/s and angular acceleration of 24 rad/s². Presentation is reconstructed from
15 Hz snapshots. A separate analytic fixture checks continuity across adjacent intervals, where
the previous interpolation introduced a 1.6 rad/s angular-rate step. Both are retained in
`tests/rotation-interpolation.test.ts` along with resets, impacts, invalid data and quaternion-sign
cases.

An isolated warm suspension microbenchmark (five runs of 30,000 four-corner steps) measured about
1.97 µs per old solve and 4.78 µs per new solve on this host: approximately 2.8 µs additional cost per
vehicle substep. This is the measured cost of the more accurate axle solve, not an overall frame
rate result. Separate bounded convergence probes covered 4,000 legal varied states at 30/60/240 Hz
and 5,000 seeded varied states at 240 Hz without a convergence failure.

## Existing vehicle targets

The unchanged strict calibration script passed all four targets for six representative cars at
both 240 Hz and 120 Hz: **48 band checks**. Each cell below gives 240 Hz / 120 Hz; the script's
largest printed timestep drift was **0.1%**, rounded to one decimal place.

| Vehicle | 0–100 km/h (s) | Top speed (km/h) | 100–0 km/h (m) | Lateral acceleration at 80 km/h (g) |
|---|---:|---:|---:|---:|
| APX-01 | 2.56 / 2.56 | 320.55 / 320.53 | 19.19 / 19.20 | 1.94 / 1.94 |
| TC-1 | 4.95 / 4.94 | 232.25 / 232.26 | 28.10 / 28.10 | 1.33 / 1.33 |
| DX-8 | 5.38 / 5.38 | 210.56 / 210.58 | 39.28 / 39.28 | 0.93 / 0.93 |
| SC-7 | 3.23 / 3.23 | 331.40 / 331.38 | 28.96 / 28.96 | 1.16 / 1.16 |
| GT-6R | 3.53 / 3.52 | 290.65 / 290.66 | 24.47 / 24.47 | 1.33 / 1.33 |
| RH-3 | 5.22 / 5.22 | 259.63 / 259.64 | 33.25 / 33.25 | 1.10 / 1.10 |

The original calibration command was
`node --experimental-transform-types scripts/vehicle-calibration.ts --strict --only=apx01,tc1,rh3,sc7,dx8,gt6r`.
Its execution connection ended after four complete passing vehicles; the unfinished `rh3,gt6r`
subset was resumed with the same flags and exited successfully. No targets or rate tolerances
were changed. These are the repository's design bands, not independent real-car validation.

The unchanged `scripts/dynamics-benchmark.ts` also passed **11/11** production-solver scenarios:
100/200/300 km/h braking and their stopping-distance order; 15/25/35 m/s skidpads; repeated slalom
and recovery; and low, high and sausage kerbs.

## Verification receipt

All **228 distinct test cases across 19 files** passed in four sequential invocations of
Vitest 3.2.4 before the final Festival integration, each with exit 0 and no unhandled errors.
The original `maxWorkers: 1` and 120-second
per-test limit were retained. The executed file-and-test-name union was checked against the full
selection: no duplicate or omitted cases.

| Verification | Result |
|---|---|
| Dynamics, collision, contact and rollover; excluding six render-rate cases | 54 passing cases; exit 0 |
| Six complementary 24/30/60/90/120/144 FPS independence cases | 6 passing cases; exit 0 |
| Suspension, road contact, tyres, wheel momentum and physics identity | 71 passing cases; exit 0 |
| Animation, presentation, snapshots, replay and wheel pose | 97 passing cases; exit 0 |
| Production build under `scripts/source-stability.ts` | TypeScript and Vite passed before and after Festival integration; both exit 0; no source rewrite |
| Targeted ESLint, Prettier check and `git diff --check` | Passed |
| Original wheel-fidelity and GPU-motion browser cases | 2/2 passed; exit 0 |

The earlier monolithic invocations and unsplit dynamics group passed their assertions but exited
1 with `[vitest-worker]: Timeout calling "onTaskUpdate"`. Those attempts are **not** clean gates.
The installed runner has a separate 60-second RPC acknowledgement deadline; its task-update calls
can remain pending while synchronous tests run through chained microtasks. The full physics file
took 91.6 seconds in the five-file scope; the two complementary selections took 25.1 and 41.8
seconds. This supports delayed IPC acknowledgement, although the failing update's task ID and
timeline were not retained. Splitting test selection supplied clean process evidence without
altering assertions or either timeout. This is scoped verification, not a claimed monolithic
full-repository test pass.

The original graphics tests ran with one worker, their original assertions/deadlines and the
configured 1440×900 viewport, using Chromium 1193 with verified ANGLE/Vulkan SwiftShader. They
checked recorded steering/camber at every wheel LOD, undeformed rigid parts, load/puncture pixel
changes, stable geometry resources, actual motion vectors and the co-moving cockpit. These are
software-rendered correctness checks; physical-hardware frame pacing was not measured.

The original full application smoke test **failed** at its initial `#menu` visibility assertion:
the menu remained hidden past the unchanged 60-second startup deadline. The retained error snapshot
shows "Loading circuit" at 24%. Driving, live camera/mirror and pause/resume assertions were not
reached. This is an open application-startup acceptance result on the SwiftShader host, not a
passing gameplay check or a demonstrated causal regression from the engine changes. The repository
also retains earlier, separately scoped menu-entry failures in
[the MotoGP review](motogp-corner-drive/README.md#verification-status); those occurred at different
stages and are not substituted for this result. No menu bypass, workload reduction or relaxed
deadline was used to manufacture a pass.

The initial production source fingerprint was
`9eff75add15dbe21eff86567e80a26983705dfbf81461779d9d46b1285f18373`.
That build reports a null commit because it was built before publication from the edited worktree;
the fingerprint identifies its application inputs. The initial 228-case unit source fingerprint is
`f0198209e4c6c81f96a69db7d56db9a5546fa4f16c232a9c352b1390ac6ad09e`,
covering `src`, `tests`, Vitest/TypeScript configuration, `package.json` and the lockfile. It stayed
identical before and after every clean invocation.

Publication preserves the concurrent diagnostics/docs commit `54b240a` and its typing fix `5235c24`.
The new menu timing
fixture failed CI at `HTMLCanvasElement.getContext`: extracting `Parameters`/`ReturnType` selected
the final WebGPU overload instead of representing all native contexts. An independently prepared
correction forwarded every original argument and narrowed the native result from `unknown`.
Targeted strict TypeScript with `@webgpu/types` reproduced both original errors (TS2367/TS2352)
and passed after correction; lint and formatting also passed. Transpiling the original and
corrected versions without comments produced byte-for-byte identical JavaScript. When the
equivalent upstream fix arrived during publication, its version was retained. The retained
upstream version also passed that strict check and JavaScript equivalence comparison. These two
commits leave production application inputs and the initial build fingerprint unchanged.

### Final Festival integration

During publication, `main` also advanced to the independent Festival update `e4d07ad`. Its rendering
and racecraft changes were fast-forwarded without overlapping or replacing any engine edits.
Racecraft observes actual post-contact motion and tyre loads; its shared wake fields are computed
before advancing the participating vehicles. The glazing changes run during body construction and
retain the existing shared chassis and wheel presentation interfaces. No engine correction was
needed for this integration.

The combined version passed another complete production build under `scripts/source-stability.ts`:
TypeScript and Vite exited 0, 718 modules were transformed, and the guard found no rewritten inputs.
Vite retained its large-chunk warnings. The final built application fingerprint is
`ec5b016c7c596b7128360f3b1729582a3770b0159940e68aee917e7766217c84`,
independently matched against the current 737 production input files. Its commit field is also null
because this build preceded publication.

Two additional original test invocations passed against the combined version, each with exit 0,
no unhandled errors and unchanged configuration, assertions and deadlines:

| Final integration coverage | Passing cases |
|---|---:|
| Festival car racecraft, including a complete pass through steering, pedals, aero, tyres and contact | 24 |
| Festival motorcycle wake integration | 1 |
| Shared wheel pose | 14 |
| Festival glazing geometry and material integration | 3 |

These are **42 passing integration case executions**. The 14 wheel-pose cases repeat part of the
earlier 228-case selection and are not counted as additional distinct tests. The earlier calibration,
browser and 228-case receipts retain their original input identities; the fresh production build
and these two test invocations are the checks after Festival integration. The full-application
startup result above remains an open acceptance item.

## Compatibility and scope

`SIMULATION_VERSION` advances from **7 to 8** because wheel loads and forces can change lap results.
Earlier records retain their original physics category. The snapshot wire protocol remains **13**;
the new interpolation uses angular velocity already present in the snapshots. No dependency,
content asset, CI threshold or presentation-only simulation force was added.

This is a numerical and geometric upgrade to the existing calibrated model. Hardware frame pacing,
force-feedback device validation, measured tyre datasets, unsprung-mass dynamics and full-catalogue
certification remain outside these results.
