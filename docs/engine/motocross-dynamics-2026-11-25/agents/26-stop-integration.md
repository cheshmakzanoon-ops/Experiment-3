# Assignment 26 — hard-stop consumer integration

## Decision and ownership

**The coupled helper is sound at the tested motocross consumer boundary. No production source change is warranted by this audit.** Added [`tests/motocross-hard-stop-integration.test.ts`](../../../../tests/motocross-hard-stop-integration.test.ts) and this report. [`contact-impulse.ts`](../../../../src/simulation/offroad/contact-impulse.ts) was reviewed and left unchanged. The adapter remains owned by assignment 25; no model, asset, specification, terrain, environment, or git operation was performed.

The existing forward-only travel representation has one explicit limitation: clipping a solved backward velocity can reopen normal closure. It remains dissipative. This is an adapter publication limitation, not a failing coupled solve, and correcting it would require a deliberate travel-representation decision.

## What the new tests observe

The tests spy on the production helper while calling its original implementation. They record its actual incoming velocities, mass, inertias, contact descriptors and returned impulses. A second observation at the first following spring evaluation reads the adapter's already-applied velocities. At that instant, spring/gravity integration, pitch damping and touchdown coordinate changes have not yet run. The adapter and force laws are never substituted.

The independent oracle uses sampled world-space terrain gradients, world translation, the yaw moment of the normal impulse, and a central finite difference of the real free-wheel pitch geometry. It checks linear and angular momentum changes, unilateral closure, complementarity and the inelastic impact-work identity. Its kinetic energy uses the same effective sprung pitch coordinate that the adapter advances: **98 kg·m² for MX250 and 105 kg·m² for MX450**, plus the yaw inertia shared with the independent soil-force solver. Current `dynamics.mass` and `body.mass` must match the helper mass; controlled fixtures use 40% fuel to expose a stale nominal-mass choice.

For the captured pre-impact state `v`, impulse amounts `jᵢ`, and contact closing speeds `cᵢ`, the tested identity is

`Kbefore − Kafter = ½ Σ jᵢ cᵢ`.

Momentum is checked from the world normal force and its moments, without applying the helper's own Jacobian as the oracle. The tests permit at most **1e−8 J** kinetic gain and **2e−9 m/s** closing residual in ordinary coupled consumer cases. The energy identity and pitch momentum comparison allow the error from the independent finite difference.

### Coverage

| Consumer case | Evidence |
| --- | --- |
| Player MX250 and MX450 | Twenty controlled public-step impacts: flat, front-only uphill, rear-only downhill, off-camber, and yawed bank; each from ground and air. |
| Actual contact construction | Front/rear eligibility follows compression against real travel; sampled grade, cross grade, full pitch lever and yaw moment match the independent oracle. |
| Actual impulse application | One coupled call; the adapter's next spring evaluation contains the correct summed linear/pitch/yaw changes; no legacy helper call. |
| Order and repeat behavior | Swap the contact order at the helper boundary and map the answers back before application. Both bikes retain the same state. Eight zero-time solves per order add less than 1e−9 N·s after the first solve, with no repeated height correction. |
| No impact | Separating deep contact returns zero impulses; contact within suspension travel does not invoke either stop helper. |
| AI and distance | Grounded and airborne MX450, entrant IDs 0/11 and world origins 0/20,000 m, retain the coupled longitudinal-only convention and the same response. AI cross-grade/yaw arms remain zero. |
| Legacy scope | Supermoto on an MX course and an MX bike on a road course keep single-contact calls. With two bottomed axles, those calls remain sequential and consume the velocity left by the previous call. |
| Existing forward-only clamp | Repeated low-speed uphill impacts remain passive when solved backward travel is clipped. The test does not assert complete closure through this representation limit. |

The AI distance check concerns this actual adapter path. `Simulation.step()` advances all cars through the same two physics substeps; distance does not select a separate stop implementation. This audit does not claim a complete AI race survey.

