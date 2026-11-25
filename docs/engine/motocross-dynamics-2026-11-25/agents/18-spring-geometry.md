# Assignment 18 — spring pitch geometry and virtual work

## Decision

**The omitted offset terms are a demonstrable work-conjugacy defect in the current reduced suspension coordinates. They also preserve an established handling calibration. Do not ship the one-line torque correction in this wave.** The analytical check is decisive; a read-only counterfactual shows that the correction by itself breaks every sampled jump calibration, including the player path.

Added only [`scripts/bench/motocross-spring-work.ts`](../../../../scripts/bench/motocross-spring-work.ts) and this report. Production source, models, assets, environment, specifications, and git were untouched. The probe reads the adapter and imports an in-memory version with one torque expression replaced; it never writes that version to the repository.

Audited adapter SHA-256: `3afcdd87da876d5dd36bf28d8f218398a15b7465c467ef185d8879c198b65e79`.

## What the equations imply

In [`DirtBikeVehicle.vertical()`](../../../../src/simulation/offroad/dirt-bike-vehicle.ts), write the front/rear signed longitudinal arms as `a = [fa, -ra]`, free-wheel vertical offsets as `H = [HF, HR]`, pitch as θ, chassis height as y, and terrain heights as g. Each compression is

`cᵢ = gᵢ − y − aᵢ sinθ + Hᵢ cosθ`.

Holding the sampled terrain fixed, the free-wheel vertical velocity is

`vᵢ = ẏ + ℓᵢ θ̇`, where `ℓᵢ = aᵢ cosθ + Hᵢ sinθ`.

The adapter already uses these complete levers for suspension rates and hard-stop impulses. For the spring potential `U = Σ ∫Fspring(cᵢ) dcᵢ`, however, its required generalized pitch force is

`−∂U/∂θ = FF (fa cosθ + HF sinθ) + FR (−ra cosθ + HR sinθ)`.

The current elastic/compliant pitch moment is only `(FF fa − FR ra) cosθ`. It omits

`Δτ = sinθ (HF FF + HR FR)`.

There is no cancellation between front and rear offsets: both terms have the same sign. At fixed terrain, the resulting elastic power residual is

`d(K + U)/dt = −Δτ θ̇`

when other forces and the integrator are excluded. Increasing positive pitch removes energy; returning toward level adds it. This is not solely an error in naming the spring potential: the heave force and legacy pitch force fail mixed-derivative reciprocity, so a different scalar potential cannot make this pair conservative while preserving the same gap equations.

The independent probe integrates the exact default-preload rising-rate potential, including the linear bump-stop continuation. Central pitch perturbations of ±1e-6 rad agree with the complete torque within 1e-6 N·m. A closed rectangle of 10 mm heave by 0.02 rad pitch, centered at 0.25 rad with both compressions initially 120 mm, produces:

| Bike | Closed-loop work, current torque | Closed-loop work, full gap derivative |
| --- | ---: | ---: |
| MX250 | +1.744832 J | approximately 1e-9 J |
| MX450 | +1.839400 J | approximately 1e-9 J |

Reversing that loop reverses the legacy work. The result uses no drive, rider aid, damper, hard-stop projection, timestep integration, or renderer.

### The damping mismatch is also real

The damper uses the full compression rate but applies its pitch force through the shortened lever. Its mechanical power therefore differs from the intended nonpositive `−Fdamper ċ` by the same offset port. A rear-only diagnostic at θ=0.8 rad, θ̇=1 rad/s, zero heave, and 150 mm rear compression gives **+266/+277 W** from the legacy MX250/MX450 rear damper pitch component; the work-conjugate result is **−83/−90 W**. Total spring-plus-damper force remains positive, so force clipping does not hide this example. This is a controlled local diagnostic beyond the declared balance point, not a claim about normal wheelie frequency.

## Why the existing code looks intentional

[`settlePose()` / `settle()`](../../../../src/simulation/offroad/dirt-bike-vehicle.ts) prescribe `FF=mg·ra/L` and `FR=mg·fa/L` regardless of pitch, then solve the two geometric gaps for height and pitch. The current torque makes that split nearly stationary at every supported slope. [`motocross-reference-geometry.test.ts`](../../../../tests/motocross-reference-geometry.test.ts) explicitly locks this pitch-independent split across grades ±12%, preload changes, and fuel levels. The small residual from the six-iteration spring inverse is separate and is only about 0.1 N here.

