# GP path and steering consistency review

Assignment 14, wave 5. This report records four independently demonstrated
controller/planner defects and their bounded corrections. The implementation is
in the shared `main` working tree; this assignment made no commit or push.

## Scope and physical contract

The sprung road contacts, unilateral loads, energy-based motorcycle thermal
model, tyre force curves, tyre friction, grip/crash thresholds, and paired planar
momentum integration are retained. These changes correct the rider's requested
steering and braking. They add no contact support or applied tyre force.

The source owner for the independent road-ribbon ownership correction is wave 6,
assignment 17. Its fix is a separate causal finding and is not attributed to the
planner changes here.

## 1. Braking work used the wrong path distance

An offset path `p(s) = r(s) + d(s)n(s)` travels horizontal distance per centreline
station metre

```text
metric = hypot(1 - centrelineCurvature * offset, dOffset/ds).
```

The GP profile already changed lane curvature for a tactical offset but still
credited every 12 m station interval as 12 m of stopping distance. For a circular
centreline of radius 30 m and an inside offset of 6 m, that interval is an exact
9.6 m arc. The former profile credited 25% more braking work over that interval
than the actual lane could provide.

The frozen seeded Ardennes trace independently showed the same direction and
scale. Over station 3118–3145, summed actual planar travel divided by station
travel was 0.816, 0.833, 0.808 and 0.807 for the four riders. Single-frame nearest
station increments are discontinuous, so these comparisons use accumulated
travel over multiple samples.

`motorcyclePathMetric` now supplies the GP sample metric. Adjacent metrics are
integrated by the trapezoidal rule over the existing 12 m station spacing. The
profile, road grade and planned lever feed-forward use that physical distance:

- Road gradient is centreline `dy/ds` divided by the same path metric.
- Backward braking uses `(v_entry² - v_exit²)/2 = a_net * pathDistance`.
- The lever request uses the actual first profile interval.

Distance is optional in the shared envelope. Car callers and omitted-distance
callers retain their exact existing 12 m calculation. Tactical offset is held
constant over each plan, as in the existing lane model; the authored racing-line
slope contributes to the metric. The 12 m numerical sampling remains an
approximation for a varying lane, while the circular-lane tests are exact.

## 2. A net-braking floor invented unavailable force

The shared backward solve had a 0.5 m/s² minimum after applying a custom
motorcycle stopping bound and road grade. That floor could still promise positive
deceleration when the rear-load reserve left no brake force, or when downhill
gravity exceeded the available brakes.

When a vehicle-specific physical capacity is supplied, the solver now retains
the sign of net deceleration. A negative net capacity requires entry speed below
the permitted exit speed. If even entry at rest cannot meet that bound, the
returned profile value is a finite zero-speed request. It does not claim that
the physical brakes can hold the vehicle on that grade. The original car floor
and arithmetic remain unchanged when no custom capacity is supplied.

This was a latent mathematical defect in the tested seeds: correcting it after
the path-distance change produced exactly the same hairpin fall stations. Its
proof is the independent zero/small/negative-capacity work tests, not a claimed
race improvement.

## 3. Front steering inverted a different force from the plant

The old steering inverse inverted pure lateral slip scaled by a friction
ellipse. The forward contact applies the full combined-slip law and projects
the steered front force into the chassis frame:

```text
frontBodyFy = frontTyreFy * cos(groundSteer) + signedFrontFx * sin(groundSteer).
```

The controller asks for `frontBodyFy`. It previously supplied a positive brake
magnitude to an inverse that only squared that argument, so its sign and lateral
projection could not affect the result. It also read the preceding contact's
cached load and slip preparation after `Bike.step` had already accepted the
current suspension loads.

Frozen-state forward/inverse tests demonstrated errors before the correction:

| Frozen case | Requested body lateral force | Forward result before correction |
| --- | ---: | ---: |
| Upright, no front brake | 700 N | 696.306 N |
| Lean +0.5 rad, no front brake | 1,100 N | 1,096.525 N |
| Lean +0.4 rad, front Fx −900 N | 1,000 N | 973.414 N |
| Lean −0.4 rad, front Fx −900 N | −1,000 N | −1,119.440 N |
| Lean +0.2 rad, front Fx −1,400 N | 600 N | 580.243 N |
| Contact load changes 1,400 → 700 N | 500 N | 208.309 N |
| Contact load changes 1,400 → 2,100 N | 500 N | 766.154 N |
| Contact friction changes 1.5 → 0.9 | 500 N | 567.674 N |

The inverse now prepares the same tyre construction at the current effective
front contact load and friction, uses the same combined-slip force function,
and solves for the signed chassis-frame force. A bounded search locates the
nearest root in the existing pre-peak slip bracket before bisection. The existing
3% inverse reserve stays inside the achievable projected range. The physical
forward force law is unchanged.

Inverse trials have their own slip-state scratch. They do not overwrite actual
contact slip, force, wheel rotation or thermal telemetry. The tests remove only
the known relaxation factor of an initially undeflected contact and then inspect
the production forward plant; all eight force cases now meet a 0.05 N tolerance.
Unloaded-contact and telemetry-isolation tests cover the bounded edge cases.

## 4. Braking omitted the path follower's current recovery demand

The path follower adds a bounded PD lane/course correction to `v²κ`, but corner
and braking plans reserved only the lane curvature. In the post-inverse seed1000
trace, the remaining rider entered the final hairpin with correction rising to
5.884 m/s² and roll rate 1.69 rad/s. The normal corner plan remained attainable
only without that additional recovery demand; cornering ABS correctly released
brake force when the physical roll request used the remaining capacity.

