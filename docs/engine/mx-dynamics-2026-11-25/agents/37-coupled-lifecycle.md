# Assignment 37 — Coupled-step lifecycle, publication and work contracts

Wave 7; 25 November 2026. Independent review of assignment 33's bounded
complete motocross intervals, building on the recording audit in report 36.

## Result and ownership

The released adapter has **58 distinct focused tests passing across four
files**, including the 24 new lifecycle/publication cases, the 20 complete
player acceptance cases, ten real-input dynamics replays and four natural
crash/recovery replays. The unchanged non-MX preservation runner passes all
five saved cases with zero snapshot mismatches. Eight additional legacy MX-AI
comparisons reproduce **8,648 unrounded state samples exactly** against the
pre-coupled adapter.

This report applies to adapter SHA256
`02cc6351d7467833dfa21be74a2fac71ddfbbd64ecc4cd6623809325384d58b4`.
Assignment 40's subsequent coordinate investigation was still separate when
this review was released; its retained production changes require a new
focused integration gate.

Owned changes:

- A narrow publication block in the public `DirtBikeVehicle.step()` wrapper:
  time means for tyre `fx`, `fy`, slip-power `energy`, and `gLong`.
- `tests/motocross-coupled-step-contract.test.ts`, 24 cases.
- Diagnostic-only interval and swept-contact observation in
  `scripts/bench/motocross-player-dynamics.ts`.
- The exact locked-front-rotor assertion and subsequent tyre-impulse proof
  in `tests/motocross-player-dynamics.test.ts`. Assignment 38 owns the
  separately justified landing-verdict expectations in that file.
- This report and `evidence/37-coupled-lifecycle.json`.

Assignment 33 owns the solver and the production decision-boundary fixes
described below. Changes were coordinated before touching the shared adapter.
No model, character, mesh, material, asset, authored environment, venue,
vehicle definition, production renderer, presentation layout or protocol was
changed by this assignment. No children, git mutations, dependency install,
npm lifecycle hooks or whole-repository typechecks were used.

## Lifecycle decisions retained at the public boundary

Complete physical refinement must not silently turn a once-per-call decision
into several decisions. Three such boundaries were reviewed with 33 and root.

**Launch debounce:** `freeSteps` counts unsupported public calls, with immediate
reset whenever any physical interval regains support. It does not spend its
three-call debounce in three inner intervals. The new test raises the chassis
over an analytic plane and gives it a rapid upward shaft rate; the first two
refined public calls remain unsupported without launching. A separate real
downward crossing regains contact after the first inner interval and must
reset the count immediately. No private contact outcome is mocked.

**Automatic shifting:** the selection decision runs once per public call.
RPM, torque and the ignition-cut clock continue to advance through every
physical interval. The consequential case is a gear-3 downshift that is
initially rejected by the actual driven rotor's over-rev protection. Braking
can make the rotor admissible inside that same public call. The new test
requires the rejected decision to remain rejected for that call; the next
public call accepts exactly one gear edge. This catches the extra decision
that 33 isolated during the coarse landing trace. Report 33 records its
convergence effect; no force law or crash threshold was adjusted.

**Landing judgment:** a newly created landing record is published immediately,
but a verdict is not reevaluated at every added inner boundary. The first
interval of the next public call owns judgment. A controlled 12 m/s drop on
each bike reaches the eight-interval cap, records the actual full-travel
shaft-speed maximum, and remains riding until that public boundary. The next
call produces exactly one `crash-flat`, one crash cause and one core crash.
The original contact time, incoming normal speed and peak bottoming speed
remain unchanged by judgment; the pending record is then cleared.

Other audited contracts:

- The inherited external-impulse absorber runs exactly once. Its `dt`
  parameter is unused, so receiving the first interval's duration does not
  change impulse magnitude. An independent collision test checks positional,
  forward, transverse and roll transfers numerically, then requires the
  subsequent physical intervals to run without reabsorption.
- A manual shift input is consumed once, disables automatic shifting, emits
  one accepted gear-stroke event and ages one cut over the original elapsed
  time. A second edge during the cut is consumed without being queued or
  replayed by later intervals.
- A two-call AI lease expires after two public calls. Those calls are not
  refined and retain AI ownership for their entire duration. Player contact
  refinement begins only on the next call. Supermoto likewise remains on its
  original single-interval path under a rapid compression.
- Held throttle, front brake, rear brake and steering survive all intervals.
  Adapter time sums to the original duration, fuel accounts for the sum of
  actual motor joules plus the existing idle debit, and recovery receives
  only the physical time after the actual fall.