[`factoryBikeSag()`](../../../../src/simulation/offroad/suspension-geometry.ts) deliberately keeps the free-wheel hard points fixed while setup and fuel change spring travel. [`motocross-dynamic-suspension.test.ts`](../../../../tests/motocross-dynamic-suspension.test.ts) independently verifies the incoming compression/rate force calculation and final presentation pose, but does not test work conjugacy. Existing hard-stop passivity tests apply the complete Jacobian to impulses and likewise do not certify the compliant torque.

Thus the calibration is observable and protected. No compensating mechanical energy store or derivation in these sources makes the missing term a conservative generalized-force approximation. Historical intent cannot be inferred from this read-only audit. It can be retained explicitly as a calibrated nonconservative reduced model, but should not be described as physically consistent elastic work.

## Magnitude on slopes

These measurements use actual production placement on independent planes. “New equilibrium” solves the same two gap equations and spring law with complete levers, zero longitudinal force, and neutral rider. They quantify this reduced model, not a full motorcycle normal-force solution.

| Bike / uphill grade | Omitted initial torque | Added initial pitch acceleration | Front spring load, current → new equilibrium | Pitch change | Fork / shock travel change |
| --- | ---: | ---: | ---: | ---: | ---: |
| MX250 / 12% | 195.15 N·m | 1.99 rad/s² | 861.09 → 711.53 N | +0.855° | −11.64 / +10.28 mm |
| MX450 / 12% | 204.36 N·m | 1.95 rad/s² | 892.53 → 735.78 N | +0.862° | −11.73 / +10.36 mm |
| MX250 / 30% | 487.85 N·m | 4.98 rad/s² | 861.09 → 464.10 N | +2.409° | −33.40 / +25.58 mm |
| MX450 / 30% | 510.87 N·m | 4.87 rad/s² | 892.53 → 476.37 N | +2.429° | −33.67 / +25.78 mm |

The 12% case changes front support by about 17.4–17.6%; at 30% it changes by about 46%. Descending grades reverse the load shift. Flat factory placement has zero omitted moment, but nonzero slope and preload-induced pitch do not. The first derivative of the omitted moment is nonzero even at zero pitch, so the change also alters small-angle pitch stiffness around flat equilibrium.

The current sampled wheel positions remain at nominal horizontal `±fa/ra`; they do not rotate with pitch. `roadPitch` is derived from their sampled height difference. Longitudinal tyre torque still uses constant `cgHeight`. These are additional reduced-model choices: adding Δτ repairs this particular work identity without establishing a complete rigid-body contact geometry.

## Ordinary wheelies and the declared balance point

The production raw-input wheelie fixture is reproduced without fabricated pitch or loads: Valley Ridge placement at s=35, full throttle for 84 ticks at 240 Hz. At t=0.35 s:

| Bike | Current pitch | Rear load | Omitted torque | Pitch after torque-only counterfactual |
| --- | ---: | ---: | ---: | ---: |
| MX250 | 0.19193 rad | 2,321.20 N | 402.94 N·m | 0.22620 rad |
| MX450 | 0.20688 rad | 2,659.41 N | 500.49 N·m | 0.26966 rad |

At 480 Hz the current omitted torques are still 370.73 and 516.67 N·m. This is not a discrepancy that vanishes with substep size.

`loopOutPitch()` itself uses `atan(ra/HR)`, the point where the complete rear lever is zero: 0.66493/0.65994 rad for MX250/MX450. At those angles, a rear load equal to static weight still supplies **−1,002.81/−1,043.48 N·m** through the legacy spring moment, although the geometric rear moment is zero.

The one-expression counterfactual exposes an additional control dependency. At 240 Hz the MX250 loops out at 0.567 s rather than 0.729 s. The MX450 instead lifts both wheels before the existing grounded/front-light checks classify a loop-out, reaches the 1.2 rad pitch clamp, and remains airborne/riding at t=1 s with pitch rate 10.03 rad/s. The same pattern occurs at 480 Hz. Merely keeping the existing loop-out threshold does not make the corrected force model safe.

## Production jump sensitivity

The probe runs six seconds at 240 Hz from 12 m before each surveyed feature, with existing `rideLine()` inputs, ordinary third gear, and current Sport/AI aids. Ridge Table uses 13.5 m/s; Arena Tabletop uses 13 m/s. The trial changes only the compliant pitch expression; static placement, rider aids, pitch damping, longitudinal torque, geometry, and landing rules are identical. Tiny approach hops are excluded from the reported feature flight.

