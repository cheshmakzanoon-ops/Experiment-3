# Assignment 36 — Motocross recording and deterministic state contracts

Wave 6; 25 November 2026. Independent review of the accepted actuator,
recovery, contact-frame, wheel-motion and cross-slope changes described in
reports 19, 23, 25, 29, 30 and 32.

## Result and ownership

No production lifecycle or decoder defect was found in the reviewed source.
No production change was made. Added
`tests/motocross-recovery-replay.test.ts`, with four public-input regressions
covering both motocross bikes on both motocross venues.

The executed focused groups passed **321 distinct tests across 14 files**.
The unchanged preservation runner also passed **all five non-MX cases with
zero snapshot mismatches** against the saved physics-39 baseline. The current
session physics identity is **41**; the presentation protocol remains
**17**, with **331 floats per entrant**.

The new test and this report are the only deliverable changes owned by this
assignment. No model, character, asset, authored environment, venue, vehicle
specification or production renderer was edited. No dependency installation,
npm lifecycle hook, full-repository typecheck, child agent, git mutation,
commit or push was performed.

## Actuator lifetime audit

`Bike.assistedDriveForce`, `frontBrakeAssistLimit` and
`rearBrakeAssistLimit` are derived outputs of one valid core physics step.
They are not a reconstructed control input and are not presentation protocol
fields.

- Each valid `Bike.step()` clears all three before its recovery early return.
  `fall()` also clears all three immediately.
- The ridden grounded motocross adapter consumes the exact drive force and
  the absolute brake ceilings synchronously after that same core step, and
  only if the bike remains riding. It does not reconstruct these quantities
  from intervention telemetry or net tyre force.
- The flight path does not consume them. Recovery enters the clearing core
  path and never invokes the ridden ground actuator solve.
- A placement, a tyre replacement or an immediately observed restart can
  leave an old derived output readable until the next valid core step. This
  is not an observed stale-command force leak: neither serialization nor an
  intervening active solver reads it as a pending actuator command. The next
  grounded ridden consumer follows a fresh core publication. No reset was
  added merely to change that unconsumed observation.
- `Infinity` is the documented absence of a brake-aid ceiling. It stays in
  the internal actuator contract; it is not emitted into a Float32 snapshot
  field. Unsupported rotor handling remains owned by the existing ground
  solver contract.

The drive- and brake-budget suites independently verify exact small commands,
final aid budgets, recovery/fall clearing, grounded rotor limits and the
unsupported-wheel behavior. The new complete-recovery tests hold nonzero
throttle, both brakes and rider weight while the bike is down and require
all three derived actuator outputs to remain exactly zero whenever it is
not riding.

## Recovery, placement and control ownership

The motocross recovery deadline is computed from finite gather, push, turn,
height-travel and seat-approach costs. Completion remains conditional on
actual rider position and heading; the old five-second limit cannot complete
a motocross push or bypass the seat handoff. Its target and transient
gathering state are deterministically reconstructed from the simulation and
sampled terrain, rather than saved as presentation state.

The existing 27-case remount-handoff and 18-case remount-continuity suites
passed, including long authored-course pushes, steep recovery paths, bounded
rider XYZ motion, bounded bike push/yaw, and the first mounted samples. The
13-case contact-reset suite passed placement, free placement, restart and
assisted-remount boundaries, including invalidation of a genuinely pending
hard-landing verdict. Those tests retain crash history and thermal/winding
history while clearing abandoned contact and landing state.

AI ownership is selected before the contact-mode conversion; the prior
horizontal velocity is preserved through the road-pitch convention change.
The input journal inspects the currently applied controls when deciding
whether a held input may be deduplicated. The existing engine flashback-state
suite passed its real MX450 AI handback, hidden-state continuation and
negative control that deliberately removes the handback write. Therefore a
held player command is not lost merely because an AI interval changed the
mutable controls in between.

At the worker boundary, a new session constructs a new `Simulation` and a
new journal. Pausing applies and records neutral controls without advancing
the simulation. Repeated frame publication or presentation sampling does
not run another dynamics step. The reviewed restart and recovery changes
do not add an external event that would be missing from the input journal.

## New real recovery replay coverage

Each new case begins from the ordinary seeded practice constructor, using
Raw controls. A full-throttle launch with backward rider weight produces a
natural loop-out. The test does not place a bike, force a crash, set recovery
state, or write private dynamics. It records every accepted control through
`applyLoggedInput()` at the normal 60 Hz input cadence and runs the normal
120 Hz simulation with its internal physics substeps.

