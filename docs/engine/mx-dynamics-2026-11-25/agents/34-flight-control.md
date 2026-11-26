# Agent 34 — bounded Sport airborne pitch control

Date: 2026-11-25. Wave 6, assignment 34 of 60.

## Decision and scope

**Retain the existing production flight aid.** Two inertia-aware finite-horizon
alternatives were exercised through the existing body response and torque
limits. Neither improved the complete controlled landing, and both introduced
regressions when used throughout a ridden lap. No flight-controller change is
retained, and no existing assertion was changed.

This assignment changed only this report and
`evidence/34-flight-audit.json`. It did not edit production source, tests,
models, character assets, terrain, venues, physical specifications or git state.
All alternatives were loaded from a transformed in-memory copy of the adapter
and applied only to temporary diagnostic instances/prototypes. Production
files were never switched between experimental variants.

The remaining full-lap failures are real integration blockers, recorded below.
The no-change decision does not declare the entire vehicle model complete or
claim that every surveyed jump succeeds.

## What the existing controller actually does

For pitch `p`, rate `q`, automatic body position `b`, sampled landing slope `s`
and estimated time to contact `T`, the current controller uses:

```text
e = s + 0.1 - (p + 0.06*b)
T = max(0.12, estimated time to first tyre contact)
wanted = e/T - q
body target = clamp(-0.9*wanted, -1, 1)
```

The gain `0.9` is a calibrated controller gain. Mapping angular-velocity error
to a bounded body command is not, by itself, a dimensional error: the gain
implicitly supplies the corresponding units. Its responsiveness must be
judged against the available actuator and complete trajectory, rather than
assuming a missing factor proves a physics defect.

The body command passes through the existing exact critically damped posture
response at 18 radians/second. Its position and rate remain continuous across
target changes. The resulting body torque is `-85*b` N m. With the unchanged
pitch inertias, the maximum direct body acceleration is approximately
0.86735 rad/s² for MX250 and 0.80952 rad/s² for MX450, before wheel reactions
and existing angular damping. None of those limits was changed.

The player Sport controller uses the body aid while retaining actual player
throttle and brake inputs. The AI also owns its existing airborne rear-wheel
pedal corrections. Raw retains its ordinary brake/drive bracing behavior.
The experiments explicitly selected player Sport only, leaving the AI and
Raw branches untouched. Because no source change is retained, their production
implementation is unchanged by this assignment.

The current first-tyre forecast uses actual extended-wheel geometry, ballistic
heave, analytical horizontal drag and decaying current pitch/yaw rates. It is
a control forecast, not an applied force. Its time-to-contact decreases between
samples, avoiding a stale extra 50–100 ms of predicted correction time. The
forecast intentionally cannot know future rider inputs; sampling it does not
authorize a velocity or trajectory correction.

## Rejected finite-horizon alternatives

Let `I` be pitch inertia, `B = 85 N m`, and `lambda = 0.3 + 0.5*standing` the
existing free-flight angular damping coefficient. The two runtime-only
commands were:

```text
Constant-acceleration aim:
  body target = clamp(-I/B * [2*(e/T - q)/T + lambda*q], -1, 1)

Zero-terminal-rate cubic aim:
  body target = clamp(-I/B * [6*e/T^2 - 4*q/T + lambda*q], -1, 1)
```

These are recognizable finite-horizon control candidates, not replacements
for the physical model. Both passed through the real 18 rad/s body response;
neither inverted or removed that actuator lag. Existing rotor reaction,
85 N m body torque, damping, finite manual stroke, contact integration and
crash thresholds remained in force. Neither candidate supplied translational
velocity or changed the jump speed.

### First complete-lap comparison

One process ran production and both alternatives against a source-stable
checkpoint before assignment 32's ground-work correction. Each venue used the
existing two-lap player-plant scenario: the AI supplies ordinary controls,
`aiControlled` marks are withheld, and airborne ground steering/front brake
requests are released. Each row completed two laps.

| Flight controller | Valley falls | Valley maximum stall | Arena falls | Arena maximum stall |
| --- | ---: | ---: | ---: | ---: |
| Production | 0 | 0.183333 s | 2 | 1.308333 s |
| Constant-acceleration aim | 1 front fall | 0.408333 s | 1 front fall | 6.891667 s |
| Cubic terminal-rate aim | 0 | 7.083333 s | Front fall and contact fall | 1.308333 s |

The alternatives affect earlier hops and therefore change later ground
approaches. These results reject them as broad replacements; they do not
isolate the cause of any one later impact. In particular, reducing the number
of falls while creating a long barrier stall is not an accepted improvement.

### Identical real takeoff comparison

A separate experiment, after the first ground-work correction, held the
entire approach unchanged and activated each alternative only after the same
real Arena departure. It selected the first airborne sample with course
station between 451 and 453 m and less than 100 ms airtime. Every captured
departure field is exactly equal across the three runs.

The common checkpoint includes:

