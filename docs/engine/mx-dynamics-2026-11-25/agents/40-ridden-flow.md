# Assignment 40 — Ridden momentum, unsupported motion and automatic downshifts

Wave 7, 25 November 2026. This assignment investigated the remaining real
player motocross lap and shoulder-jump failures. The retained changes fix
two physical coordinate errors and one automatic gearbox decision error.
No authored terrain, venue, jump target, model, character, material, renderer
or AI controller was changed.

## Retained result and ownership

The unchanged ridden lap and shoulder corridor tests pass. The same driver
now completes two laps of each venue without a fall or a stall longer than
0.183333 seconds. Both previously short shoulder landings satisfy the
original first-contact **CG** interval and survive the whole landing.

The original supported-convergence test also passes at its unchanged
0.1 m/s overall, 0.01 m/s fine-pair and 0.001 m/s normal-speed limits. The
remaining coarse discrepancy was an automatic gear decision, not a reason
to increase integration work or adjust suspension constants.

Owned production changes are limited to these regions of
`src/simulation/offroad/dirt-bike-vehicle.ts`:

- `writeBody()`: re-express stored grounded speed when the sampled terrain
  chord changes, preserving the represented horizontal momentum.
- `stepInterval()`: use horizontal translation while both actual contact
  loads are zero, including the existing launch-recognition debounce.
- `drive()`: request an automatic downshift only when both actual driven
  shaft RPM and rolling road RPM are below the existing downshift point.

Owned regression work comprises
`tests/motocross-ground-frame-transport.test.ts`,
`tests/motocross-automatic-shift.test.ts`, and the two automatic-decision
fixtures in `tests/motocross-coupled-step-contract.test.ts`. Root explicitly
approved adapting those two newly added fixtures to the revised predicate;
they still require one automatic decision per public call. Assignment 42
independently owns the front-flight inertia and thermal changes in the same
adapter and its separate test region.

Baseline adapter SHA256:
`02cc6351d7467833dfa21be74a2fac71ddfbbd64ecc4cd6623809325384d58b4`.

Retained combined adapter, including assignment 42:
`7a72b2747d4469bc652ce965afab4a8f94a7b1606073291c6d36045182b9361e`.

The two-contact force solver remains unchanged at:
`68b04234548a2b037f4769d38343c26ec712a61fd9261fd6dac44641c81ca4e3`.

Machine-readable before/after observations, source hashes, diagnostic
isolations and cadence results are retained in
[40-ridden-flow.json](../evidence/40-ridden-flow.json).

## 1. A terrain sample was changing horizontal momentum

The ridden adapter stores along-ground forward speed while its separate
vertical solver owns heave. Its represented horizontal forward speed is
`dynamics.speed * cos(roadPitch)`. The grounded force solve advanced position
using the incoming terrain chord. `writeBody()` then sampled the chord at
the new position and multiplied the unchanged stored speed by the **new**
cosine. Sampling therefore accelerated or decelerated the machine without
an associated force or impulse.

The ordinary-ground path lacked the same coordinate contract already
implemented at mode handoff and first flight contact. In particular, an
unsupported bike could lose horizontal speed simply because it passed over
a steeper piece of terrain several metres below its wheels.

The negative native FINISH TRIPLE shoulder trace exposed this directly:

| Public tick | Stored speed (m/s) | Sampled pitch (rad) | Represented horizontal speed (m/s) | Front/rear load |
| --- | ---: | ---: | ---: | --- |
| 238 | 13.6040316 | -0.4028168 | 12.5151708 | 0 / 0 N |
| 239 | 13.6314694 | -0.4645764 | 12.1866896 | 0 / 0 N |

The horizontal component lost approximately **0.328481 m/s in one 120 Hz
call** while both contact loads were zero. Stored along-ground speed was
actually increasing. Treating this as inadequate throttle would conceal the
coordinate error.

The fix captures the incoming cosine and scales both `dynamics.speed` and
`mxReferenceSpeed` by `oldCosine / newCosine` immediately after sampling.
The latter is essential: a coordinate change must not look like a harness
speed injection and cause the next call to reseed wheel angular momentum.
The conversion happens before vertical suspension integration; real later
contact impulses remain intact. It is restricted to a live, ridden player
MX ground state. Placement, recognized flight, calibrated AI, supermoto and
other courses retain their existing paths.

The new analytical test moves a prescribed state over a curved height field
and republishes it without advancing time. It checks unchanged world X/Z
velocity, reference horizontal speed, rotor speeds, vertical speed and pitch
rate, for both machines, both assists, three headings and loaded/unloaded
states. Before the fix, even the first heading changed world X velocity by
**1.992439 m/s**. All four parameterized resampling cases failed before and
pass after the correction.

## 2. Launch recognition and physical support are separate facts

The existing launch lifecycle requires three unsupported public calls before
setting `airborne`. That debounce remains unchanged. During those calls,
however, both actual tyre loads can already be zero.

