# Agent 07 — player MX landing momentum

Date: 2026-11-25. Wave 2 implementation of the P1 touchdown-energy finding in [01-contact-audit.md](01-contact-audit.md).

## Change and ownership

Changed only the player touchdown speed conversion in `src/simulation/offroad/dirt-bike-vehicle.ts`, added `tests/motocross-landing-momentum.test.ts`, and wrote this report. No commits, pushes, installs, npm hooks, version changes, model/character/geometry/material/venue/environment edits, contact-solver edits, or modifications to existing tests.

The player MX transition now preserves its post-contact physical horizontal velocity. It converts that velocity into the existing grounded speed convention with:

```ts
const along = this.playerMotocross
  ? this.flightSpeed / Math.cos(this.roadPitch)
  : this.flightSpeed * Math.cos(slopeAt) + this.vy * Math.sin(slopeAt);
```

The non-player expression is unchanged. `step()` enables `playerMotocross` only for an actual ridden MX250/MX450 on a motocross/supercross course when AI control is inactive. The separate riderless impact branch is unchanged.

## Defect and production evidence

In flight, `flightSpeed` is horizontal forward speed. On the ground, the adapter's stored `d.speed` is a slope-relative speed: both horizontal displacement and `writeBody()`'s published horizontal velocity use `d.speed * cos(roadPitch)`.

Before this change, first contact set `d.speed = flightSpeed*cos(slopeAt) + vy*sin(slopeAt)` after compliant suspension forces had already advanced `vy`. It retained that vertical velocity. A downward velocity on a downslope was consequently added to forward speed without removing its vertical component. The error was a finite transition discontinuity; decreasing the integration timestep did not remove it.

With the corrected conversion, `d.speed*cos(roadPitch) = flightSpeed`. Suspension/gravity integration continues to determine vertical velocity. If a deep-stop normal impulse has already changed `flightSpeed`, this updated value survives touchdown; using the earlier `incomingForward` snapshot instead would incorrectly erase the impulse. The existing `landingTyreVelocity()` operation then rotates forward and lateral components into the landed tyre axes, preserving the world vector. `airYawRate` continues to transfer to `mxYawRate`; player wheel spins remain unchanged by the transition.

The production call path is:

1. `DirtBikeVehicle.step()` selects the player MX branch and calls `flight()` while airborne.
2. `flight()` integrates horizontal drag and travel.
3. `step()` calls `writeBody(track, dt)`.
4. `writeBody()` samples the two real contact positions, updates `roadPitch`, and calls the production private `vertical(dt)` method.
5. `vertical()` applies any hard-stop impulse, integrates compliant heave/pitch forces, and commits touchdown.
6. `writeBody()` publishes the resulting world velocity from the grounded speed convention and committed heading.

The new suite exercises both `vertical()` directly for isolated conservation diagnostics and the public `step()` caller on sampled planar terrain. No alternative touchdown implementation or production method mock is used. Only the terrain samples are replaced in the public-step fixtures; venue files remain untouched.

## Reproduction before and after

Re-ran the exact MX450 diagnostic described in report 01: mass 184.5 kg, both tyres compressed 0.01 m, horizontal speed 10 m/s, vertical speed −8 m/s, and `dt = 1e-8`. No contact projection or deep-stop impulse is active. Incoming translational energy is 15,129 J.

| Plane grade | Original horizontal speed (m/s) | Original energy change (J) | Corrected horizontal speed (m/s) | Corrected energy change (J) |
| --- | ---: | ---: | ---: | ---: |
| −0.3 | 11.329979672015256 | +2616.9882944056735 | 10 | −0.0002373180559516186 |
| 0 | 10 | −0.0002847690357157262 | 10 | −0.0002847690357157262 |
| +0.3 | 6.944181174004195 | −4776.552897286765 | 10 | −0.0003106513904640451 |

The small corrected energy changes are the finite suspension/gravity update. The measured vertical velocities are unchanged by the patch: respectively −7.999999839215407, −7.999999807067046, and −7.999999789531577 m/s. The downslope's original +17.2978% energy discontinuity is removed, and the corresponding artificial uphill loss is removed as well.

Reproduction command, run from the checkout root:

