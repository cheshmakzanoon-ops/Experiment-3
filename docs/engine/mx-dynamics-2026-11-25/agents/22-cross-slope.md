# Agent 22 — Supported motocross cross-slope gravity

Date: 2026-11-25. Wave 4/60. Follow-up to P2 in `02-traction-audit.md`.

## Scope and current result

Added an optional, supported lateral-gravity input to the player-MX ground solver, together with static tyre shear and finite-work accounting. The omitted and exact-zero paths preserve the complete previous result, including its original brake heat, force distribution, steering and yaw arithmetic. The unchanged exact-value steering regression remains a gate.

Root wired the helper into the production adapter and added external acceleration to the roll/inertial comparison. All **22 new cross-slope tests** pass, including both player bikes on mocked low/high-grip planes. The latest owned final run also passed the 13 ground-physics and 5 passivity cases: **40/40 tests**. Three pre-existing real-wheelie trajectory comparisons need integration fixture isolation now that their actual 1% bank generates forces; the precise evidence is retained below rather than reporting a clean broader gate.

Authored files are limited to:

1. `src/simulation/offroad/mx-ground-physics.ts`.
2. `tests/motocross-cross-slope.test.ts`.
3. This report.

The adapter belongs to root and was not edited by this agent. No model, rider asset, material, course, terrain geometry, specification, or existing test assertion was changed. Mocked test planes exist only in memory and are restored in `finally` blocks.

## New interface and adapter mathematics

`MxGroundParameters.lateralGravity?: number` is a signed horizontal acceleration toward the entry heading's left axis, in m/s². It is an external terrain-support contribution in the existing planar model. A nonzero input is ignored if neither axle has positive support. Invalid nonfinite input is rejected.

The exported helper is:

```ts
motocrossLateralGravity(
  heading, mass,
  frontLoad, frontNormal,
  rearLoad, rearNormal,
)
```

Terrain normals must be upward unit normals in world coordinates. With `left = (cos(heading), 0, -sin(heading))`, the helper returns:

```text
sum(max(0, axleVerticalLoad) * normal.y * dot(normal, left)) / mass
```

At static total support `mass*G` on one plane, this is `G * normal.y * dot(normal,left)`, the horizontal projection of downhill tangential gravity. For a plane with lateral grade `b`, it becomes `-G*b/(1+b*b)`. A 30% bank gives about 2.69908 m/s² downhill before tyre resistance.

The current suspension channels are vertical support, not newly introduced normal-force measurements. Projecting each supplied vertical support by `normal.y` gives the corresponding normal contribution in this existing convention. Weighting the two normals with their own actual axle loads prevents a free tyre from contributing terrain support. Dividing by mass, rather than normalizing by total load and multiplying by G, also makes the contribution fade continuously as suspension support vanishes. The helper intentionally does not cap rebound/landing support at static weight.

Root's adapter insertion is:

```ts
lateralGravity: motocrossLateralGravity(
  initialHeading, d.mass,
  this.forceFront, this.contacts[0].normal,
  this.forceRear, this.contacts[2].normal,
),
```

The entry vector remains fixed in the world during the contact step. At relative heading `delta`, it contributes `lateralGravity*sin(delta)` forward and `lateralGravity*cos(delta)` left. Dropping the forward component would alter world direction and external work while the bike yaws.

Two active-only diagnostics are returned:

- `lateralGravityPower`: signed external work divided by dt. It uses the finite midpoint chassis velocity, including both rotating-frame components.
- `endLateralGravity`: the same entry world vector projected onto the returned heading's left axis, exactly `lateralGravity*cos(finalHeading-entryHeading)`.

The existing `lateralAcceleration` and `endLateralAcceleration` remain tyre-only support channels. A roll/inertial comparison uses `endLateralAcceleration + (endLateralGravity ?? 0)`. Without this addition, a correctly held bank would be mistaken for a net lateral acceleration and could acquire phantom roll. This change to the adapter belongs to root.

## Static friction, yaw leverage and combined budget

The existing dynamic brush remains in place. The new path adds the shear preload required to oppose the gravity-induced patch acceleration, using the same planar translation and yaw mobilities as the contact model. In the production lean-coupled branch, the two-contact mobility is:

```text
A_ff = 1/m + frontArm²/Iz
A_rr = 1/m + rearArm²/Iz
A_fr = 1/m - frontArm*rearArm/Iz
```

The preload solves `A*F = -patchGravity`. The non-lean-coupled branch includes the actual front steer projection. With two supported patches on an ordinary straight bank this produces equal-and-opposite gravity support and zero yaw moment. The static force split follows contact geometry; using load shares alone would create a spurious yaw moment whenever the current load split differed from the geometric moment balance.