- Flexible machine modes advance at every physical interval. Their internal
  final state is compared with a separate `MxMachineMotion` driven by the
  same observed inputs across two public calls and a steering reversal.
  Published fork/shock/steer rates remain endpoint pose differences divided
  by the original public duration. Republishing those three rates does not
  reset the beam state or its private previous poses.

The two real-input replay suites also pass after these changes. They exercise
natural controls, shifts, flight, crash, recovery, remount, flashback branches,
latent-state continuation and pause sampling. The existing physics identity
remains 41; the presentation protocol remains 17 with its established layout.

## Interval means and physical state are different contracts

The wrapper aggregates only channels whose public meaning is an interval
observation. Its equal-duration intervals have equal time weights. It does
not feed averaged values back into the force solve or apply thermal work a
second time.

| Channel | Retained meaning | Reason / consumer |
| --- | --- | --- |
| `tires[].fx`, `tires[].fy` | Mean wheel-frame force over the public call | Public wheel/recording channels; force times duration recovers the reported impulse |
| `tires[].energy` | Mean slip power in watts, half per axle alias | Public per-wheel and vehicle-sum channels; sum times duration recovers physical slip work |
| `gLong` | Mean reported acceleration over the public call | Public telemetry and traffic/off-road planner acceleration prediction |
| `dynamics.longitudinal` | Final physical interval's diagnostic acceleration | Distinct from the public mean; retained without changing core state |
| Private MX force/slip/brake-power fields | Final physical interval | Inputs to thermal/contact/pitch bookkeeping; never replaced by a public mean |
| `forceFront/Rear`, `compressionFront/Rear` | Incoming state of the final physical interval | Actual support and spring/damper timestamp needed by the next solve |
| Speed, heading, yaw, reference speed, wheel speeds, load, `gLat`, `gVert` | Final phase/state | Averaging would invent a different endpoint or alter future forces |
| Core drive/brake outputs and actuator ceilings | Final physical interval | Core curvature/control and actuator semantics remain phase-local |
| Temperatures, pressure, wear, fuel, machine flex | Integrated final state | Each reservoir/mode was already advanced through every physical interval |

`gLong` is **not presentation-only**. The off-road planner uses it in an
acceleration prediction, and traffic reads it for braking behavior. Its
whole-public-call acceleration meaning is deliberate. Ridden lap acceptance
must therefore run after the publication change; this report does not claim
that unchanged core state alone proves unchanged feedback-controller laps.

The numerical publication probe starts at 18 m/s with a prescribed 8 m/s
compression and held drive/brake commands on an analytic plane. Three actual
physical intervals are selected. The previous final-interval-only readings
and the new public means differ substantially:

| Bike | Final-interval front Fx (N) | Public mean front Fx (N) | Final-interval slip watts per alias | Public mean slip watts per alias | Actual front slip work (J) |
| --- | ---: | ---: | ---: | ---: | ---: |
| MX250 | -1276.224337 | -951.711841 | 279.027546 | 239.156659 | 3.985944320 |
| MX450 | -1346.848665 | -1002.664019 | 308.080237 | 263.131860 | 4.385530999 |

The new tests require meaningful differences from the last interval, not just
a nominal averaging loop. They check that the mean slip watts times public
duration recover actual per-interval work and the corresponding tread-wear
increment, while all captured physical endpoint fields remain exactly equal
to the final interval.

## Independent heat proof and the diagnostic observer correction

The thermal proof uses the first law for four finite reservoirs at each real
motorcycle wheel. For each actual interval, it computes stored heat using
that interval's incoming wear-adjusted capacities, then adds the implicit
solver's outgoing ambient, track and water fluxes evaluated at the interval
endpoint. Internal tyre/rotor conduction cancels. That sum must match the
retained slip share, actual rolling work and actual friction-brake work.

The rotor is also checked separately:

`rotor source J = Cdisc * (Tafter - Tbefore) + interval dt * endpoint heat loss`.

The production reservoirs pass the independent four-node and rotor balances
at the retained `1e-7 J` gate. Alias slots are not counted as additional
reservoirs. Fuel is checked separately against actual motor work, rather than
reconstructing a drive command from net tyre force.

The original player benchmark assumed one implicit thermal solve per public
call. With several solves, the exact loss is the **sum** of each interval's
endpoint loss times its duration. The final loss times the entire public
duration is generally different. The existing front flight update also
applies exponential bearing drag followed by a finite brake decrement; that
split update is not a semigroup. Repeating it at smaller intervals has a
different finite-step result from one large application, even with no
contact anywhere inside the public call.

