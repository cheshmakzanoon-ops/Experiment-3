# Agent 01 — contact/suspension audit

Date: 2026-11-25. Read-only production audit of checkout `f3b39eb` (initial tree clean). No production changes, installs, builds, npm hooks, or commits. Diagnostics below use direct Node imports of existing TypeScript only.

## Priorities and ownership

| Priority | Finding | Recommended owner/files |
| --- | --- | --- |
| **P1** | Compliant touchdown can create substantial translational energy on a downslope. | One adapter contact owner: `src/simulation/offroad/dirt-bike-vehicle.ts`; a new dynamics-only `tests/motocross-landing-momentum.test.ts`. Coordinate with the pending hard-stop/pose owner. |
| **P2** | Ground pitch uses `asin` with a horizontal contact span, overstating steep slopes. | Same adapter owner, line 1741; `tests/motocross-ground-pitch.test.ts`. Keep terrain, models, geometry assets and materials untouched. |
| **P2, investigate before changing** | Compliant spring pitch torque is inconsistent with its own compression Jacobian; hard-stop and compliant forces use different pitch arms. | Same adapter owner, lines 1268–1269, 1339–1346, 1380–1381; new dynamics-only virtual-work regression. This is a solver issue and needs a deliberate reduced-model decision. |
| **P2 validation** | Jump calibration rig always runs the AI path and cannot protect the player's independent MX solver. | Separate test/rig owner: `src/simulation/offroad/jump-rig.ts` and `tests/motocross-contact-traction.test.ts` or a new player jump regression. Prefer adding a player rig rather than changing surveyed AI defaults. |

## 1. Confirmed P1: first contact converts velocity twice

At `dirt-bike-vehicle.ts:1450–1451`, touchdown assigns:

```ts
const along = this.flightSpeed * Math.cos(slopeAt) + this.vy * Math.sin(slopeAt);
d.speed = Math.max(0, along);
```

Vertical speed has just been advanced by compliant forces (1382) and is retained. Grounded physical horizontal speed is then `d.speed * Math.cos(this.roadPitch)` (1768–1774). Thus the tangential projection introduces part of the incoming downward velocity into horizontal velocity while retaining the downward component. This happens without any hard-stop impulse, and does not tend to zero with timestep.

**Measured direct production reproduction:** MX450, both contacts compressed 0.01 m, plane grade −0.3, incoming horizontal 10 m/s, `vy = −8 m/s`, `dt = 1e−8`. No deep projection is active. Translational kinetic energy rises **15,129 → 17,745.988294 J (+17.2978%)**. Horizontal speed rises **10 → 11.329979672 m/s** while vertical speed remains **−7.999999839 m/s**. Level-ground control changes energy by only −0.000285 J; the +0.3 uphill case loses 4,776.553 J through the same discontinuity.