| Quantity | Value |
| --- | ---: |
| Time | 62.650000 s |
| Course station | 452.0138998 m |
| Horizontal speed | 12.04477186 m/s |
| Vertical speed | 7.251923802 m/s |
| Chassis pitch | 0.6045161541 rad |
| Pitch rate | -1.139710568 rad/s |
| Body position | 0.1025663382 |
| Body rate | -1.026200955 per second |

Every common free-flight sample has **exactly identical X, Z, CG height,
vertical velocity and forward speed**. The measured maximum difference is
zero. Changing body pitch changes when an actual tyre reaches the terrain;
it does not create horizontal range or alter the ballistic centre path.

| Result | Production | Constant acceleration | Cubic terminal rate |
| --- | ---: | ---: | ---: |
| First-contact CG station | 468.5852570 m | 468.6323203 m | 468.6426838 m |
| Landing pitch relative to slope | 0.08601287 rad | 0.18610397 rad | 0.07833674 rad |
| Absolute error from the existing 0.1 rad aim | **0.01398713 rad** | 0.08610397 rad | 0.02166326 rad |
| First-contact normal speed | 3.82913194 m/s | 3.69892542 m/s | 3.67200925 m/s |
| Recorded bottoming speed | 5.05537575 m/s | 4.95508924 m/s | 5.63545227 m/s |
| Maximum body position magnitude | 0.71922386 | 0.92377243 | 0.99791745 |
| Landing outcome | Bottomed | Bottomed | Bottomed |
| Riding through 0.5 s after contact | Yes | Yes | Yes |

The constant-acceleration candidate slightly reduces normal/bottoming speed
but worsens the pitch target error. The cubic candidate uses nearly the full
body limit, increases bottoming, and also has a larger pitch target error.
Their contact-station changes are only 4.7–5.7 cm. These tradeoffs do not
justify replacing the established command or claiming a general landing fix.

The earlier captured shoulder impact at approximately 8.84 m/s came from a
different complete-lap departure state. It must **not** be compared with this
3.829 m/s checkpoint as an isolated improvement caused by assignment 32 or by
the flight controller. The evidence JSON keeps the source identities separate.

## First-contact station is an oracle question

The controlled production run first contacts at CG station 468.585 m, slightly
before the separate shoulder regression's 468.788 m lower zone boundary,
while reporting a descending landing slope and surviving the complete contact.
A first contacting axle and the motorcycle CG do not share the same station.

An independent test-oracle review should establish whether a particular zone
contract intends the contacting tyre, the CG, or the fully landed motorcycle.
That review must use the actual footprint and unchanged surveyed geometry;
it must not merely move the numeric boundary until a failing run passes.
This assignment leaves the test and its threshold untouched and does not
assert that every short shoulder landing is safe.

## Final current-production check

Root requested one final two-lap check after assignment 32 reported stable
ground source and while assignment 33's supported-integration trial remained
in memory. No flight alternative was active. The recorded before/after hashes
match, including ground source `68b04234548a2b037f4769d38343c26ec712a61fd9261fd6dac44641c81ca4e3`
and adapter `7fa932378aa37f4e93a51900e3e40f3aafa16a2c87f1a65537f5799fa31fa272`.

| Venue | Completed | Time | Maximum riding stall | Falls |
| --- | ---: | ---: | ---: | --- |
| Valley Ridge | 2 laps | 198.641667 s | 0.358333 s | Front at s601.587596; lowside at s828.277388 |
| Arena Nord | 2 laps | 159.508333 s | 1.583333 s | None |

The Arena stall occurs near s153.976365. Thus the current production
checkpoint still fails the existing no-fall/no-stall combined acceptance.
Those failures were sent to root before ownership release. They are not
silently accepted as the price of the contact correction.

## Executed regression checks

Direct installed Vitest command, without npm lifecycle hooks:

```sh
node node_modules/vitest/vitest.mjs run \
  tests/motocross-riding.test.ts \
  tests/motocross-rider-weight.test.ts \
  tests/motocross-landing-prediction.test.ts \
  tests/motocross-contact-time-coherence.test.ts --maxWorkers=1
```

**66/66 existing tests passed across four files.** These exercise ordinary air
braking, finite manual body momentum, independent ballistic motion, forecast
timing and partial-contact boundaries. No new production implementation needed
an implementation-mirroring test, so none was added. This assignment did not
run a full-repository typecheck or claim the complete motocross suite passes.

The temporary analysis commands were:

```sh
node --max-old-space-size=512 --experimental-transform-types \
  /home/agent/mx-flight-agent34-579b454ae846.ts first-trials
node --max-old-space-size=512 --experimental-transform-types \
  /home/agent/mx-flight-takeoff-agent34-579b454ae846.ts
node --max-old-space-size=512 --experimental-transform-types \
  /home/agent/mx-lap-agent21-579b454ae846.ts agent34-current-production
```

The committed evidence contains the complete controlled checkpoint, outcomes,
exact comparison results, source hashes and all three lap summaries. The
temporary detailed traces are `agent34-flight-first-trials.json`,
`agent34-takeoff-trials.json` and
`agent21-laps-agent34-current-production.json` in the shared diagnostics
directory. The formulas and activation condition above specify the experiments
without requiring a production source edit.

**Ownership released. No flight-controller patch is pending.**