An independently observed three-interval near-contact forecast stays airborne
through every interval, with zero landings. Both bikes begin at 60 rad/s,
front brake 0.4 and public dt 1/120 s. Actual final front speed is
59.194339746952 rad/s; the old single-interval recurrence predicts
59.193666296605 rad/s, a difference of 0.000673450347 rad/s. The physical
interval recurrence itself agrees exactly within the existing tolerance.

| Quantity (J) | MX250 | MX450 |
| --- | ---: | ---: |
| Actual accumulated front friction-brake work | 23.487993908631 | 25.294762670833 |
| Independent summed rotor thermal balance | 23.487993908807 | 25.294762671205 |
| Balance residual | 1.77e-10 | 3.72e-10 |
| Error from final heat loss times public dt | -0.004513724 | -0.004366006 |
| Error from the old whole-call coast-only kinetic formula | -0.052255465 | -0.056275117 |

Consequently the benchmark now temporarily observes the actual complete
physical intervals, checks the same rotor recurrence and implicit reservoir
balance there, and sums work over the public call. It retains the existing
`1e-7 J` work limits and `1e-9 rad/s` front-rotor limit. The physical public
trajectory hash and outer `steps`/`playerSteps` counts remain public samples.
New `physicalIntervals`, `freeIntervals`, `recoveryIntervals`, `refinedSteps`
and `rearAirWorkIntervals` explicitly distinguish the inner observations.
A public call counts as completely free only when all its physical intervals
are free; a landing event invalidates a supposed uninterrupted flight even
when both endpoint flags happen to say airborne.

The migration eliminated the old rotor-work violations without weakening
their tolerance. A new public slip-work check also requires the displayed
mean power to recover the observed interval sum within `1e-7 J`.

## Physical touchdown versus the later public snapshot

Once the thermal observer was corrected, five player cases exposed an older
timestamp assumption: their locked front rotor was asserted to remain zero
in `touchdown`, which is the end of the **public call**. Later supported
intervals legitimately pick it up before that snapshot; the observed speeds
were about 3.97–4.04 rad/s.

The benchmark retains that public snapshot and its hash. It additionally
captures the swept `vertical(dt, boundary)` event before support integration
and before later ground intervals. The new `firstContact` event must have
exactly the landing record's time and exactly zero front speed in the locked
front scenario. If the subsequent public snapshot has positive front speed,
the test requires positive loaded contact intervals, zero front brake,
negative actual tyre Fx, and the angular impulse equality

`Ifront * (omegaAfter - omegaBefore) = -Fx * frontRadius * interval dt`.

Their summed rotor gains must exactly explain the later public speed. The
check uses the live grounded tyre inertia and radius actually passed to the
ground solver. It does not substitute the differently calibrated generic
airborne wheel inertia. No rotor tolerance or gameplay threshold was changed.

Both diagnostic entry points are scoped to one public call and restored with
their original property descriptors in `finally`, including when observation
throws. Two long paired traces compare instrumented and ordinary simulations
through free flight, contact, a real bottoming crash, recovery, remount and 32
further public calls. Their hashes cover unrounded physical state, body
kinematics, public forces/power, motion derivatives, rotors, temperatures,
wear, fuel, controls, gear state, crash/landing history and rider state. The
entire traces hash identically, and no own-method override remains afterward.

## Exact legacy and recording preservation

The pre-coupled adapter is the unchanged HEAD source with SHA256
`7fa932378aa37f4e93a51900e3e40f3aafa16a2c87f1a65537f5799fa31fa272`.
An isolated temporary copy redirects its imports to the same current helper
modules, so the comparison measures the adapter change itself. Each MX bike
uses the ordinary AI-marked approach, flight and landing on both venues, for
six seconds at both 120 and 240 Hz. Every unrounded sampled state is equal,
not merely close. All eight previous/current trace hashes match; the runs
include 201–693 airborne samples and two to six landings each. Full hashes
are saved in the evidence JSON.

The immutable non-MX runner and baseline were not edited. Formula, GP, road
bike, supermoto and rallycross all reproduce their complete saved snapshot
digests, permitting only the already-established physics identity 39→41.

Report 36's real-input replay and recovery conclusions were rechecked after
the coupled source settled. Their 14 tests pass on the adapter fingerprint
above. No new snapshot field, decoder field, wall clock or random source was
introduced by this assignment.

## Executed verification

All commands ran from the repository root, through installed direct entry
points and one Vitest worker.

```sh
node node_modules/vitest/vitest.mjs run \
  tests/motocross-coupled-step-contract.test.ts \
  tests/motocross-dynamics-replay.test.ts \
  tests/motocross-recovery-replay.test.ts --maxWorkers=1
```