| Player Sport case | Current takeoff pitch / rate | Torque-only takeoff pitch / rate | Current / trial landing pitch error | Outcome |
| --- | ---: | ---: | ---: | --- |
| MX250 Ridge Table | 30.517° / −0.940 rad/s | 55.663° / +2.081 rad/s | +0.065 / +1.485 rad | bottomed, no crash → crash-rear |
| MX450 Ridge Table | 31.195° / −0.881 rad/s | 56.502° / +2.141 rad/s | +0.065 / +1.468 rad | bottomed, no crash → crash-rear |
| MX250 Arena Tabletop | 30.358° / −1.108 rad/s | 54.908° / +2.183 rad/s | −0.119 / +1.332 rad | bottomed, no crash → crash-rear |
| MX450 Arena Tabletop | 30.987° / −1.010 rad/s | 55.778° / +2.268 rad/s | −0.093 / +1.318 rad | bottomed, no crash → crash-rear |

The four corresponding AI-aided cases also change from zero crashes to `crash-rear`: **8/8 regressions** in this deliberately small sensitivity matrix. These are not complete AI race gates. Current-path omitted pitch-port work across the six-second traces is −531 to −662 J, with 878–1,177 J absolute exchange. These integrals isolate the omitted port; they are not total vehicle energy measurements, because drive, damping, moving terrain, contact, and split integration exchange energy elsewhere.

## Concrete next implementation recommendation

1. **Keep this wave diagnostic.** A small code diff is not a small behavior change. Preserve the reproducible probe and classify the omission as an existing physics/calibration debt.
2. **Choose one consistent reduced geometry in a dedicated physics revision.** Derive compression, its full velocity Jacobian, compliant generalized forces, and stop impulses together. A pure lever substitution is mathematically useful but fails the measured riding gates. Removing the offset dependence from compression would be an alternative model, but would change pitch support, landing prediction, and geometric presentation; it is not an inexpensive compatibility fix either.
3. **Solve placement under the selected force law.** With complete levers, equilibrium needs `FF+FR=mg` and `FF·ℓF+FR·ℓR+τlong+τbody=0`, coupled to the two gap equations and existing preload law. Keep factory hard points fixed. Publish resulting loads/travel through reset, tyres, motion state, and the first snapshot. Handle infeasible two-contact poses explicitly. Updating only `vertical()` leaves `settlePose()`, seeded loads, preload/fuel cases, and recovery inconsistent.
4. **Reconcile slope/longitudinal and rider assistance before tuning jump gains.** Establish the intended force direction and reference point for the constant-height longitudinal torque and fixed plan-view contact samples. Check body-shift torque against that same coordinate choice. Then recalibrate supported pitch response, low-speed climbing posture, rough-ground brace, wheelie throttle/rear-brake cover, and takeoff prediction. Test the transition to zero contact through the loop-out debounce. Enlarging landing limits would hide the reproduced attitude errors.
5. **Treat player-only and all-MX scope as distinct migrations.** Player-only eligibility matching the dedicated MX/SX soil solver avoids changing opponent/supermoto dynamics, but the four player failures prove that it is not ready by itself. Placement happens before the step updates `playerMotocross`; its initialization path must resolve eligibility without relying on that stale flag. Player/AI handover at nonzero pitch changes the law if it is gated directly on control ownership, so define and test the physics-mode lifetime without teleporting the state. All-MX gives one constitutive law across handovers, but requires re-surveying both AI jump and full race gates; the four AI failures make that work concrete. Preserve road/supermoto scope deliberately.
6. **Required acceptance evidence:** potential-derivative/closed-loop checks, passive damping away from force clipping, full static equilibrium across grades/preload/fuel, ordinary rear-pedal wheelie recovery and over-balance behavior, both surveyed jump paths at 120/240/480 Hz, player/AI handovers, recovery snapshots, and replay reconstruction. Version any shipped physics behavior change.

## Reproduction and verification

```bash
node --experimental-transform-types scripts/bench/motocross-spring-work.ts
node_modules/.bin/eslint scripts/bench/motocross-spring-work.ts
node_modules/.bin/tsc --noEmit --strict --module ESNext --moduleResolution Bundler --target ES2022 --allowImportingTsExtensions --skipLibCheck --types node scripts/bench/motocross-spring-work.ts
```

All three commands passed on the recorded adapter. The probe prints the source SHA, finite-perturbation and closed-loop checks, independently solved static equilibria, 240/480 Hz wheelies, and all sixteen current/trial jump runs. Its source-replacement assertion intentionally stops if the audited torque expression changes. No production fix or expanded race acceptance is claimed.