## Unmodified production-terrain reachability

Both bikes start from ordinary free placement beside the Arena Nord median at station 36, face across the lane, receive a 10 m/s approach speed in second gear, and hold throttle at 0.2. This is the established collision regression's adverse rider approach. The new test does not supply a flight pose, compression, force, or deep overlap. Production samples, normal bike stepping and the collision solver create the impacts.

| Bike | Captured coupled calls before rider separation | Largest summed impulse |
| --- | ---: | ---: |
| MX250 | 7 | 180.813727 N·s |
| MX450 | 8 | 229.056821 N·s |

Every captured impulse satisfied the independent momentum, energy and closure checks. No backward-speed clipping occurred in these fifteen impacts. These measurements establish that the tested helper is reached through production riding and geometry; they do not establish that backward-speed clipping is unreachable elsewhere.

## Forward-only publication limit

A separate controlled adapter probe used the same test fixture with a +0.55 grade, both tyres 0.16 m beyond nominal travel before projection, horizontal speed 1 m/s, vertical speed −8 m/s, and zero pitch/lateral/yaw rate. The real fixed hard points determine pitch and height. The adapter applies its normal position projection before the captured call.

The coupled solve gives horizontal velocity **−2.6103646833 m/s** and vertical velocity **−1.4357005758 m/s**. These values are tangent to the uphill plane, and the helper closes both stops. The existing speed publication clips horizontal velocity to zero. The resulting normal closure is **+1.4357005758 m/s**, so a second zero-time call legitimately sees another closing state.

| Bike | Current mass | First total impulse | Second total impulse after clipping | Actual first kinetic-energy loss |
| --- | ---: | ---: | ---: | ---: |
| MX250 | 174.4 kg | 1,144.813820 N·s | 192.235071 N·s | 5,488.260208 J |
| MX450 | 181.2 kg | 1,189.451056 N·s | 199.730475 N·s | 5,702.252005 J |

The additional publication step removes horizontal kinetic energy; it does not inject energy. The regression retains a passivity check across eight repeated calls without requiring the residual closure to persist. This keeps a future deliberate representation correction possible. No extra horizontal constraint, reverse-locomotion feature, or adapter change was introduced here. The limitation and measurements were sent to the coordinator and adapter owner.

## Limits of the certificate

This is a certificate for the impulse exchange in the adapter's reduced physical coordinates. The positional overlap correction can change gravitational potential, and subsequent springs, damping, gravity, rider torque and touchdown projection exchange additional work. In particular, the known omitted spring/damper pitch-offset work in [assignment 18](18-spring-geometry.md) remains unresolved. The tests explicitly separate these operations and do not label whole-tick energy as hard-stop impact energy.

The tests also do not certify conversion of collision-body angular impulses, full roll/rotor energy, physical calibration against a real motorcycle, extreme normal clamping, or rendered animation. Legacy two-axle sequential calls retain their previous coupled-closure limitation by scope; they are checked for correct consumer behavior and passivity, not advertised as a simultaneous solution.

## Verification

```bash
node_modules/.bin/vitest run tests/motocross-hard-stop-integration.test.ts tests/motocross-coupled-stops.test.ts tests/motocross-contact-impulse.test.ts
node_modules/.bin/eslint tests/motocross-hard-stop-integration.test.ts src/simulation/offroad/contact-impulse.ts
```

**3 files / 18 tests passed**, including ten new integration tests; focused lint passed. No full TypeScript build or broad simulation sweep was run.

Audited helper SHA-256: `7c33205a27a5e271ffc1569ca2785aac234e5f4165aa6fe1f920c783fdd685e6`.

The concurrent assignment-25 adapter at verification had SHA-256 `d969eb68457f108c78d922e0140b655bdaac43e16f3a7f3dbe96dc0057f2b2ea`. Its event-time work was still under independent acceptance; these tests make no replacement of that source and should be rerun after its final integration decision.
