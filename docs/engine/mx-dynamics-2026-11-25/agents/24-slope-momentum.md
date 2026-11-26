# Agent 24 — player MX slope and departure momentum

Date: 2026-11-25. Wave 4. Checkout: `/home/agent/motobound-579b454ae846`.

## Release status and ownership

**Production ownership released to root.** The 48 new slope/departure cases
pass. All 84 existing ballistic, contact-time, riding, touchdown-momentum,
and air-drag cases pass. The larger eight-suite run still has integration
failures detailed below; this report does not declare the whole release green.

Owned changes:

- `src/simulation/offroad/dirt-bike-vehicle.ts`: player eligibility at placement
  and mode changes, sampled `roadPitch`, and the ground-to-air speed conversion.
- `tests/motocross-slope-momentum.test.ts`: new physical regressions.
- This report.

No existing assertions were changed by this agent. No AI policy, speed target,
takeoff gain, recovery behavior, contact impulse, ground-force parameter,
model, animation asset, environment, course, venue, or specification data was
edited. No git commands, installation, package hooks, or full TypeScript build
were run. Other agents concurrently owned recovery and the optional bank
gravity helper; root subsequently wired bank gravity into the adapter.

## Source proof and correction

### 1. The sampled ground chord has a horizontal run

`sampleSuspensionContacts()` constructs the patches at
`d.x/z ± headingDirection * axleReach`. The front and rear are therefore one
fixed wheelbase apart in the horizontal plane, independently of sprung pitch.
The correct chord angle is `atan2(frontHeight - rearHeight, wheelbase)`.

The previous `asin(clamp(rise / wheelbase, -0.6, 0.6))` treated that horizontal
run as a sloped length. For grade 0.6 it gave 0.643501 radians instead of
0.540420 radians. Its horizontal speed factor was 0.8 instead of 0.857493, and
its uphill-gravity coefficient was 0.6 instead of 0.514496. The new tests
independently check the sampled patch separation, analytical plane angle,
first-step gravity coefficient, infinitesimal displacement, and published
world velocity. Mirroring grade and reversing heading preserves the expected
sign. Changing chassis pitch does not change a fixed horizontal sample span;
chassis yaw correctly changes the direction in which the plane is sampled.

Only the player `mx250`/`mx450` plant on motocross/supercross courses uses the
corrected angle. AI, supermoto, and other course kinds retain their existing
inverse-sine convention. The independent inverse-sine equation in
`settlePose()` solves rotated free-wheel geometry and was deliberately untouched.

### 2. Departure is a speed-coordinate change

At entry to the existing `vertical()` solver, grounded physical forward speed
is already `vh = d.speed * cos(roadPitch)`. Sprung `vy` independently carries
the vertical momentum. Previously, after three unloaded steps, departure
assigned `flightSpeed = d.speed * cos(atan(faceSlope))` while retaining `vy`.
The last supported tyre's local face is generally different from the current
two-patch chord. Changing that projection creates a finite horizontal impulse
without a contact force.

Player departure now stores the resolved `vh` in `flightSpeed`, and immediately
stores the same horizontal scalar in `d.speed`. `vy`, slide, heading, physical
yaw rate, and both rotor speeds retain their existing momentum. `lastTakeoff`
uses the actual horizontal/vertical split. AI/supermoto keep their last-face
conversion and existing rotor initialization exactly.

The controlled tests check full world horizontal momentum and translational
kinetic energy, subtracting only the independently known gravity work. They
include zero forward speed, nonzero transverse slide, mirrored grades, pitch
and heading, a deliberately different last loaded face, and unsupported steps
at 120/240/480 Hz and `dt = 1e-8`.

The actual public takeoff tests use the existing production `rigTrack()` and
`rideLine()` fixtures, both real venues, both MX models, Raw/Sport, and
120/240/480 Hz. Only rolling initial speed, placement, and gear are prescribed.
No launch pose, suspension load, flight velocity, or airborne state is supplied.
An observer reads `vertical()` immediately around the natural transition;
the original solver executes unchanged. All 24 departures have a measurable
face/chord difference, preserve incoming world momentum, account for gravity
without a kinetic-energy jump, and then follow the expected drag trajectory
on the first full airborne step.