```sh
node --no-warnings --experimental-transform-types --input-type=module <<'NODE'
import { DirtBikeVehicle } from './src/simulation/offroad/dirt-bike-vehicle.ts';
import { MX_450 } from './src/simulation/offroad/dirt-bikes.ts';
import { DEFAULT_SETUP } from './src/simulation/config.ts';
import { factoryBikeSag } from './src/simulation/offroad/suspension-geometry.ts';
const bs = MX_450.bike, L = MX_450.spec.wheelbase;
const sag = factoryBikeSag(MX_450);
const HF = bs.cgHeight + sag.fork, HR = bs.cgHeight + sag.shock;
for (const grade of [-0.3, 0, 0.3]) {
  const bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, 'raw', MX_450);
  const d = bike.dynamics;
  d.mass = MX_450.spec.dryMass + bs.fuel;
  d.speed = 10; d.heading = 0;
  bike.playerMotocross = true; bike.airborne = true;
  bike.flightSpeed = 10; bike.vy = -8; bike.airTime = 0.5;
  bike.roadPitch = Math.asin(grade);
  bike.pitch = Math.asin(L * grade / Math.hypot(L, HF - HR))
    + Math.atan2(HF - HR, L);
  bike.cgY = -bs.cgToRear * grade + bs.cgToRear * Math.sin(bike.pitch)
    + HR * Math.cos(bike.pitch) - 0.01;
  for (const [i, reach] of [[0, bs.cgToFront], [2, -bs.cgToRear]]) {
    bike.contacts[i].height = grade * reach;
    bike.contacts[i].normal.set(0, 1, -grade).normalize();
  }
  const before = 0.5 * d.mass * (bike.flightSpeed ** 2 + bike.vy ** 2);
  bike.vertical(1e-8);
  const horizontal = d.speed * Math.cos(bike.roadPitch);
  const after = 0.5 * d.mass * (horizontal ** 2 + bike.vy ** 2);
  console.log({ grade, before, after, delta: after - before, horizontal,
    vertical: bike.vy, projected: bike.projectedContact, grounded: !bike.airborne });
}
NODE
```

## Regression coverage

The 11 new parameterized tests execute 393 scenarios:

| Cases | Coverage |
| ---: | --- |
| 108 | MX250 and MX450; grades −0.3/0/+0.3; front-only, rear-only, and both tyres; timesteps 1/120, 1/240, 1/480, 1e−4, 1e−6, 1e−8 s. Check continuous world horizontal velocity, the integrated vertical force response, energy changes proportional to dt, and unchanged wheel spin. |
| 144 | Both MX models; the same three grades; cross-grades ±0.35; yaw ±0.5 rad; three world headings; incoming side speeds ±2 m/s. Check world momentum, yaw-rate handoff, incoming normal-speed verdict, and rotor continuity. |
| 24 | Both MX models; grades ±0.3; cross-grade 0.25; yaw ±0.35; deep front, deep rear, and both tyres. Infer the actual normal impulse from vertical momentum after removing the compliant/gravity increment, then independently predict both horizontal components. Total translational/pitch/yaw energy must decrease. |
| 9 | MX250/MX450/SM450 with `playerMotocross = false`. Verify the unchanged non-player tangential conversion and wheel-speed reset. |
| 108 | Public `step()` on sampled terrain with both MX models, grades −0.3/0/+0.3, cross-grades ±0.25, yaw −0.35/0/+0.35, and 120/240/480 Hz. Verify real player gating, contact, published X/Z velocities after airborne drag, and spin state. |

The worker fixed clock defaults to 1/120 s (`src/workers/fixed-step-clock.ts`); the vehicle `MAX_SUBSTEP` is 1/240 s (`src/simulation/vehicle.ts`). The suite includes both, plus a halved physical substep and the near-zero timestep diagnostic.

### Exact test results

Before modifying production code:

```sh
node node_modules/vitest/vitest.mjs run tests/motocross-landing-momentum.test.ts
```

Result: **8 failed, 3 passed**. All eight player parameterized tests failed at the momentum invariant; all three non-player preservation tests passed. This independently exposed the compliant, yawed, deep-stop, and public-caller defects before the fix.

After modifying production code, the same command passed **11/11**. Final focused validation used:

```sh
node node_modules/vitest/vitest.mjs run tests/motocross-landing-momentum.test.ts tests/motocross-contact-impulse.test.ts tests/motocross-riding.test.ts
node node_modules/vitest/vitest.mjs run tests/motocross-wheel-pickup.test.ts tests/motocross-landing-prediction.test.ts
```

Results: **41/41** across the first three files, then **23/23** across the remaining two; **64/64 tests in five files**. Existing surveyed landing, wheel-pickup, replay, yaw, AI-forecast and supermoto-preservation assertions remain unchanged. `git diff --check` for the owned production/test paths also passed.

## Residual risks and integration notes

- The player's physically correct speed after a sloped landing differs from the old calibrated trajectory. Agent 08's concurrent steering-authority work exposed full-ridden-lap failures in the combined tree and one Valley Ridge failure with only its authority factor bypassed. Root was informed and assigned the downstream handling/control investigation to the integration wave. This report does not claim full-lap preservation; the focused invariants above remain required, and no lap assertion was relaxed.
- The road-angle `asin` versus `atan2` issue, compliant pitch-work inconsistency, final-pose publication, and coupled hard-stop solver findings in report 01 are separate owners' work. This correction divides by the same `cos(roadPitch)` the adapter actually uses to publish speed, so it is compatible with a later deliberate road-angle correction.
- AI, supermoto, and riderless touchdown retain their previous conversion. This preserves their calibration and leaves the old reduced impact model outside this player-MX fix.
- The existing nonnegative forward-speed clamp is retained. Tests cover forward motocross touchdowns with meaningful sideways/yaw velocity, not reverse travel or a side velocity large enough to demand negative forward speed in the landed tyre frame.
- The tests establish correct touchdown momentum conversion and the preservation of normal impulse response. They do not assert global energy conservation for every other approximation in the sprung/contact model.

Adapter ownership released to root after successful focused validation; subsequent agents may edit other sections of the shared file.
