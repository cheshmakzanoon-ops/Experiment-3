# Assignment 29 — Motion replay, flashback, and compact recording

## Scope

Added `tests/motocross-dynamics-replay.test.ts`. No production, model, asset,
environment, circuit, or vehicle specification file was changed. The test uses
the production `applyLoggedInput` boundary, `Simulation.step`, `InputLog`,
`Resimulation`, `ReplayRecorder`, `PresentedFrame`, and `BikeShells`.

The four fixtures start at the normal practice gate on Valley Ridge MX and Arena
Nord SX with MX250 and MX450. Every input is journaled at 60 Hz, and simulation
runs at the production flashback rate of 120 Hz. There is no initial placement,
speed assignment, private-state injection, AI control, or private solver call.
A small course-following input script reads public bike/course state and writes
ordinary steering, throttle, brake, rear-brake, shift, and rider-weight inputs.

## Observed execution

Each fixture first accepts twelve actual shifts 8 ticks (66.67 ms) apart,
including repeated upshifts and reversals. The test verifies the observed gear
change ticks, not only the requests. Seated left/right dabs and fore/aft rider
weight reversals reach both signs; the subsequent jump drives standing beyond
0.9. Published stance, dab, and composed body rates are checked against the
public adapter observations every ridden tick.

| Venue | Bike | Recorded ticks | Main takeoff tick | Main touchdown tick | Observed transition |
| --- | --- | ---: | ---: | ---: | --- |
| Valley Ridge MX | MX250 | 3,558 | 3,457 | 3,526 | RIDGE TABLE, clean touchdown |
| Valley Ridge MX | MX450 | 3,450 | 3,336 | 3,418 | RIDGE TABLE, clean touchdown |
| Arena Nord SX | MX250 | 3,685 | 3,561 | 3,653 | TRIPLE, touchdown and subsequent short rebound |
| Arena Nord SX | MX450 | 3,637 | 3,507 | 3,605 | TRIPLE, front-crash touchdown and separated-rider boundary |

The stadium slow approach is deliberately retained as observed; it is not a
claim that this scripted approach is a suitable real riding technique or that
every landing is clean.

Two from-start resimulation schedules reproduce the motion payload at input,
shift, takeoff, touchdown, and intervening checkpoints. One changes step caps;
the other also exhausts a synthetic wall-time budget. The live fixture publishes
a snapshot every tick, while resimulation publishes only sparse checkpoints;
the different observation cadence leaves subsequent motion unchanged. A branch starts twelve
ticks after each observed takeoff, truncates the original future, applies new
weight reversals and six shift requests through `applyLoggedInput`, and is
replayed from the start. Its 30 Hz frame intervals reconstruct identical
interior motion at three fractional sample times. Landing records also match.
A negative control removes the second identical accepted upshift and must
produce a different gear, trajectory event, and motion payload.

## Compact playback and pose results

The real frames pass through the compact recorder at its unchanged 15 Hz
cadence. Every decoded rider, machine, derivative, and accepted-event field
matches the corresponding source frame exactly. Intervening recorded physics
ticks supply an independent reference for reconstructed positions; this is not
an assertion derived only from the interpolation formulas.

The maximum observed foot-channel error was **0.0000403**, compared with
**0.570251** for straight endpoint interpolation on the same observations.
The test permits 0.0003 to account for sampling times reconstructed from the
Float32 session header. Mean reconstructed stance, dab, and body errors were
lower than linear interpolation in all four fixtures:

| Venue / bike | Stance mean error | Dab mean error | Body mean error |
| --- | ---: | ---: | ---: |
| Valley / MX250 | 0.0000496 | 0.0003802 | 0.0001743 |
| Valley / MX450 | 0.0000251 | 0.0003878 | 0.0001274 |
| Arena / MX250 | 0.0000232 | 0.0005682 | 0.0003078 |
| Arena / MX450 | 0.0000239 | 0.0005310 | 0.0001852 |

The actual `BikeShells` consumer poses existing mid-detail rigs. Seven torso,
head, spine, boot, and selector world matrices repeat exactly through forward,
reverse, and repeated paused seeks. The source simulation advances another
0.8 seconds with changed controls and fresh snapshots; subsequent old-recording
poses remain identical even while the render wall clock jumps by days. Source
snapshot arrays remain unchanged. A valid unmarked copy of actual moving
endpoints retains the legacy linear rider/foot contract through compact replay.

## Validation

- The new suite passed **10/10 tests** in the broader run (15.107 s) and again
  after the compatibility correction (15.562 s), including exact endpoint and
  decoded-input immutability checks.
- The initial focused batch executed **163 tests across 12 suites: 162 passed,
  one failed**. The passing suites were the new replay suite plus
  `flashback-determinism`, `flashback-recording`, `flashback-work-budget`,
  `engine-flashback-state`, `recording`, `recording-transport`,
  `snapshot-interpolation`, `motocross-posture-transport`,
  `motocross-body-transport`, and `motocross-foot-reconstruction`.
  The last suite also exercised real mid/high boot clearances and all 64,000
  trajectory sample cases. Total batch duration was 139.91 s.
- The final targeted run passed **23/23 tests across three suites**:
  `motocross-dynamics-replay`, the unchanged `motocross-motion-boundary`, and
  Assignment 31's new `motocross-foot-boundary`. Total duration was 21.08 s.
- ESLint and Prettier checks passed for the owned test.
- No full TypeScript check was run; that remains the coordinator's gate.

### Compatibility defect found by the related run

`motocross-motion-boundary.test.ts` retained its existing expectation that
unmarked old recordings ease a ridden boot toward neutral across a rider-state
edge. With the new sampler, alpha 0.5 returned angle 0 instead of
0.10000000149011612. The early absent-control fallback selected a complete
endpoint before the legacy interpolation path could run.

This is a concrete compatibility regression, not a reason to relax the existing
test. It was reported to the coordinator and sampler owner without changing
production files. Assignment 31 repaired the sampler by handling both-unmarked
endpoints before the missing-control fallback and retained the marked-state
guards. The final 23-test batch independently passed against that correction;
the historical 162/163 result above is preserved to show how the defect was found.

Reproduce the final targeted verification from the repository root:

```sh
MX_REPLAY_METRICS=1 npx vitest run tests/motocross-dynamics-replay.test.ts tests/motocross-motion-boundary.test.ts tests/motocross-foot-boundary.test.ts
npx eslint tests/motocross-dynamics-replay.test.ts
npx prettier tests/motocross-dynamics-replay.test.ts --check
```

## Limits

This is headless numerical and real Three.js rig execution, with a stub canvas
context for material construction. It does not render pixels or demonstrate
physical GPU performance. The test does not certify whole-course rider skill,
real-bike calibration, long-session header precision, every suspension contact
phase, or high-detail mesh clearance; those are separate assignments. Compact
replay stores a subset of complete world snapshots, so assertions concern its
retained motion fields and reconstructed rig poses, not omitted world channels.