A lone contact uses its own mobility. It can hold its patch, but cannot cancel both centre motion and yaw. Tests require the resulting centre acceleration and yaw with the correct sign, while the free contact remains exactly force-free and produces no heat.

Each candidate side force is clamped to the tyre's existing remaining circle `sqrt(max(0,(mu*load)²-Fx²))`. The existing supported rolling/camber request then shares that same circle; there is no extra force outside the tyre budget. Drive, brake lock and turning tests cover both lean-coupled and independently steered branches.

## Work and passivity

A static gravity-balancing bias cannot be applied unconditionally to an existing uphill skid: it could push the tyre along its slip and inject energy. The new branch evaluates each patch's finite mechanical work using the actual body impulse and rotor angular travel before lock. It reduces the new preload if either patch would deliver positive work. If gravity itself crosses a very small incoming slip within one microstep and the original pre-step brush bound also needs correction, it reduces the complete contact vector, preserving the combined circle.

The positive-work tolerance is 1e-12 J per patch per internal step, to avoid floating-point noise disturbing an exactly balanced stationary contact. The ordinary path does not enter this work limiter.

The endpoint tyre-support diagnostic also canonicalizes cancellation within `8*Number.EPSILON*max(1,abs(tyreAcceleration),abs(externalAcceleration))` to exactly the opposite external contribution. This is a floating-point equilibrium correction, not a physical acceleration dead band. Its need was demonstrated in integration: a roughly 1e-17 m/s² held-bank residual produced infinitesimal lean/curvature, and the existing `bankSupport()` function used `Math.sign(curvature)` to choose a full berm friction adjustment. Correcting only that roundoff restored the existing rider-weight braking regression unchanged. The public high-grip tests now demand **exactly zero lean, lean rate and curvature** after one second.

`slipPower` for the active path is the nonnegative loss of finite mechanical work. A stationary bank therefore has nonzero shear/utilization and exactly zero soil heat. Rotor travel uses the existing `motorcycleRotorBrakeWork(..., 1, h)` integration, so a stopped wheel cannot acquire continuous rotor work. The brake/engine accounting path remains unchanged.

On the analytic low-grip bank fixture, finite kinetic-energy gain plus reported soil work equals accumulated gravity work. Tests also advance uphill/downhill slips and nonzero yaw one internal step at a time, requiring mechanical energy plus soil heat to remain below prior energy plus external gravity work. The existing yaw damper may remove additional work.

## Coordinate limits retained deliberately

The adapter stores forward speed along the longitudinal slope and slide as horizontal lateral speed. The legacy ground solver otherwise uses a planar Euclidean mass/force metric, and its tyre circles use the existing suspension-load convention. This task does not replace that model with a full 3D tangent metric, reinterpret normal loads, retune tyre coefficients, or redesign suspension gravity.

Accordingly, pure cross-bank projected acceleration and the stated planar work balance are directly verified. On a simultaneous longitudinal grade and bank, exact 3D energy would also contain vertical and mixed forward/lateral terms. That broader metric reconciliation is out of scope, confirmed with root. The existing nonnegative forward-speed constraint also remains.

Source inspection found an adjacent adapter convention: its post-solver `cos(roadPitch)` multiplier scales the complete world displacement, including horizontal slide. This was sent to root and the slope-momentum owner; root deferred that correction to agent 27. This agent did not edit that integration path. A correction must preserve the forward contribution's cosine while leaving the already-horizontal lateral contribution unscaled. The present tests do not claim exact oblique-slope displacement.

## Evidence and verification

Before adapter wiring, the new mocked-plane integration regression reproduced the original defect on both MX-250 and MX-450: after one second at 240 Hz on either 30% bank with mu=0.01, lateral displacement remained exactly zero. The two low-grip assertions were intentionally red; both high-grip stationary assertions and all direct-solver cases passed. No test was skipped or weakened to hide the unwired path.

Direct installed-tool run before adapter integration:

```sh
node_modules/.bin/vitest run tests/motocross-cross-slope.test.ts tests/motocross-ground-physics.test.ts tests/motocross-ground-passivity.test.ts tests/motocross-front-steering-authority.test.ts --maxWorkers=1
```

Result before adding the four public adapter cases: **4 files / 46 tests passed**. The new suite then had 16 direct/helper cases. The first full 20-case cross-slope run had the expected **18 passed / 2 failed**, with both failures reporting `expected 0 to be greater than 0.5` for the unwired low-grip slide.

Coverage includes:

