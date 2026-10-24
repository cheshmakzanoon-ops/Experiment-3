# W4 — Handling physics and riding feel (worker id: w4-physics)

Read `BRIEF_COMMON.md` first (same folder). This is your workstream.

## Mission
The trailer's line is "Master the new physics" (REF_066). Make GP-R1/GP-R2 behave — and
*express* their behaviour through the frame state that animation and cameras consume — like a
real ~157 kg, ~290 hp prototype with carbon brakes and slicks. No arcade shortcuts.

## You own
`src/simulation/bike.ts`, `bike-vehicle.ts`, `motogp-physics.ts`, `src/simulation/gp-*.ts`,
`bike-definitions.ts` (GP_BIKE/GP_R1/GP_R2 entries only), `bike-ai.ts` (only as needed to keep
AI fast and stable), GP-gated changes in `tyre-force.ts`, plus `tests/` and `scripts/` covering
them, and `docs/motogp-physics-model.md`. **Do not change the frame/protocol layout** (`B`, `F`
offsets in `src/simulation/protocol.ts`) — renderers depend on it. Rendering is not yours.

## Work
1. **Calibrate to the real world, with sources.** Research public data (Brembo's per-circuit
   MotoGP braking statistics, MotoGP.com technical articles, published top speeds, lean-angle
   telemetry). Cite them in the doc. Targets to verify by scripted runs (write a deterministic
   calibration script/test): top speed on a long straight (~350–365 km/h), 0–100 and 0–200 km/h
   (wheelie/traction-limited, ~2.6 s and ~5 s ballpark), peak braking deceleration (~1.5–1.6 g
   is the commonly quoted figure — confirm), braking distances from ~330→100 km/h, max lean
   (~63–64°), steady lateral acceleration at max lean with hang-off, lap time sanity at Poggio Alto
   vs the AI.
2. **Chassis motion that sells weight.** Suspension as damped spring-mass (fork dive to near
   full travel under hard braking with a progressive rate, rebound; rear squat/extension on
   drive; pitch oscillations that settle naturally), rear lift and wagging under maximum
   braking, rear stepping out on aggressive entry (engine braking/rear brake), controlled rear
   slide on exit with traction-control intervention, wheelies held by anti-wheelie in low
   gears. Make sure `B.FORK`, `B.SHOCK`, `B.PITCH`, `B.FRONT_LOAD/REAR_LOAD`, `B.LEAN_RATE`,
   `B.STEER`, `B.TUCK`, `B.RIDER_OFFSET`, `B.RIDER_X/Y/Z` carry these motions physically —
   W2 (bike) and W3 (rider) animate from them.
3. **Steering and lean feel.** Roll inertia and gyroscopic stiffening at speed (flicks harder
   at 250 km/h than at 100), realistic peak roll rates through chicanes, counter-steer
   transient, hang-off reducing required lean (tan φ_eff ≈ a_y/g with rider offset), no
   twitchy or floaty input mapping. Keep the assist "lean intent" contract (`docs/motogp-physics-model.md`).
4. **Limit behaviour.** Front-tuck lowside when the front is overloaded at lean, highside when
   a sliding rear regains grip abruptly — believable thresholds, tyre temperature and wear
   influence, wet behaviour.
5. **Pre-existing failures.** The 25 failing tests in the GP simulation suites (list in the common
   brief) all sit in your area. Diagnose each: stale expectation vs real bug. Fix real bugs;
   update stale expectations only with a written reason. Report before/after counts.
6. **AI** must still complete races cleanly at sensible pace (`npm run test:bikes`,
   `scripts/bike-race.ts`), deterministically.

## Done means
A calibration table (target, source, measured before, measured after) in
`docs/motogp-physics-model.md`; new deterministic tests that lock the key numbers; existing
physics/bike suites green or with every remaining failure explained.