### 3. Initial placement and live AI/player handoff

`playerMotocross` previously became valid only inside `step()`, so using it
alone in the sampler would leave the first placement on the old slope and
would make the first integration consume that stale angle. The new
`playerMotocrossEligible()` establishes the same course/model/AI selection
before `place()`/`placeFree()` sample the body. Each step selects from its
captured AI mark before gravity or ground travel; a final marked AI step stays
legacy even though the remaining mark counter has already reached zero.

A live grounded convention change also rebases stored road speed:

```text
horizontal = oldStoredSpeed * cos(oldRoadPitch)
newStoredSpeed = horizontal / cos(newRoadPitch)
```

The `contactModelLive` flag distinguishes already integrated motion from
initial fixture/setup speeds supplied after placement. Placement resets it;
the first positive integration activates it. Thus an AI rig marked after
placement retains its prescribed along-slope starting speed, while an actual
AI-to-player or player-to-AI handoff cannot create a horizontal impulse merely
by changing the angle convention. Already-airborne horizontal storage is not
rebased. The new live-handoff tests observe the actual core entry before its
forces advance, and require identical world horizontal velocity and kinetic
energy for both directions, both models/aids, ±0.6 grades, zero/10 m/s, and all
three worker rates plus `dt = 1e-8`.

## Verification

All commands used the local Vitest executable directly with `--maxWorkers=1`.

### New causal suite

```sh
./node_modules/.bin/vitest run tests/motocross-slope-momentum.test.ts --reporter=dot --maxWorkers=1
```

- Before the implementation: **40 failed, 4 passed, 44 total**. Failures cover
  the slope, first-step selection, unloaded momentum, and every real takeoff.
- After slope/departure correction: **44/44 passed**.
- Final, with the four live-handoff cases: **48/48 passed**, 3.28 seconds.

The first live-handoff fixture set a rolling horizontal speed with zero `vy`
on a steep descent. That physically unloaded both springs and departed after
three steps, invalidating its intended continuously grounded handoff setup.
The fixture now supplies the analytical rolling plane velocity
`vy = speed * sin(roadPitch)`. Every original continuity assertion remains;
unsupported departure is tested separately.

### Existing physical regression

The following existing suites pass **84/84** in both focused runs:

```text
motocross-ballistic-timing.test.ts
motocross-contact-time-coherence.test.ts
motocross-riding.test.ts
motocross-landing-momentum.test.ts
motocross-air-drag.test.ts
```

The broader run also included `motocross-ai.test.ts`,
`motocross-jump-corridor.test.ts`, and `motocross-player-dynamics.test.ts`:
**154 passed, 6 failed, 160 total**, 48.60 seconds. Its remaining failures were
sent to root immediately, with no existing assertion changes:

| Suite | Failure / observed result |
| --- | --- |
| AI | Actual manual remount took 5.441667 s against the old 4.9–5.1 s fixture interval. Agent 23 confirmed this belongs to its physical remount handoff and owns the follow-up. The other 41 AI cases passed. |
| Jump corridor, ridden side −1 | First landing station 468.297188 m, below the existing landing-zone lower edge 468.788220 m. |
| Jump corridor, ridden side +1 | First landing station 468.786259 m, below the same lower edge. |
| Player dynamics, MX250 Raw Valley front lock | Observed `crash-flat`, expected `bottomed`. |
| Player dynamics, MX450 Raw Arena front lock | Observed `crash-flat`, expected `crash-front`. |
| Player adverse refinement | Eight adverse coarse trajectories were selected, against the existing exact seven-case expectation. |

These outcomes require integrated review. The slope and launch laws should
not be weakened to force old adverse trajectories to retain a previous label.
This agent did not alter those labels, crash thresholds, controller inputs,
or landing-zone assertions.

