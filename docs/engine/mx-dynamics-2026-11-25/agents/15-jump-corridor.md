# Agent 15 — jump corridor candidate and regression boundary

Date: 2026-11-25. Checkout: `/home/agent/motobound-579b454ae846`, branch `main`.

## Release status

**Candidate only; not ready to land.** The new causal regressions pass, but four
previously passing BARN DOUBLE clear cases now roll, and both unchanged ridden
two-lap gates remain red. Root requested release for checkpoint and integration
of independently published upstream changes; no further tuning was attempted.

Owned edits are limited to:

- `src/simulation/offroad/ai.ts`
- `tests/motocross-jump-corridor.test.ts`
- This report.

No commits, pushes, package installation, npm hooks, course/terrain/venue/model
changes, crash tolerance changes, or edits to existing assertions were made.

## Confirmed defect and bounded implementation

Read agent 14's report and the saved root `laps.json`. The recorded Arena
approach holds lateral −5.5804 m while becoming parallel to the straight and
retaining the centre-profile clear speed. The underlying terrain fades its
jump profile beyond groomed half-width + 0.4 m; the wider legal tape allowance
does not establish a valid full-height jump face.

The candidate adds `motocrossJumpCorridor()` and checks it when the existing
braking-distance decision locks a clear. An eligible projection covers the
face, lip, and near/centre/far surveyed landing zone. It reserves both axle
reaches and each tyre construction's half-width. It rejects an across-face
heading, parallel shoulder travel, and transverse slide that leaves the band.
The projection accounts for the existing 1.2-second approach handoff before
extending the departure heading through flight; the assumed turn is bounded by
the current grip and the governor's half-lean input. It assumes no slide decay.
This is a planner forecast, not a contact solver or proof of execution.

The existing roll and abort state is used when a speed-feasible clear has no
valid corridor. A locked plan is reconsidered only while the existing braking
window remains open. `jumpHoldSpeed`, `ROLL_SPEED`, and all takeoff gains remain
unchanged.

`governJump()` now has a bounded correction toward the existing held feature
lane, blended into the existing square-to-lip command with
`motocrossJumpApproachSteer()`. The final candidate applies the added lane
correction only while its projected corridor is missing; a valid corridor keeps
the calibrated square command. The governor's 28-metre activation distance and
speed-control gains remain unchanged.

## Targeted verification

Executed directly, without package hooks:

```sh
./node_modules/.bin/vitest run tests/motocross-jump-corridor.test.ts tests/motocross-ai.test.ts tests/motocross-forgiving-handling.test.ts --reporter=dot
```

Final result: **64 passed, 6 failed; 24.30 seconds**.

| Gate | Result |
| --- | --- |
| New jump corridor regressions | 10/10 passed |
| Existing motocross AI suite | 38/42 passed |
| Existing forgiving handling / ridden-lap suite | 16/18 passed |

New tests cover mirrored legal-tape-but-faded shoulders, front/rear footprint
and tread clearance, across-face headings, transverse slide, bounded nonzero
inward steering from a parallel shoulder, and physical inward acquisition of
the full-profile band with a lower rolling speed when the clear is rejected.
The physical cases start 24 m before the Arena finish face at its production
clear speed; both sides reach the face inside 3.5 m lateral, below 10 m/s, with
one abort and no preceding fall. They do not claim that the subsequent rolled
triple or a full lap is clean.

### Existing AI regressions

Four BARN DOUBLE cases with the parked rider safely at lateral 11 m now fail
their original `longestFlight > 12 m` assertion. Their histories are `none`,
`other landing`, `grip fall`, and `recovered nose landing`. All four produce
3.401888853 m maximum flight in the final run. The other conditions in these
tests reach their assertions successfully, including no crash and progress
past the feature.

A diagnostic of the preceding forecast iteration captured rejection at
14.198 m before the face, lateral −1.077 m, speed 11.716 m/s, heading 0.568 rad
against the face, and lean −0.231 rad. The footprint/heading forecast rejects
that state, but the old controller's calibrated berm exit can clear the jump.
This establishes a real compatibility problem in the approach/commitment
policy. It is not evidence that the surveyed width should be expanded or that
the old successful trajectory was necessarily outside the full profile.

The next change needs to preserve or properly predict the existing supported
berm-exit recovery before the commitment point. Do not make the eligibility
threshold permissive merely to satisfy this seed. The earlier tangent-only
forecast was also too conservative because it extended the initial ground
heading unchanged through flight.

### Unchanged ridden-lap gates

Both circuits completed two laps, then failed the original zero-crash assertion.

| Circuit | Final candidate first/remaining crash causes |
| --- | --- |
| Valley Ridge | `grip-lowside` at s577.742765 / t66.325000; s583.574031 / t154.887500; s707.714588 / t172.145833 |
| Arena Nord | `crash-rear` at s458.979333 / t68.304167; s458.983472 / t155.170833 |

The original saved/replicated failures were Valley's `crash-front` at s612.210
plus a later lowside, and Arena's `crash-flat` at s466.921. Their disappearance
in this candidate is **not** a successful integration result: the changed
route/roll decisions introduce different earlier failures. In particular,
rejecting the clear must still produce a physically viable roll through the
whole feature, not merely reach the face at its intended rolling speed.

## Baseline and attribution

Before editing AI, the same existing two-file command produced **58 passed,
2 failed** in 22.29 seconds. All 42 AI cases passed. Both ridden laps failed
with exactly the saved root event locations, despite the adapter fingerprint
already differing from the older trace's source capture.

The contact adapter was concurrently owned by agent 13. The reported test
result belongs to the complete source combination below, not solely to this
AI change. Root also reported an independently published upstream main
`39d9d497880e92801a7d77de6af2639b4186bfcc` with contact and shoulder eligibility
changes; it was not merged by this agent.

Root subsequently forwarded the confirmed intervention torque budget
(`force * (1 - d.intervention)`) in the adapter while this run was already
loaded. These are premerge diagnostic results only; root will rerun the final
gates after reconciliation.

| Source | SHA-256 at final targeted run |
| --- | --- |
| `src/simulation/offroad/ai.ts` | `0497fb5d992b5650e405db3c6be22883878edb4b9cfeef64ac4f15504e226391` |
| `src/simulation/offroad/dirt-bike-vehicle.ts` | `edce8ee6434bb612285d9c2b1e8d2b4c2a52d3f3f6d68465c9a6ef903a0f0aed` |
| `src/simulation/offroad/mx-ground-physics.ts` | `9eb4c94b0455a55d8e35333b5f86163999f497906b5cf1ccf20ac1041c7a1960` |
| `src/simulation/offroad/rider-weight.ts` | `f2395b6adc6bfb80bf5493cec399d0a455e2f6d56da4552f1dc99863253ff1b9` |
| `tests/motocross-jump-corridor.test.ts` | `b896dc98c2dfb3fd6eef59231558993caeb0e49562989ea467efa28c3359f546` |
| Unchanged `tests/motocross-ai.test.ts` | `1920900207b75cca0d15a220aca9e7924f3f2376f1b6b04d9cee5a9752470103` |
| Unchanged `tests/motocross-forgiving-handling.test.ts` | `495119af76deed9cbf3cb4f8f8c889bab2aeb1d5e15c510f64e424adafab29d1` |

AI before this agent's edits:
`9ba826f4d2b0c42d5f98e175ed58a3bdb47a6bae739d29d9a63e6619f2b3b440`.

Ownership is released after this report. Preserve the new causal tests when
revising or rejecting the production candidate; do not weaken the existing
clear or full-lap assertions.