The path-error calculation is now shared by steering and the GP plan. Each plan
reserves the absolute current correction in both the corner-speed limit and the
braking profile, including its friction ellipse and motorcycle rear-load bound:

```text
abs(v²κ + correction) <= abs(v²κ) + abs(correction).
```

This uses the existing correction bound and wet-contact scaling. There is no new
grip multiplier or speed margin. Holding the current reserve across one profile
is conservative when the correction opposes the corner. It is recomputed on the
next step and becomes exactly zero as soon as the rider's current path error
does. It is a lateral force budget; arbitrary roll transients are still decided
by the physical rider/contact model.

## Reproduction and checkpoints

All commands below are run at the repository root. No acceptance assertion or
race timeout was relaxed.

### Focused mathematical and production invariants

```sh
npx vitest run tests/motorcycle-recovery-budget.test.ts \
  tests/gp-steering-inverse.test.ts tests/motorcycle-path-distance.test.ts \
  tests/motorcycle-net-braking.test.ts tests/motorcycle-braking-plan.test.ts \
  tests/ai-braking-grade.test.ts tests/gp-control-preview.test.ts --maxWorkers=1
```

Final result: **7 files, 38 tests passed**. This includes exact zero-reserve
compatibility, signed opposing correction, current/continuous recomputation,
circular/diagonal path work, signed grade, inverse force and telemetry isolation.

The exact inverse checkpoint also passed **39 tests** across
`gp-steering-inverse`, `gp-contact-momentum`, `gp-contact-reaction`,
`gp-riding-control` and `motogp-physics`, before the final additional recovery
budget and telemetry-isolation test. Momentum/reaction/plant source did not
change after that check.

### Unchanged race gates before the independent ground fix

| Source checkpoint | Ardennes1000 final hairpin | Ardennes1037 final hairpin | Montejaral1000 final hairpin | Mixed GP/SBK |
| --- | --- | --- | --- | --- |
| Received contact/thermal checkpoint | 2 falls: s3154.643, s3166.158 | 2 falls: s3178.150, s3157.055 | Pass | 4 incidents; bound is 3 |
| Physical path distances | 2 falls: s3159.520, s3160.652 | 2 falls: s3161.941, s3161.816 | Pass | Not rerun |
| Signed custom net capacity | Same exact stations as preceding row | Same exact stations as preceding row | Pass | Not rerun |
| Exact inverse and current load preparation | 1 fall: s3134.586 | 2 falls: s3175.692, s3139.153 | Pass | 7 incidents; gate failed |

These all completed their races. The inverse correction is independently
justified by its force invariants; this checkpoint did not meet release gates.
The larger mixed incident count is recorded explicitly. It is not a validated
full-race improvement.

### Combined ground-ownership and recovery-budget checkpoint

The single combined unchanged hairpin/mixed check is recorded in
`/workspace/scratch/d611aefdb08c/w05-combined-races.log`:

```sh
npx vitest run tests/gp-ai-braking-plan.test.ts tests/bike-session.test.ts \
  -t 'no rider falls at|finishes a mixed GP' --maxWorkers=1
```

| Gate | Frozen combined outcome |
| --- | --- |
| Ardennes hairpin, seed1000 | Pass: no falls in the original tested window |
| Ardennes hairpin, seed1037 | Pass: no falls in the original tested window |
| Montejaral hairpin, seed1000 | Pass: no falls in the original tested window |
| Mixed GP/SBK incidents, completion and recovery | Passed the existing incident ≤3, race finish, completed laps, non-retirement and stationary-time assertions |
| Mixed GP/SBK pace ordering | **Failed**: best GP lap 92.66702223127618 s; best SBK lap 89.02046023280141 s |

The GP best lap is 3.64656199847477 s slower in this checkpoint. **The full mixed
test remains failed.** No claim of zero incidents is made for that mixed race;
the existing bounded-incident assertion passed. Holding the current correction
over a whole profile is conservative and is a candidate for the pace review,
but this run includes the independent ground fix, so it does not isolate the
cause of that pace ordering.

Wave 7 assignment 20 owns the subsequent pace and final acceptance review.
Production changes from this assignment are frozen. Cooldown and complete
session/approach acceptance still need verification on the final combined source.
Scoped ESLint and `npx tsc --noEmit` passed at this frozen checkpoint.

## Diagnostic artifacts and ownership

`scripts/studio/tools/gp-contact-checkpoint.mjs` remains read-only and accepts an
optional station window and simulation duration:

```sh
node --experimental-transform-types scripts/studio/tools/gp-contact-checkpoint.mjs \
  1000 300 400 40 > crest.trace 2> crest.events
```

The default remains the final Ardennes hairpin, seed1000, through race finish.
It now includes the inverse request, effective contact preparation, physical
profile distance/recovery reserve, actual tyre forces and a pre-fall snapshot
before the incident state resets the GP telemetry.

Frozen diagnostic files in the workspace:

- `gp-final-ardennes-1000.trace` / `.events`: received contact checkpoint.
- `w05-signed-ardennes-1000.trace` / `.events`: distance and signed-capacity check.
- `w05-inverse-ardennes-1000.trace` / `.events`: exact inverse/current-contact check.
- `w05-inverse-before.log` and `w05-inverse-contact-before.log`: failing invariant
  evidence before correction.
- `w05-final-invariants.log`: final 38-test invariant result.

Assignment 17 separately captured the early s300–400 road-profile failure and
corrected contact ribbon ownership in `contact.ts`, `bvh.ts` and
`tire-footprint.ts`. That investigation found spurious overlapping road geometry,
not a reason to reduce spring rates or raise crash limits. Its report owns the
ground-selection evidence and acceptance results.