## Ridden-lap diagnostic and limits of attribution

Ran the unchanged agent-21 lap diagnostic before and after the correction.
Both runs use the same existing two-lap ridden-controller arrangement, with
AI ownership withheld and front brake/steer released in flight. Each run's
before/after source fingerprints were identical.

| Circuit | Before: longest stall | Candidate: longest stall | Candidate two-lap time | Candidate crashes |
| --- | ---: | ---: | ---: | ---: |
| Valley Ridge | 4.158333 s | 0.258333 s | 178.000000 s | 0 |
| Arena Nord | 4.150000 s | 4.175000 s | 161.383333 s | 0 |

The existing assertion is **less than 1 second**. The candidate clears that
diagnostic on Valley and still fails it on Arena. Arena now stalls at
s153.850077 / lateral −2.597894 m. Mid-stall state: speed 0, target 4.737281 m/s,
throttle 1, brake 0, road pitch 0.560288 rad, sprung pitch 0.745700 rad, front/rear
support 324.617/1486.509 N. No AI target or threshold was tuned.

The controlled plane and transition tests establish the direct causal errors
and their corrections. The lap comparison combines the slope and takeoff
changes, so it does **not** prove that the angle correction alone removed
Valley's stall. The optional ground helper also changed between snapshots
while its adapter input was still absent; recovery work was shared in the
adapter. Root's subsequent lateral-gravity wiring occurred after the reported
lap runs and is not covered by their numeric results. Root separately found
the remaining traction-control/drive-budget concern and assigned that to the
next ground-force investigation. An integrated lap gate is still required.

Agent 22 also identified a distinct remaining transport convention: the
grounded adapter currently multiplies the whole contact solver's X/Z step by
`cos(roadPitch)`, which also scales its lateral displacement, while published
horizontal velocity carries `slide` without that factor. This agent preserves
the represented lateral momentum at departure; it did not change that shared
ground-displacement projection. Root has been notified by the ground owner.

## Provenance

Diagnostic runner: `/home/agent/mx-lap-agent21-579b454ae846.ts`.

Diagnostic results:

```text
/home/agent/motobound-diagnostics-579b454ae846/agent21-laps-agent24-before.json
/home/agent/motobound-diagnostics-579b454ae846/agent21-laps-agent24-after.json
```

| Snapshot / file | SHA-256 |
| --- | --- |
| Before lap, adapter | `85cb0fd6cc721c8b70c74b343d023b761be31af0e61b1f52922b5f8ae34b91d9` |
| Candidate lap, adapter | `1d724c4537c647a4653c6e4f5818fd31d4d4be9d76b28b23052dbfaad538ae22` |
| Before lap, ground helper | `dc09f5221342ee0aebcf8e7c03987f1a2ea236f72a708e1c48bbe94ab39be2d8` |
| Candidate lap, ground helper | `bc3e0ca0b49d6bc9161a02d951b43857cf10c6c08488c40fd197f9663ff1f575` |
| Both lap runs, AI | `af74fb9ae81eddc305f565b91c8488d518211f32da140ba811ca2aa8e8971982` |
| Both lap runs, rider weight | `5027085c4bb2b192d89a0368d56ca9296b34ed5130e936db0741eed30304ad96` |
| Both lap runs, contact impulse | `825d280cfd4c1769db8fee0abcdfa91989f4c6b73ac502e120f59f1061afa28e` |
| Final 48-case test | `85c7edbae762a3871e0ed8a78d27e049e2fa41783b1ed47eec12fbc1dee84bc8` |
| Shared adapter at final test/report time, including root's bank wiring | `ef32cf97204a1894285a670ab8e7ae614fddc824ed17da3cbd21ab78a8ddb458` |
| Shared ground helper at final test/report time | `65daba63b8d0ba49b0e0e138159b7a916e0515b821288ee8172178ddeddc9bcb` |

Source ownership is now released. The shared adapter remains open to root's
integrated work; the hashes identify the observed snapshots rather than
claiming the entire checkout is frozen.