The old ground branch continued to apply along-slope gravity, soil rolling
resistance, extra bulldozing and an over-lean speed debit. It also treated
the free forward component as along-ground speed during frame rotation.
Those are contact effects and coordinate constraints; terrain cannot supply
them through zero support.

The retained branch detects zero actual front and rear loads. The existing
finite-rotor solver then receives horizontal forward speed, unit forward
projection, zero ground grade acceleration and no soil rolling resistance.
It retains quadratic aerodynamic drag using the existing flight
coefficient. Results are converted back into the stored ground convention
until the existing launch event changes that convention. The extra soil and
over-lean speed losses are likewise inactive with zero support. Contact
forces, rotor braking, core aids and lifecycle decisions keep their normal
owners; no velocity setter is used as a gameplay correction.

An independent zero-drag test advances three complete public calls over
changing uphill and downhill profiles. It covers 120, 240 and 480 Hz,
nonzero lateral velocity, zero and signed yaw rates, both machines and both
assists. It requires constant world velocity, linear displacement and
specific planar kinetic energy, exactly zero contact force and soil slip
power, and launch only on the third public call. The original code failed
all four parameterized cases; the first case changed X velocity by
**0.216504 m/s**. The retained eight-test frame/unsupported suite passes.

This is not an assertion that free rotor brake heat vanishes. Physical
braking of a spinning free wheel remains valid and is separately covered
by the lifecycle and assignment 42 energy tests.

## 3. An automatic downshift was triggered by the wrong RPM signal

After the coordinate fixes, the original landing convergence test initially
reported a 0.122783 m/s maximum bottom-speed discrepancy. Tracing the same
airborne checkpoint across six continuation cadences showed a discrete
control difference:

- At 120 Hz, the bike remained in gear 3 through bottoming, with about
  883.57 N of longitudinal tyre force at the peak.
- At 240–3840 Hz, the automatic rider selected gear 2 during wheel pickup,
  interrupting ignition; the corresponding force was about 7.05 N.

The old automatic predicate used low rolling road RPM to demand a
downshift, despite an actual shaft still spinning rapidly. The manual
next-ratio limiter guard rejected the request until the rotor slowed
sufficiently. A brief overlap between the road-RPM request and the
limiter-safe rotor state was sampled at fine cadence and missed at 120 Hz.

Holding gear 3 after the identical checkpoint reduced the maximum numerical
error to **0.013370 m/s**. This isolated the gearbox predicate from spring
integration. No refinement constants were changed.

The automatic rider now requires both `wheelRpm < downshiftRPM` and
`roadRpm < downshiftRPM`. This complements the existing two-signal upshift
rule: a slow chassis does not ask a busy engine to select a lower ratio,
and a locked rotor does not ask a fast chassis to do so. It uses the existing
RPM threshold and creates no timer, queue, latent state or additional
automatic decision. Manual shifts still use the separate next-ratio
protection against both rotor overspeed and rolling regrip overspeed.

The same six-cadence automatic continuation now has **0.013370 m/s** maximum
bottom-speed error and **0.002146 m/s** fine-pair difference. The unchanged
supported-convergence suite passes all 11 cases.

The new eight-case automatic/manual suite failed only its four automatic
spinning-shaft cases before the predicate change; the four manual cases
already passed. All eight pass after it. The two adapted lifecycle cases
start just above the actual automatic shaft threshold, brake through it
inside a refined public call, and require no shift in that call. The next
public call accepts exactly one downshift and one gear-stroke event.

## Native gameplay observations

These runs use the real production course planner with its AI ownership
mark withheld, so the player contact plant performs the simulation.
Airborne ground steering and front-brake requests are released exactly as
in the original tests. No ongoing pose, velocity or force injection is used.

| Two-lap scenario | Baseline elapsed | Retained-policy probe elapsed | Baseline longest stall | Retained longest stall | Falls before / after |
| --- | ---: | ---: | ---: | ---: | --- |
| Valley Ridge | 174.616667 s | 167.391667 s | 0.183333 s | 0.183333 s | 0 / 0 |
| Arena Nord | 167.950000 s | 149.816667 s | 7.041667 s | 0.183333 s | 0 / 0 |

The unchanged native FINISH TRIPLE CG interval is
**468.788219800–473.260704551 m**:

| Plant / shoulder | Baseline first-contact CG | Coordinate-only probe | Coordinate + unsupported fix | Complete retained landing |
| --- | ---: | ---: | ---: | --- |
| AI / negative | 471.650727173 m | unchanged | unchanged | No fall |
| AI / positive | 471.574132142 m | unchanged | unchanged | No fall |
| Ridden / negative | 468.0950479 m | 471.9438135 m | 471.852323623 m | No fall |
| Ridden / positive | 468.3900210 m | 473.3687800 m | 473.259617856 m | No fall |

The two physical fixes were isolated separately. The unsupported correction
has an independent momentum test; it was not introduced to move a target
or relax this landing bound. Adding the automatic predicate leaves all four
corridor results exactly unchanged. Both complete AI result objects,
including their unrounded per-call traces, equal the baseline exactly.

