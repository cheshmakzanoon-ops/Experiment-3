# Agent 10 — coupled unilateral MX suspension stops

## Delivered

Added `coupledHardStopImpulses()` to `src/simulation/offroad/contact-impulse.ts`. It solves the simultaneous front/rear inelastic stop response in constant work, including forward, lateral, vertical, pitch and yaw momentum. The existing `hardStopImpulse()` and `landingNormalSpeed()` implementations are unchanged.

The new helper is ready for the subsequent adapter integration. This change does **not** edit `dirt-bike-vehicle.ts`, change player/AI/supermoto routing, or alter models, geometry, materials, environments or authored vehicle parameters.

Files owned by this task:

- `src/simulation/offroad/contact-impulse.ts`
- `tests/motocross-coupled-stops.test.ts`
- `docs/engine/mx-dynamics-2026-11-25/agents/10-coupled-stops.md`

## Problem established

The current projected-contact loop in `DirtBikeVehicle.vertical()` computes a front stop impulse, applies it, then computes and applies the rear stop impulse. Pitch and yaw coupling mean that the second impulse can make the first stop close again. Changing the processing order changes this intermediate projection.

The focused regression uses a flat pair with mass 184 kg, pitch inertia 43 kg m², front/rear pitch arms +0.82/−0.66 m, incoming vertical velocity −6 m/s and pitch rate +2 rad/s. One existing front/rear pass leaves the front closing faster than 1 m/s. The new simultaneous solve stops both normal motions, preserves tangential/yaw velocity and dissipates the heave/pitch impact energy.

An initially separating bottomed stop can also need a positive impulse after coupling to the other stop. The test with the same flat pair, vertical velocity −1 m/s and pitch rate +2 rad/s establishes this case. Adapter integration must therefore select contacts by bottoming, not by their incoming closing-speed sign.

## Exact public contract

```ts
interface HardStopVelocity {
  horizontal: number; // m/s, in the existing travel frame
  lateral: number;    // m/s, in that same frame
  vertical: number;   // m/s, positive upward
  pitchRate: number;  // rad/s
  yawRate: number;    // rad/s
}

interface HardStopInertia {
  mass: number;         // kg
  pitchInertia: number; // kg m²
  yawInertia: number;   // kg m²
}

interface HardStopContact {
  grade: number;      // forward terrain rise / horizontal metre
  crossGrade: number; // lateral terrain rise / horizontal metre
  lever: number;      // gap change / pitch radian, m/rad
  yawArm: number;     // terrain-height change / yaw radian, m/rad
}

interface HardStopImpulses {
  front: number; // N s, vertical component of the normal impulse
  rear: number;  // N s, vertical component of the normal impulse
}

function coupledHardStopImpulses(
  velocity: Readonly<HardStopVelocity>,
  inertia: Readonly<HardStopInertia>,
  front: Readonly<HardStopContact> | null,
  rear: Readonly<HardStopContact> | null,
  out?: HardStopImpulses,
): HardStopImpulses;
```

All four interfaces are exported. Inputs must be finite, and the three mass/inertia values must be positive. A supplied invalid mass/inertia throws `RangeError` when at least one contact is present. `null` denotes a stop that is not bottomed. Both `null` returns zero impulses. Single-contact behavior matches the existing scalar helper, including lateral/cross-grade/yaw coupling.

The helper leaves its inputs unchanged. It overwrites and returns `out`, including zeroing both fields in the no-contact/separating cases. Passing a reusable `out` gives zero allocations inside the solve. Omitting it creates one result object. There are no arrays, iteration loops, convergence tolerances, restitution terms or timestep inputs.

### Adapter mapping

Within the current `vertical()` projected-contact section, supply the existing values:

| Input | Existing adapter value |
| --- | --- |
| `velocity.horizontal` | `vh` before either impulse |
| `velocity.lateral` | `this.slide` before either impulse |
| `velocity.vertical` | `this.vy` before either impulse |
| `velocity.pitchRate` | `this.pitchRate` before either impulse |
| `velocity.yawRate` | local `yawRate` before either impulse |
| `inertia.mass` | `m` |
| `inertia.pitchInertia` | `a.pitchInertia` |
| `inertia.yawInertia` | `motocrossYawInertia(m, fa, ra)` |
| front contact presence | `cF >= spec.forkTravel` |
| rear contact presence | `cR >= spec.shockTravel` |
| front contact | `{ grade: slope(0), crossGrade: crossSlope(0), lever: fa * cos + HF * sin, yawArm: yawArm(0, fa) }` |
| rear contact | `{ grade: slope(2), crossGrade: crossSlope(2), lever: -ra * cos + HR * sin, yawArm: yawArm(2, -ra) }` |

Call the helper once from the common incoming state. For supplied contacts `f` and `r` and returned impulses `qf` and `qr`, apply their summed changes:

```ts
vh -= (f.grade * qf + r.grade * qr) / m;
this.slide -= (f.crossGrade * qf + r.crossGrade * qr) / m;
this.vy += (qf + qr) / m;
this.pitchRate += (f.lever * qf + r.lever * qr) / a.pitchInertia;
yawRate -= (f.yawArm * qf + r.yawArm * qr) / iz;
```

Omit a missing contact's terms or use its zero impulse. Retain the existing yaw-state publication and forward-speed unit conversion after the impulse application. Avoid recomputing either returned impulse from a state already changed by the other. The integration owner decides whether to enable the helper only for player MX; existing AI/supermoto callers retain the old scalar API unless explicitly changed there.

## Derivation and numerical treatment

Let the generalized velocity be `v = [horizontal, lateral, vertical, pitchRate, yawRate]`, the diagonal generalized mass be `M = diag(m, m, m, Ip, Iy)` and each stop row be:

```text
Ji = [-grade_i, -crossGrade_i, 1, lever_i, -yawArm_i]
ci = -Ji v
```

The row is not normalized to a unit terrain normal. This retains the scalar helper's convention: an impulse `qi` is its vertical linear component, and the full generalized impulse is `Jiᵀ qi`.

For two contacts the effective inverse mass matrix is symmetric:

```text
W = J M⁻¹ Jᵀ = [[a, b], [b, d]]
a = (1 + gf² + sf²) / m + lf² / Ip + yf² / Iy
d = (1 + gr² + sr²) / m + lr² / Ip + yr² / Iy
b = (1 + gf gr + sf sr) / m + lf lr / Ip + yf yr / Iy
```

The unilateral inelastic conditions are `q >= 0`, `Wq - c >= 0` and `qᵀ(Wq - c) = 0`. These respectively prohibit pulling the ground, prohibit closing after the impulse, and keep unloaded/separating stops from receiving an impulse. The helper enumerates the inactive set, the front-only candidate `(cf/a, 0)`, the rear-only candidate `(0, cr/d)`, and the both-active 2×2 solution.

For a single candidate, the unused stop must already be nonclosing after that impulse. Candidate residuals are evaluated through differences of the contact Jacobians, so almost-identical terrain/contact rows do not lose their small active-set decision to subtraction of two large full closing speeds.

For the both-active solution, Cramer's rule gives numerators:

```text
nf = d cf - b cr
nr = a cr - b cf
q = [nf, nr] / (a d - b²)
```

Dividing small numerators independently by a small determinant can corrupt their total near redundancy. Instead, the helper computes the nonnegative impulse ratio `wf = nf/(nf+nr)`, `wr = nr/(nf+nr)` and the combined row `Jbar = wf Jf + wr Jr`. It then obtains the total from the scalar projection `Q = -(Jbar v)/(Jbar M⁻¹ Jbarᵀ)` and returns `[wf Q, wr Q]`. In exact arithmetic this is the same 2×2 solution because the shared determinant cancels in the ratio. In finite precision it also keeps the total impulse on the energy-minimizing point of that positive normal combination. No singular determinant division or iteration is required.

Exactly identical rows have a nonunique individual impulse allocation. Their common scalar impulse is split equally. The contact-swap regression verifies that swapping front and rear swaps the returned impulses without changing the physical result.

For a complementary solution the energy change is:

```text
E_after - E_before = -cᵀq + ½ qᵀWq = -½ qᵀWq <= 0
```

The total-projection form also retains a nonpositive energy change if rounding perturbs the almost-redundant impulse ratio. This is a passive impact solve; position projection and compliant spring/damper work remain the adapter's separate responsibilities.

## Verification

Executed directly, without npm hooks:

```bash
node node_modules/vitest/vitest.mjs run tests/motocross-coupled-stops.test.ts tests/motocross-contact-impulse.test.ts --maxWorkers=1
```

Result: **2 test files passed, 13 tests passed** (10 new, 3 existing). The final run completed in 821 ms.

The new tests cover:

- Flat two-contact momentum balance and elimination of both closing velocities.
- An initially separating stop activated by coupling from the other stop.
- A reproduced sequential-pass first-stop reclosure.
- Two initially closing stops where one impulse correctly leaves the other separating and unloaded.
- Front-only/rear-only agreement with the old helper, all five velocity components, and no-contact output reuse.
- Exact duplicate constraints without double-counting their impulse.
- Nearly duplicate rows, with perturbations from `1e-3` through `1e-12`, including incoming velocities that require both stops and must project to rest.
- Unchanged separating motion, immutable inputs and reusable output identity.
- Invariance under horizontal travel-frame rotation.
- 1,200 seeded physical sweeps across independently sampled front/rear grades and cross-grades, pitched chassis arms, yawed contact arms, incoming translation and rotation, mass and both inertias.

Each property-sweep case applies the returned linear/angular momenta independently and checks finite nonnegative impulses, nonclosing contacts, complementarity, nonincreasing kinetic energy, the inelastic impact-work identity and contact-order symmetry. The test oracle does not contain a second active-set or 2×2 solver.

The standalone helper is verified. Whole-vehicle behavior after switching the projected-contact loop to it remains a required check for the subsequent integration task.
