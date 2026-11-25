# Assignment 28 — supported-stroke integration accuracy

## Result and ownership

**The MX450 Arena Nord TABLETOP at 120 Hz rides out its real landing without changing any crash threshold, force law, terrain, specification, or first-contact event.** Its recorded bottoming speed changes from **7.062512 to 6.628231 m/s**; the independently refined 3840 Hz continuation is **6.648376 m/s**. The error against that continuation falls from 0.414136 to 0.020145 m/s.

Assignment 25 explicitly released `src/simulation/offroad/dirt-bike-vehicle.ts` before implementation. This assignment changes that adapter, adds `tests/motocross-supported-convergence.test.ts`, and makes the coordinator-authorized narrow numerical-oracle update in `tests/motocross-landing-observability.test.ts`. Source ownership returns to the coordinator with this report. No git operation, authored model, asset, material, environment, terrain, specification, or other-mode change was made.

## Mechanism

The old supported step evaluated a stiff bump stop only at the outer incoming pose. A coarse step could pass full travel before refreshing that force, changing the coupled front/rear response and the shaft speed at the other stop. Assignment 25's correct within-step observation exposed this numerical bias rather than creating it.

The ridden player MX path now subdivides only the local supported heave/pitch advance when its incoming prediction needs more resolution:

- Predicted absolute shaft sweep per stage is limited to one sixth of that axle's travel.
- When the predicted sweep reaches a stop, each axle's estimated stiff-stop phase is limited to 0.3 radians. The estimate uses the existing 40× bump stiffness, current mass, pitch inertia, actual compression lever, and existing calibrated force moment arm.
- The work is bounded to 16 stages. Ordinary low-rate supported steps, unsupported flight, projected hard-stop impulses, AI, supermoto, and other course eligibility retain one advance.

Every internal stage re-evaluates the existing rising-rate spring, digressive damper, lossy stop, and calibrated pitch moment on its actual physical pose. The existing crossing observer runs on each resulting interval. Landing criteria and the force law are unchanged. The first free-flight/contact split remains assignment 25's implementation.

The outer `forceFront/forceRear` and `compressionFront/compressionRear` channels retain their original incoming timestamp. Displayed fork/shock travel still comes from the final chassis pose. The unchanged braking-force oracle in the dynamic-suspension suite continues to check the exact independent incoming spring/damper equation; it was not weakened to accommodate integration changes.

## Same-flight convergence

Every row uses the identical actual 120 Hz approach, launch, and flight through air time 1.3 seconds. Only the remaining flight/contact/settlement resolution changes. The diagnostic imports the saved assignment-25 adapter for the shared launch and changes only the implementation used for the continuation; it supplies no flight pose or contact load.

| Continuation rate | Before bottoming speed, m/s | After, m/s | After outcome |
| --- | ---: | ---: | --- |
| 120 Hz | 7.062512 | 6.628231 | bottomed, riding |
| 240 Hz | 6.709060 | 6.709060 | bottomed, riding |
| 480 Hz | 6.714573 | 6.714573 | bottomed, riding |
| 960 Hz | 6.654894 | 6.654894 | bottomed, riding |
| 1920 Hz | 6.649983 | 6.649983 | bottomed, riding |
| 3840 Hz | 6.648376 | 6.648376 | bottomed, riding |

Incoming normal speed remains unchanged at each rate: **8.621508 → 8.620964 m/s** across the resolution range. The new test requires identical launch checkpoints, no crash, bottoming-speed error below 0.1 m/s against the finest continuation, normal-speed error below 0.001 m/s, and a final refinement difference below 0.01 m/s.

This is convergent numerical evidence for the sampled reduced model, not proof of exact monotonic convergence at every intermediate step size or physical calibration against a real bike.

## Production-path preservation and cost

A read-only before/after comparison ran the full six-second dynamic fixture for both MX classes at both surveyed features, at 120 and 240 Hz. It compared every step's heave, vertical velocity, pitch/rate, speed, X/Z, incoming axle forces, displayed travel, rider body/standing, wheel spins, airborne state, landing count, and crash count.

**All four 240 Hz traces are bit-identical**, with zero refined calls. All eight 120/240 Hz trajectories ride out without crashes. At 120 Hz each six-second trajectory refines only **8–9 outer calls**, each into **two stages**. The SX450 failure becomes a valid bottomed landing. This is a numerical work-count observation, not a physical-GPU or wall-clock performance claim.

Two controlled flat-plane tests begin at 290 mm compression with 8 m/s closing speed and use the production adapter for each MX class. A separately written fourth-order integration of the same constitutive equations, at 8192 and 16384 subdivisions, supplies the reference. Their vertical-velocity references agree within 0.001 m/s; the new advance reduces error to below 75% of the former single-force result. The tests also observe genuine force refreshes at changing physical heights while independently verifying that the published force and compression still describe the outer incoming pose.

## Why one old coarse-step oracle changed

Initial acceptance passed **131/132** tests. The sole failure was the deliberately coarse 30 Hz SKY TRIPLE fixture's three equations requiring a single constant force over its entire supported remainder. Its observed velocity changed from the old equation's −12.756761 to −6.254761 m/s when real stop forces were refreshed. Its existing free-event, overlap, bottoming-severity, presentation, and eventual crash assertions already passed.

The coordinator explicitly authorized replacing those obsolete single-force equations. The revised fixture reconstructs every stage's full force from captured incoming geometry, velocities, terrain normals, and the declared spring/damper/stop law. It reads the actual stage duration at the pitch-damping exponential port, sums the supported durations, and independently accumulates heave/pitch momentum and displacement. It verifies the outer incoming force channels and single rotor update as well. All former event, severity, pitch, crash, and overlap gates remain; no threshold or tolerance was relaxed.

## Acceptance and reproduction

Final targeted acceptance: **13 files / 132 tests passed**. This includes dynamic suspension 14, contact time 13, landing observation 9, landing prediction 12, landing challenge 17, wheel pickup 11, rider weight 14, rider blending 8, contact reset 13, coupled/hard-stop integration 18, and the three new supported-convergence tests. Focused ESLint passed for all three touched TypeScript files.

The existing `scripts/offroad-calibration.ts` ran from task-local scratch with its own `docs` directory: **20 jump runs, zero band failures**. Standing-start results remain MX450 4.53 s, MX250 4.50 s, supermoto 4.43 s. No repository calibration output was overwritten, and no full TypeScript build was run.

Scratch evidence is under `/workspace/scratch/e91efca799c8/validation/supported-accuracy-a28/`: `verification.json`, `verification.log`, `targeted-tests-final.log`, `calibration.log`, `docs/offroad-calibration.json`, `lint.log`, and the read-only trial scripts. Unselected numerical trials ran only as in-memory adapter imports; no rejected trial remained in production source.

Assignment-25 input adapter SHA-256: `6a83634c041ea6e9c588954768fba78df4110952b0e35bb0c0811f5528f2358e`.

Final adapter SHA-256: `85c8991605ef32afc41ca1975b39d3f74a19045ce4cf5e45fa845dec358ee2d0`.

## Limits

The refinement advances the reduced two-degree-of-freedom model over its sampled contact patches; it does not re-run horizontal soil forces, rider controllers, terrain sampling, or the outer landing-state machine internally. Its incoming-rate/frequency estimates and 16-stage cap are numerical accuracy controls, not an unconditional error bound for arbitrarily large timesteps. The known shortened spring pitch arm in assignment 18 and forward-only publication limitation in assignment 26 remain unchanged. This work adds no reverse locomotion and makes no new whole-vehicle energy-conservation claim.