Run from the repository root:

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
  bike.pitch = Math.asin(L * grade / Math.hypot(L, HF - HR)) + Math.atan2(HF - HR, L);
  bike.cgY = -bs.cgToRear * grade + bs.cgToRear * Math.sin(bike.pitch)
    + HR * Math.cos(bike.pitch) - 0.01;
  for (const [i, reach] of [[0, bs.cgToFront], [2, -bs.cgToRear]]) {
    bike.contacts[i].height = grade * reach;
    bike.contacts[i].normal.set(0, 1, -grade).normalize();
  }
  const before = 0.5 * d.mass * (bike.flightSpeed ** 2 + bike.vy ** 2);
  bike.vertical(1e-8); // JS diagnostic deliberately invokes the existing private TS method.
  const horizontal = d.speed * Math.cos(bike.roadPitch);
  const after = 0.5 * d.mass * (horizontal ** 2 + bike.vy ** 2);
  console.log({ grade, before, after, delta: after - before,
    horizontal, vertical: bike.vy, grounded: !bike.airborne });
}
NODE
```

**Fix direction:** preserve the physical horizontal velocity across the air/ground state change, converting only the stored speed units using the grounded cosine. Keep spring/normal impulses responsible for actual momentum response. If a tangent projection is intentionally required, project the entire physical velocity once and account for the removed normal component; do not keep its original vertical component. Preserve yaw-basis rotation and post-hard-stop momentum. Consider scoping the first change to player MX to avoid silently recalibrating surveyed AI/supermoto.

**Regression:** both MX models; level/up/down slopes; compliant one- and two-tyre contacts; yawed landing; deep-stop control; dt→0 continuity of world velocity and energy. Verify results at real worker timesteps too. Existing `motocross-contact-impulse.test.ts` checks the pure impulse helper, so it does not cover this adapter transition.

## 2. Confirmed geometric inconsistency: secant slope angle

`writeBody()` samples front/rear points a **fixed horizontal** `cgToFront + cgToRear = L` apart (1730–1731), then sets `roadPitch = asin((front.y - rear.y) / L)` (1741). For these points the terrain chord angle is `atan2(heightDifference, L)`. `asin` is appropriate only if L were the full sloping span.

On a plane of grade 0.6, current angle is 0.643501 rad versus 0.540420 rad (+5.906°). Consequently the horizontal speed factor is 0.8 instead of 0.857493, and the ground gravity term uses 0.6 G instead of 0.514496 G. This angle is consumed by `d.slope` (506), displacement projection (659–661), vertical approach speed (1285), touchdown conversion and published velocity (1768).

**Fix/test:** compute the terrain chord angle from its actual horizontal span, retaining any separately justified safety limit. A synthetic plane test should check angle, world displacement and uphill gravity against analytical values for both travel directions. Do not alter terrain data or model geometry. Keep the sprung-pose inverse-sine equation in `settlePose()` separate: that solves a different, rotated free-wheel geometry equation.

## 3. Force/kinematics audit item: compliant pitch arms differ

Compression uses `freeF = cgY + fa*sin(pitch) − HF*cos(pitch)` and the analogous rear equation (1268–1271). Therefore its pitch derivatives are `fa*cos + HF*sin` and `−ra*cos + HR*sin`, which correctly appear in hard-stop mobility (1311–1312) and compression-rate evaluation (1339–1346). Compliant torque instead uses only `(FF*fa − FR*ra)*cos` (1381).

For MX450 at pitch 0.3 rad, equal 0.08 m compression, and spring-only forces 869.646 N / 906.652 N, current torque is **−9.192 Nm**, whereas virtual work from the implemented compression functions yields **+484.859 Nm**; the omitted term is **494.051 Nm**. At ±0.5 rad it is ±801.504 Nm. This proves an internal work inconsistency; it does not by itself establish which reduced geometry/force convention the project should retain.

**Next step:** agree a single contact Jacobian for compliant force and hard-stop impulse, then check finite-difference spring potential work and energy on an unpowered sloped chassis with damping disabled. Avoid a blind torque-only retune: the model also samples fixed horizontal contact reaches, so its intended approximation should be explicit.

## 4. Rig blind spot

`jump-rig.ts:rigBike()` always calls `bike.aiControlled(1e9)`. `DirtBikeVehicle.step()` only enables `playerMotocross` when `!ai` (448–450), and `stepMotocrossGround()` is reached only in that mode (553 onward). Therefore `jumpRun`, `rollRun` and `standingStart` preserve the surveyed AI path but cannot demonstrate player MX contact realism. Existing player-specific contact tests are valuable; extend them with complete jumps and the transition invariants above.

## Previously reported fixes: absent in inspected base

- `dirt-bike-vehicle.ts:1308–1333` still performs one sequential front-then-rear hard-stop pass. The pure impulse tests do not check a coupled two-contact solve.
- `dirt-bike-vehicle.ts:1410–1411` still publishes `cF/cR` calculated before the 1400–1405 heave/pitch integration. This matches the reported final-pose publication task.
- Do not duplicate these owners' work. Recheck their eventual changes against the landing-energy case, which occurs outside the deep-contact branch.

`contact-impulse.ts` itself has explicit energy/momentum tests for valid positive mass/inertia, including bank/yaw. No additional helper defect was established in this pass. `suspension-geometry.ts` is not a recommended production edit for these findings.