The four cases then check:

1. A real positive drive command precedes one actual crash, followed by
   separated, remount and resumed riding states. The remount budget is finite
   and contains the observed recovery duration.
2. Full binary presentation frames and unrounded state reconstruct exactly
   at regular checkpoints and both sides of state/control boundaries. The
   unrounded comparison includes all three actuator outputs, chassis motion,
   rider XYZ/heading, body pose/rate, wheel speeds, recovery time and controls.
3. Resimulation uses irregular step caps together with a wall-time work
   budget. Slicing cannot skip a tick or change the result. Reconstructed
   terrain hashes also agree.
4. A flashback ending halfway through remount reconstructs the recovery
   state. Repeated presentation queries of that paused snapshot leave the
   simulation and derived commands unchanged.
5. Truncating the journal and applying a different drive/brake/body sequence
   during recovery produces genuinely different ridden snapshots after
   remount. Replaying that branch produces the same complete state.
6. An additional 48 ticks with real control reversals reproduce exactly after
   the reconstructed branch, checking latent state not listed in the capture.

The prior ten-case motocross dynamics-replay suite also passed. It covers
manual rider reversals, accepted rapid gear changes, flight branches,
recorded posture and boot derivatives, interior recording seeks, wall-time
independence and repeated pause sampling. Agent 35 confirmed that no new
pose/pose-rate candidate would be retained, so these observations apply to
its released, unchanged rider-weight source.

## Snapshot and recording contract

No reviewed change requires an added presentation field or a new decoder
layout. The identity distinction is deliberate: changed simulation
trajectories use physics version 41, while their recorded field layout
continues to use protocol 17. The 110 identity tests passed, including older
physics-category rejection despite unchanged vehicle definition hashes.

The wheel sampler's phase and interior angular velocity come from the same
selected curve for ridden knobby MX250/MX450 snapshots. Its endpoint
contract preserves the measured endpoint values. Repeated identical
snapshots preserve the measured angular velocity; a distinct nonincreasing
clock does not authorize an invented derivative. Teleport, vehicle/root
convention and tyre-service boundaries select the appropriate recorded
state. These distinctions are covered by the 40 wheel-motion-consistency
tests and six winding-recording tests, all of which passed.

The optional contact/presentation readers also passed their unknown-marker,
invalid-data, legacy-unmarked, replacement-boundary and source-immutability
checks. The actual rider/boot recording test explicitly clears the optional
markers and verifies the established legacy linear fallback. No protocol
offset, global clock representation or long-session format change was made.

The final-contact-frame and cross-slope work use deterministic sampled state
and per-call arithmetic; neither introduces an unjournaled random source or
an external clock. The seven final-contact-frame tests passed alongside the
new replay tests. Energy/passivity claims for the cross-slope solver remain
those of report 32, including its separately disclosed tiny yaw-damper
limitation; this recording audit does not broaden those claims.

## Executed verification

All commands below were run from the repository root using installed direct
tool entry points and `--maxWorkers=1` for Vitest.

```sh
node node_modules/vitest/vitest.mjs run \
  tests/motocross-dynamics-replay.test.ts \
  tests/wheel-winding-recording.test.ts \
  tests/motocross-wheel-motion-consistency.test.ts \
  tests/motocross-contact-reset.test.ts \
  tests/session-identity.test.ts --maxWorkers=1
```

**179/179 passed**, five files, 22.22 seconds.

```sh
node node_modules/vitest/vitest.mjs run \
  tests/wheel-contact-recording.test.ts \
  tests/snapshot-interpolation.test.ts \
  tests/motocross-remount-handoff.test.ts \
  tests/motocross-remount-continuity.test.ts --maxWorkers=1
```

**75/75 passed**, four files, 11.76 seconds.

```sh
node node_modules/vitest/vitest.mjs run \
  tests/motocross-recovery-replay.test.ts \
  tests/engine-flashback-state.test.ts --maxWorkers=1
```

**14/14 passed**, two files, 14.70 seconds.

```sh
node node_modules/vitest/vitest.mjs run \
  tests/motocross-recovery-replay.test.ts \
  tests/motocross-drive-budget.test.ts \
  tests/motocross-brake-budget.test.ts \
  tests/motocross-final-contact-frame.test.ts --maxWorkers=1
```