- Mirrored 30% low-mu banks, analytic constant acceleration and displacement, and Coulomb saturation.
- High-grip stationary support over one second with zero creep, yaw, wheel motion or slip heat.
- Force-circle sharing under braking, driven spin and supported cornering.
- Per-step energy bounds and exact low-grip gravity/heat balance.
- A world-fixed gravity vector under arbitrary heading and both yaw directions, including independent analytic displacement and work checks.
- Exact undefined/zero compatibility, two free contacts, one supported contact, load fade, two differently oriented axle normals, invalid input and bounded banked turns.
- Both public player MX bikes on mirrored low-grip banks and high-grip banks, including the roll response.
- Complete ground-response equality on either bank when braking the unloaded front rotor, allowing only that free rotor's speed and brake heat to differ.
- Complete result equality for both handlebar directions with a free front tyre on either bank, while retaining loaded-rear slip dissipation.

Focused ESLint and whitespace checks passed on the owned TypeScript files. No npm lifecycle hooks, install, full typecheck, commit or push was used.

### Final owned verification

```sh
node_modules/.bin/vitest run tests/motocross-cross-slope.test.ts tests/motocross-ground-physics.test.ts tests/motocross-ground-passivity.test.ts --maxWorkers=1
```

**3 files / 40 tests passed**, 2.79 seconds. The new cross-slope suite contains 22 cases. The analytic mu=0.01 fixture reaches ±2.601011482 m/s side speed after one second, with ±1.302311999 m semi-implicit displacement at the solver's 720 Hz internal cadence.

### Existing wheelie integration comparisons still requiring root follow-up

The real-course fixture named `flatBike` is located at s=35 on Valley Ridge. Source/runtime inspection found a **1% cross-bank**, not a geometrically flat plane: its centre normal was approximately `(-0.00526673336, 0.99993613511, 0.00999936135)` and its heading points along +X. The new supported cross-slope contribution is about -0.098 m/s² at static weight.

After wiring, the full four-file focused run passed the new suite, ground and passivity cases, all ten direct front-steering cases, and the unchanged exact supported-braking fixture. Two existing public steering-wheelie comparisons failed their 10-decimal equality:

| Existing test | Observed heading-difference discrepancy |
| --- | ---: |
| MX-250 real wheelie, steering versus straight | 6.18843599e-8 rad |
| MX-450 real wheelie, steering versus straight | 1.96394221e-6 rad |

The separate contact-traction run retained one MX-450 front-brake/coast wheelie discrepancy after the endpoint equilibrium fix: speed difference **9.93845992e-7 m/s**, against a 5e-9 m/s equality tolerance. Front patch force remained exactly zero.

A temporary diagnostic wrapper compared the same solver state/parameters with gravity active and disabled, and separately ran complete histories with the new optional input suppressed. It was removed after diagnosis. Evidence for the braking wheelie:

- The first two brake/coast ticks were exactly equal.
- Existing automatic rider bracing subsequently differed: `automaticBody` was about 0.4287262 coasting and 0.4084112 with front braking.
- The third-tick rear support became 2520.97422 versus 2520.99338 N; fourth-tick support became 2473.72909 versus 2473.81690 N.
- Fourth-tick rear traction consequently became 2293.62831 versus 2293.64999 N. The free front contact still supplied no force.
- With gravity suppressed over the complete history, the rear rotor reached a different rolling phase, and its last-tick drive force was only about 98 N; the same existing body-response coupling then happened to fit the old equality threshold.

This is a real rear-load/terrain response to changing rider posture, not braking or steering through an unsupported contact. Agent 08's earlier report already noted that steering intent can alter roll and rear support. Previously absent cross-slope gravity made the trajectory part of that coupling invisible. The new same-state banked solver tests prove exact independence from both unsupported front braking and bar steering.

Root was given the recommendation to retain the old wheelie assertions while making their isolation fixture an in-memory zero-cross-slope plane; the new suite separately covers the bank behavior. No existing test, assertion or fixture was changed by this agent. These integration comparisons remain explicitly unclaimed as passing at this handoff.

## Source hashes and release

Initial owned solver SHA256: `8cdf2f5ad7ac540c8716a18b604d5ef4b504cc04d5681a0c680aef9ebc581140`.

Initial read-only adapter SHA256: `0672ea2309cee36f8b2a88812adf30f06626c174b323d69a339674ecddbe39ee`.

Release SHA256 values:

| File | SHA256 |
| --- | --- |
| `src/simulation/offroad/mx-ground-physics.ts` | `6c2ab06f3f1116d593ddfea26194ad6146f4f01da119a13d0c9be2f7ba470a81` |
| `tests/motocross-cross-slope.test.ts` | `ba8f890d63b565fb34736ccdfdce37c49a31c8d170b4c462c4f0f2979310363f` |
| Root-owned adapter observed for final owned verification | `ef32cf97204a1894285a670ab8e7ae614fddc824ed17da3cbd21ab78a8ddb458` |

**Ground-source ownership released to agent 25** for the separately authorized drive-TC ownership flag. The release hash above identifies this agent's completed source before that follow-up. Test/report ownership is released to root. No more ground-source edits are pending from agent 22.