**35/35 passed**, three files, 22.69 s. This run contained the first 21
contract cases, plus ten dynamics and four recovery replay cases.

```sh
node node_modules/vitest/vitest.mjs run \
  tests/motocross-coupled-step-contract.test.ts \
  tests/motocross-player-dynamics.test.ts --maxWorkers=1
```

Final result: **44/44 passed**, two files, 15.52 s. The contract file now
contains 24 cases, including the two instrumented/unobserved traces and
restoration on failure. The distinct final total is **58 tests, four files**.

Intermediate player runs are not hidden: after the thermal migration the
suite was 15/20, with all remaining failures at the old public-touchdown
locked-rotor assertion. The explicit event/impulse check resolved those
timestamp assumptions. An initial added pickup oracle used the generic wheel
inertia; it was corrected to the actual ground-solver tyre inertia rather
than weakening the angular-impulse equality.

```sh
node --max-old-space-size=384 --experimental-transform-types \
  scripts/bench/mx-dynamics-preservation.ts \
  --compare docs/engine/mx-dynamics-2026-11-25/evidence/non-mx-baseline.json
```

**Pass**, five cases, empty mismatch list. The separate temporary legacy-AI
comparison passed all eight six-second cases and 8,648 samples.

```sh
node node_modules/prettier/bin/prettier.cjs --write \
  tests/motocross-coupled-step-contract.test.ts
node node_modules/eslint/bin/eslint.js \
  tests/motocross-coupled-step-contract.test.ts \
  scripts/bench/motocross-player-dynamics.ts \
  tests/motocross-player-dynamics.test.ts
node --max-old-space-size=512 node_modules/typescript/bin/tsc \
  --project test-results/agent37-tsconfig.json
```

Formatting, focused lint and the strict targeted TypeScript check pass. The
temporary configuration includes the two changed test files and their
imported source graph. No optional whole-suite validation was run.

## Observed identities and limits

The evidence JSON records SHA256 for the production adapter, ground solver,
benchmark, four focused test files and both immutable preservation artifacts.
Key values at release:

| File | SHA256 |
| --- | --- |
| Adapter | `02cc6351d7467833dfa21be74a2fac71ddfbbd64ecc4cd6623809325384d58b4` |
| Ground solver | `68b04234548a2b037f4769d38343c26ec712a61fd9261fd6dac44641c81ca4e3` |
| Player benchmark | `1a3cda583e6b906b3708d80289eca195ede32729477e26942aac74c2dddd0f4d` |
| New contract tests | `96312bfb9b43d1bb65342beed500931d68b5679d3e1d5ef6d3a1e0061a7a83e8` |

These are finite-duration, same-runtime deterministic checks and per-phase
work proofs. They do not assert that the entire reduced motorcycle model is
globally passive. Report 32's disclosed yaw-damper limitation remains, and
the existing grounded versus airborne wheel-inertia accounting remains a
separate model limitation. The actual observed values are in kg·m²:

| Bike | Front, ground solver | Front, flight torque/heat | Rear, ground solver | Rear, flight torque/heat | Generic rear tyre ABI field |
| --- | ---: | ---: | ---: | ---: | ---: |
| MX250 | 0.60 | 0.65 | 0.52 | 0.52 | 0.65 |
| MX450 | 0.60 | 0.70 | 0.62 | 0.62 | 0.70 |

Caller sites are explicit. `BikeVehicle.fitFrontRadius()` in
`src/simulation/bike-vehicle.ts` sets the front tyre inertia to 0.6.
`DirtBikeVehicle.stepInterval()` passes that live `tires[0].inertia` as the
ground solver's `frontInertia`, and `air.spinInertia` as `rearInertia`.
`DirtBikeVehicle.flight()` instead uses the definition's generic
`spec.wheelInertia` for front brake reaction torque and front rotor kinetic
work; its rear reaction and brake-work calculations use `air.spinInertia`.
The generic rear tyre ABI inertia is therefore not the authoritative inertia
used by either ridden MX rear-rotor phase.

These existing fields need a separate energy review to determine whether the
front distinction represents a deliberate component boundary or an
unaccounted kinetic-energy change at handoff. This assignment proves the
work balances **within the observed phase**, preserves the calibrated
values, and does not claim an energy-continuous change of inertia. No
model-parameter retuning was folded into the observer repair.

The authoritative support state remains phase-local by design. The new
public mean `gLong` can influence the ridden planner, so later lap validation
must include it. Assignment 40's separate launch-debounce coordinate finding
is outside this source snapshot and must not be represented as resolved by
these tests. Ownership is released to root for integration and the later
focused acceptance rerun.