**57/57 passed**, four files, 9.23 seconds. This final run includes the added
assertion that the changed recovery branch really changes subsequent ridden
motion. Four tests repeat the preceding group; the distinct total is 321.

```sh
node --max-old-space-size=384 --experimental-transform-types \
  scripts/bench/mx-dynamics-preservation.ts \
  --compare docs/engine/mx-dynamics-2026-11-25/evidence/non-mx-baseline.json
```

**Pass**, five cases, empty mismatch list; baseline physics 39/current 41.
The runner and baseline were not edited.

```sh
node node_modules/prettier/bin/prettier.cjs --write \
  tests/motocross-recovery-replay.test.ts
node node_modules/eslint/bin/eslint.js tests/motocross-recovery-replay.test.ts
node --max-old-space-size=512 node_modules/typescript/bin/tsc \
  --project test-results/agent36-tsconfig.json
```

Formatting reported unchanged, focused ESLint produced no diagnostics, and
the strict targeted TypeScript check passed. The temporary configuration
extends the repository configuration and includes only the new test plus its
imported source graph. No whole-repository compiler run was used.

## Observed source identity and limits

These SHA256 values were observed after the focused final checks. The core,
adapter, ground solver, rider-weight, protocol and recording files retained
the same values throughout this assignment's validation.

| File | SHA256 |
| --- | --- |
| `src/simulation/bike.ts` | `abcd7fe3b0e1432073c42890549974a03821d0829c2f3bfe6c3cf5f54da0d7b8` |
| `src/simulation/bike-vehicle.ts` | `ba916a4ab1a6830235fbfcf7f85885cba6dd9b71816eefff49fdf9f74d58a0ff` |
| `src/simulation/offroad/dirt-bike-vehicle.ts` | `7fa932378aa37f4e93a51900e3e40f3aafa16a2c87f1a65537f5799fa31fa272` |
| `src/simulation/offroad/mx-ground-physics.ts` | `68b04234548a2b037f4769d38343c26ec712a61fd9261fd6dac44641c81ca4e3` |
| `src/simulation/offroad/rider-weight.ts` | `5027085c4bb2b192d89a0368d56ca9296b34ed5130e936db0741eed30304ad96` |
| `src/simulation/offroad/contact-impulse.ts` | `825d280cfd4c1769db8fee0abcdfa91989f4c6b73ac502e120f59f1061afa28e` |
| `src/rendering/wheel-pose.ts` | `c3c224018a7b3586e73113e873514f1cffd715306516070804b22b47ee2c9207` |
| `src/rendering/frame-state.ts` | `3f3a05f7d07df1c02eacd9d8f6817edeee1005ae0a39161ae7f65c7ef8b5c2ec` |
| `src/simulation/protocol.ts` | `eb17339446450136412f774ae2a38babcc45e7a3b2cafab638f70bf809047e0a` |
| `src/core/session-identity.ts` | `4184b2aa573b674137f15818866407c7193d2bd70307249bb92f36ea87fbaeba` |
| `src/core/flashback.ts` | `9f9e9802beb8a0cd9685b522de0a1681b8259947673886084d8190bbd55c7f2f` |
| `scripts/bench/mx-dynamics-preservation.ts` | `b9bb64bb3bf0c3f33aaae2c1b894b3d783f496627881595b289d45fd6f1f0417` |
| `docs/engine/mx-dynamics-2026-11-25/evidence/non-mx-baseline.json` | `f719ad80a6dccd33d33e7f7625d2d9f2f98c4124f9d8c079f8210b5c7044ba5c` |
| `tests/motocross-recovery-replay.test.ts` | `7e8d40351f80343adc6ee737da5140717425be47548dcef0ab26846942c2ba82` |

This is finite-duration deterministic and recording coverage on the reviewed
source. It is not a cross-JavaScript-runtime guarantee, a long-session clock
redesign, or proof that every possible physical trajectory is correct. The
new command-only traces exercise ordinary natural recovery; the existing
direct remount suites separately exercise long destination paths and height
variation.

Agent 33's subsequent supported-contact refinement was still an unretained
candidate when this report was released. Its eventual public-step lifecycle,
interval-mean forces/power and replay behavior require the planned independent
assignment-37 review. The two real-input replay suites are appropriate
integration gates for that later source. Test and report ownership is
released to root; no further optional checks are pending here.
