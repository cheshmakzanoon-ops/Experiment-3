# Motocross ground-contact physics — first dedicated solver

## Scope and integration

**Code:** `src/simulation/offroad/mx-ground-physics.ts`, connected through
`src/simulation/offroad/dirt-bike-vehicle.ts` for player-controlled
MX250/MX450 on motocross and supercross venues. This is a deliberate
incremental rollout, not a replacement of the road-bike or MotoGP engine.
AI opponents and supermoto continue using the calibrated shared motorcycle
core while race/test validation and migration remain outstanding.

The existing terrain, material table, suspension heave/pitch/normal forces,
rider pitch, landing/crash rules, world collisions, remount, race telemetry,
and replay protocol are retained. `Bike` still provides the bounded
lean-intent controller and crash/recovery contract. It no longer determines
the ridden MX bike's actual ground-plane trajectory or wheel/soil force.

## Equations, units and numerical method

Let `u` be forward velocity (m/s), `v` leftward velocity (m/s),
`r` yaw velocity (rad/s), `psi` heading (rad), `m` sprung machine+rider
mass (kg), `Iz` approximate yaw inertia (kg m²), and `a,b` CG distances
to front/rear contact patches (m). The 3-DOF ground plane obeys

```text
m (du/dt - r*v) = Fx_front_chassis + Fx_rear - D(u) - m*g*sin(slope)
m (dv/dt + r*u) = Fy_front_chassis + Fy_rear
Iz dr/dt = a*Fy_front_chassis - b*Fy_rear - c_yaw*r
dpsi/dt = r
dx/dt = u*sin(psi) + v*cos(psi)
dz/dt = u*cos(psi) - v*sin(psi)
```

The front tyre-frame shear is rotated by the physical front-steer angle
before its force and yaw moment are applied to the chassis. Lateral patch
slip includes yaw sweep (`v+a*r` ahead and `v-b*r` behind the CG).
The wheel rotors carry their own angular momenta:

```text
If d(omega_front)/dt = -T_brake_front - R_front*Fx_front
Ir d(omega_rear)/dt  =  T_drive - T_brake_rear - R_rear*Fx_rear
```

Here `If,Ir` are wheel inertias (kg m²), torques are N·m, and tyre forces
are N. The soil force never acts on a zero-load axle. This directly gives
wheelspin on launches, brake locking, real rotor speeds in flight, and
gradual recovery of wheel speed after landing.

The tyre is an inexpensive smooth, *combined-slip* brush surrogate rather
than a measured finite-element contact patch or a calibrated Magic Formula:

```text
s_long = (R*omega-u_contact) / max(0.9, 0.075*abs(u_contact))
s_lat  = slip_angle / 0.15
s = sqrt(s_long² + s_lat²)
F_contact = mu * normal_load * tanh(s)/s * (s_long,s_lat)
```

As `s` grows, combined force approaches `mu*normal_load` smoothly.
The surface material, rut and moisture influence `mu` through the
existing ground sampling. Front and rear suspension loads are supplied by
the pre-existing nonlinear fork/shock integrator, not recomputed from a
fixed axle split.

Heat-generating soil work is nonnegative: `P_slip =
Fx*(R*omega-u_contact) + Fy*minus_lateral_contact_velocity`, with
the latter reconstructed from slip angle. Wheel wear/energy channels use
this slip work for motocross rather than force times road speed. A perfectly
rolling, nonsliding contact therefore carries negligible slip heating.

Each externally requested step is divided into
`ceil(dt*720)` semi-implicit force and rotor substeps. Returned soil
forces are *impulse averaged* across these same substeps, rather than
sampled from the last substep. Touchdown preserves wheel and yaw momentum.
Rider physics and AI aids see the resultant contact load and velocities.

## Current test coverage

- Pure rolling equilibrium and unloaded-contact zero force
- Bounded combined force-circle use for arbitrary signs of slip
- Equal/opposite chassis and rear-rotor momentum impulse
- No ground braking impulse through an airborne/unloaded front tyre
- Left/right steering and yaw symmetry
- 120 Hz versus 240 Hz timestep consistency
- Thermodynamically nonnegative slip work
- Exact equivalence of reported average force and integrated impulse
- AI front-load throttle reserve and corrective slide-steer symmetry

**Running locally after cloning:**

```bash
npm ci
npx vitest run tests/motocross-ground-physics.test.ts tests/motocross-cornering-reserve.test.ts
npm run build
npm run test:offroad
```

The GitHub Actions build and scenario jobs must also pass on the final
commit. A queued or unrun job is **not** evidence of a validated release.

## Calibration caveats and next engineering steps

This is a deterministic real-time reduced-order model, **not** a
field-validated hyperrealistic motocross digital twin. The yaw inertia,
combined-slip stiffness, damping, and tyre coefficients require tuning
against measurements at multiple speeds, rut depths, lean angles, jump
landings, and soil moistures. More physically ambitious upgrades should
add tyre shear *relaxation length*, camber/contact-patch aligning moment,
soil sinkage and compaction work, dedicated low-speed steering/roll
stability, and a coupled rider/motorcycle multi-body roll-yaw model.

These are substantively different from merely raising rendering frame
rate or strengthening a grip coefficient. Migrate AI-controlled motocross
bikes onto the independent contact model only after full off-road race
and jump-calibration checks meet their existing gates; do not bypass
failures by inflating crash allowances.

## Research context (not claimed as implemented source code)

- Cossalter, Lot and Massaro (2014), *Motorcycle Dynamics*, Wiley:
  https://doi.org/10.1002/9781118536391.ch1
  (in-plane/out-of-plane coupling, motorcycle tyre/contact limitations).
- Sharp, Evangelou and Limebeer (2004), *Advances in the Modelling of
  Motorcycle Dynamics*, Multibody System Dynamics:
  https://doi.org/10.1023/B:MUBO.0000049195.60868.a2
  (tyre relaxation, load/slip/camber, monoshock, steering control).
- *Tyre forces estimation for off-road motorcycles* (2021),
  Mechanical Systems and Signal Processing:
  https://www.sciencedirect.com/science/article/pii/S0888327020306142
  (track-observed tyre load estimation, a direction for field calibration).
- *Semi-empirical terramechanics modelling of rough terrain represented
  by a height field* (2024), Journal of Terramechanics:
  https://www.sciencedirect.com/science/article/pii/S002248982400017X
  (soil pressure-sinkage and Janosi–Hanamoto shear-displacement modelling,
  considerably beyond the current smooth brush approximation).