The positive ridden landing has only **0.001086696 m** of margin below the
upper bound. This is an explicit limitation, not evidence of wide-cadence
or arbitrary-input corridor robustness. The original 120 Hz regression is
retained unchanged and passes. Assignment 42 separately reruns the final
combined production flow suite after its disjoint flight-inertia correction.

### Controller experiments rejected before production changes

Skipping the shared AI wheelspin feather reduced the longest Arena stall
but introduced a Valley grip lowside and an Arena flat crash. Enabling the
existing SX heading guard for the ridden plant introduced an Arena front
crash. Both were runtime-only diagnostic variants and were discarded.
Neither AI source file was edited. The long stall was a later consequence
of the changed ridden trajectory and a barrier entry, not sufficient proof
that a blanket throttle floor was the correct repair.

## Numerical convergence is distinct from gameplay acceptance

A separate matrix generates each real 120 Hz approach with the retained
runtime, then varies only post-checkpoint continuation from 120 through
3840 Hz. The benchmark retains its held airborne controls. It is not the
full-lap feedback driver above.

| Machine / jump | Pre-40 maximum bottom-speed error | Retained maximum error | Retained 1920→3840 error | Retained outcome at every cadence |
| --- | ---: | ---: | ---: | --- |
| MX250 / Valley RIDGE TABLE | 0.017823 m/s | 0.012018 m/s | 0.002611 m/s | Bottomed, no fall |
| MX250 / Arena TABLETOP | 0.034551 m/s | 0.012192 m/s | 0.001369 m/s | Bottomed, no fall |
| MX450 / Valley RIDGE TABLE | 0.016985 m/s | 0.037160 m/s | 0.000762 m/s | Crash-flat |
| MX450 / Arena TABLETOP | 0.014853 m/s | 0.013587 m/s | 0.002189 m/s | Bottomed, no fall |

The MX450 Valley held-control trajectory is now adverse at **every** tested
cadence, whereas the pre-40 trajectory was bottomed. Its measured bottoming
speed crosses the unchanged **7.0 m/s** limit:

| Continuation cadence | Measured bottoming speed | Verdict |
| --- | ---: | --- |
| 120 Hz | 7.100861666 m/s | Crash-flat |
| 240 Hz | 7.077238253 m/s | Crash-flat |
| 480 Hz | 7.076879703 m/s | Crash-flat |
| 960 Hz | 7.056597585 m/s | Crash-flat |
| 1920 Hz | 7.062938778 m/s | Crash-flat |
| 3840 Hz | 7.063701271 m/s | Crash-flat |

This is a converged severity change in a particular held-control path,
not a cadence-specific false crash. It remains recorded for independent
physics review. No target, input sequence, crash threshold or existing
gameplay gate was changed to remove it. The separate two-lap and original
shoulder-survival gates pass with their normal feedback controls.

## Validation and explicit handoff

On combined adapter `7a72b274`, **114 focused tests pass across nine files**:

- Ground-frame transport 8, automatic/manual shifts 8, original supported
  convergence 11, and coupled lifecycle/work contracts 24: **51/51**.
- Original planar transport 16, contact consistency 20, per-contact work
  isolation 6, roost/contact presentation 15, and interrupted-shift contact
  clearance 6: **63/63**.

Focused ESLint and a 512 MB strict TypeScript dependency-graph check of the
adapter and two new test files pass. The temporary compiler configuration
is under ignored `test-results/`; compiler policy and dependencies are
unchanged. All commands used installed tools directly, with no npm
lifecycle hooks, package installation, child agents or git mutations.

Before the gearbox integration, the direct production run already passed
the unchanged forgiving handling **18/18**, jump corridor **14/14**, coupled
lifecycle **24/24**, and thermal **3/3**. Player acceptance was **19/20**:
MX250 Raw Arena front-lock changed from `crash-front` to `crash-flat` while
remaining adverse. Assignment 42 independently reviews that severity and
owns the final combined flow, energy, wet-player and non-MX preservation
reruns; its report supplies the final results rather than attributing those
checks to this assignment.

Two unchanged older momentum suites also needed independent observer review.
An exact pre-40 adapter loaded through a read-only Vite hook already failed
**8 native-departure and 2 public-touchdown assertions**. They compare an
inner transition state with the final public endpoint despite later actual
flight or supported intervals. With the corrected approach, 14 departure
variants select this multi-interval path; the same two touchdown assertions
still fail. Their isolated transition, plane, handoff and direct momentum
checks pass. Both files were left unchanged for assignment 43:

- `tests/motocross-slope-momentum.test.ts`: public takeoff case, event capture
  before `vertical()` versus outer endpoint velocity, rotors and gravity.
- `tests/motocross-landing-momentum.test.ts`: t=0 touchdown case expecting
  unchanged initial momentum and rotor speed after later supported intervals.

The pre-40 failure counts and causal evidence are retained in the JSON;
this report does not claim those observer suites passed before their
independent migration. Existing strict physics and gameplay tolerances were
not weakened. The runtime is released at the frozen combined identity above.
