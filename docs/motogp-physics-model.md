# MotoGP prototype single-track dynamics

## Scope and isolation

GP-R1 and GP-R2 explicitly opt into MotoGPChassis in src/simulation/bike-vehicle.ts. Cars retain vehicle.ts and the motocross terrain/suspension subsystem remains in offroad/. Other motorcycles keep the established reduced-order Bike model. A plain research new Bike() does not enable GP physics.

## Model: original calibration, not proprietary MotoGP physics

At each fixed physics substep the GP chassis integrates measured body-frame lateral velocity v_y and yaw rate r. Each front/rear tyre gets load-scaled nonlinear camber and combined-slip forces through the shared tyre-force.ts Magic-Formula-shaped law:

- Front slip angle: alpha_f = atan2(v_y + a*r, v_x) - steer; rear: alpha_r = atan2(v_y - b*r, v_x). Camber thrust is represented by a stiffness-dependent slip-angle shift.
- Lateral balance: m * (dv_y/dt + v_x*r) = F_yf*cos(steer) + F_xf*sin(steer) + F_yr.
- Yaw balance: I_z _ dr/dt = a _ (F_yf*cos(steer) + F_xf*sin(steer)) - b \* F_yr.
- The friction ellipse clips cornering authority when braking or accelerating spends the longitudinal traction budget.
- A travel-distance relaxation length smooths transient lateral tyre force. Lean responds to the measured lateral acceleration rather than only geometric steering curvature.
- Roll is integrated for the combined bike + rider CG, ψ = φ + θ(hang-off), with θ = atan(0.25·offset/h): I·ψ'' = m·h·(g·sinψ − a_y·cosψ) − H·r·cosφ − H_f·δ'·cosε, where H is the measured spin momentum of both wheels (gyroscopic stand-up in a turn) and H_f·δ' the front wheel's precession when the bars move. A rider moving across the seat conserves ψ, so hang-off rolls the chassis itself up by θ (about 7° at the full 0.3 m).
- The GP lean-intent assist (`GP_ASSIST` in bike.ts) steers ψ to a target that is the stick's share of the present lean limit (90% of the slicks' lateral friction, bounded by ground clearance). Its roll-rate reference stays inside a rider-effort ceiling that falls with front-wheel spin momentum and inside the energy the tyres can still spend to stop the roll (98.5% of capacity). The bar angle comes from inverting the front tyre's own force curve for the force the roll needs, plus a bounded integral trim and yaw damping. The tyres, not the law, decide the motion.
- Cornering ABS, traction control and wheelie control keep each tyre the lateral force of the roll the rider asks for (the assist's reserve), not only of the lean already reached, so trail braking trades stopping for turning.
- Ride-by-wire (`GP_RIDE_BY_WIRE` in bike-vehicle.ts): the delivered throttle of GP-R1/GP-R2 closes at most 10/s (full to shut in 0.1 s). An instant chop at lean, with a light, highly slipped front, moved ~1.2 kN onto that front in one step and yawed the chassis into a spin.
- The front and rear wheel angular velocities differ from ideal road-rolling speed and respond to effective slip and untransmitted torque. In raw assist mode, brakes can lock the front and rear drive can spin the rear. Contact sliding work contributes to the existing tyre heat/wear channels.
- Front contact is gated by the existing normal-load and wheelie-clearance logic. An airborne front contact cannot supply road steering.
- The GP model drives body lateral velocity, wheel-force telemetry, contact animation, recorded angular kinematics, and lateral-g telemetry used by cameras and rider animation.

## Limitations and calibration work

This is a deterministic, reduced-order single-track motorcycle model, not full six-DOF multibody simulation or calibrated OEM MotoGP tyre data. Longitudinal load transfer, engine torque/braking, ABS, traction control, wheelies, lean, incidents and recovery continue to be supplied by Bike, with the new GP module integrated alongside that existing system. The wheel angular-speed response uses authored force-related relaxation plus untransmitted-torque inertia, not a monolithic coupled implicit wheel/contact solver.

The model cannot claim motorcycle manufacturer accuracy, tire finite element fidelity, verified gyroscopic steer-head torque, official MotoGP game-engine source, or track-data validation. Further engineering should calibrate inertia, load sensitivity, camber curves, and controller stability to measured telemetry, and simulate race-length tests on GP circuits with wet grip and variable kerbs before describing the simulation as quantitatively hyperrealistic.

## Calibration (MotoGP hyperrealism programme)

Measured with `node --experimental-transform-types scripts/gp-calibration.ts --lap --json`. The production `BikeVehicle`, `Bike` core and MotoGP chassis run unchanged; only the rider's inputs are scripted, on the vehicle laboratory's analytic runway (straight-line and steady-state tests) and at Poggio Alto (AI flying laps, practice, dry, seed 5245). Tyres start at operating temperature and the rider aids are the default `sport` set the AI also uses. The step is fixed at 1/120 s and every figure is deterministic. "Base" is the programme's base commit `261ebe8`; "now" is the tree after the GP calibration WIP was reverted and the ride-by-wire roll-off added (`6738f02`).

| Measure                                            |    GP-R1 base | GP-R1 now |    GP-R2 base | GP-R2 now |
| -------------------------------------------------- | ------------: | --------: | ------------: | --------: |
| 0–100 km/h (s)                                     |          3.03 |      3.03 |          3.07 |      3.07 |
| 0–200 km/h (s)                                     |          6.40 |      6.40 |          6.48 |      6.48 |
| 0–300 km/h (s)                                     |         10.93 |     10.93 |         11.47 |     11.47 |
| Top speed, open runway (km/h)                      |         353.7 |     353.7 |         342.5 |     342.5 |
| Launch peak (g)                                    |          0.95 |      0.95 |          0.94 |      0.94 |
| 330→100 km/h distance (m)                          |         260.1 |     262.1 |         242.5 |     244.0 |
| 330→100 km/h time (s)                              |          4.58 |      4.60 |          4.28 |      4.30 |
| 330→100 km/h mean (g)                              |          1.42 |      1.42 |          1.52 |      1.52 |
| 330→100 km/h 50 ms peak (g)                        |          1.86 |      1.86 |          2.02 |      2.02 |
| 330→100 km/h peak fork travel (share of stroke)    |          0.66 |      0.66 |          0.69 |      0.69 |
| 100→0 km/h distance (m)                            |          36.2 |      37.6 |          34.5 |      35.9 |
| 100→0 km/h mean (g)                                |          1.07 |      1.05 |          1.12 |      1.10 |
| Full stick at 100 km/h: chassis lean (°)           |      capsized |      55.6 |      capsized |      55.7 |
| Full stick at 100 km/h: lateral (g)                |      capsized |      1.45 |      capsized |      1.46 |
| Full stick held from 160 km/h: speed held (km/h)   |      capsized |     136.5 |      capsized |     134.5 |
| Full stick held from 160 km/h: lateral (g)         |      capsized |      1.48 |      capsized |      1.49 |
| Flick at 100 km/h: peak roll rate (°/s)            |      capsized |      90.2 |      capsized |      90.4 |
| Flick at 100 km/h: full lean to full lean (s)      |      capsized |      1.70 |      capsized |      1.70 |
| Flick at 200 km/h: peak roll rate (°/s)            |      capsized |      76.3 |      capsized |      76.7 |
| Flick at 200 km/h: full lean to full lean (s)      |      capsized |      1.88 |      capsized |      1.89 |
| AI flying laps at Poggio Alto: laps completed of 3 |             0 |         3 |             0 |         3 |
| AI flying laps: best (s)                           |          none |    114.58 |          none |    114.33 |
| AI flying laps: crashes                            |            29 |         0 |            28 |         0 |
| AI flying laps: peak chassis lean (°)              | 90.9 (fallen) |      56.6 | 91.1 (fallen) |      56.9 |

"Capsized" means that the base commit's full-stick request at that speed fell over, so the test has no steady value. The 330→100 km/h and 100→0 km/h stops changed by 1.4–1.9 m because the scripted chop to full brake now overlaps the 0.1 s throttle roll-off.

Targets and public sources. The figures come from web search results on 2026-10-24; this environment could not open the pages themselves, so they are cited as reported.

| Quantity                  | Public figure                                                                            | Source                                                                                                                                                                                                                                                         | Now                                              | Verdict                                                              |
| ------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------- |
| Peak braking deceleration | ~1.5 g at the hardest corner of most circuits; Brembo's "high" braking zones are ≥ 1.4 g | Brembo race-weekend braking reports ([Mugello 2026](https://www.brembo.com/en/motorsport/motogp/2026/facts-mugello-2026), [most demanding circuits](https://www.brembo.com/en/motorsport/motogp/demanding-circuit))                                            | mean 1.42 / 1.52 g, 50 ms peak 1.86 / 2.02 g     | Mean in range; the 50 ms peak is higher than the quoted figure       |
| A long stop               | Mugello Turn 1: 337 → 94 km/h in 5.4 s over 291 m                                        | Brembo Mugello 2026, as above                                                                                                                                                                                                                                  | 330 → 100 km/h in 4.60 / 4.30 s over 262 / 244 m | About 10–15 % shorter than the real stop                             |
| Top speed                 | 366.1 km/h record (Mugello, 1.141 km straight)                                           | [MotoGP.com: official outright speed record](https://www.motogp.com/en/news/2024/05/31/what-is-the-official-outright-motogp-speed-record/165090)                                                                                                               | 353.7 / 342.5 km/h on an unlimited runway        | Plausible; below the record                                          |
| 0–100 / 0–200 km/h        | ~2.6 s / ~4.8 s                                                                          | [Red Bull, MotoGP vs F1 (2015)](https://www.redbull.com/at-de/motogp-repsol-honda-team-f1-red-bull-racing-2015)                                                                                                                                                | 3.03 / 6.40 s (GP-R1)                            | Slower than the real bikes: wheelie control keeps launch near 0.95 g |
| Lean angle in racing      | 60–65° typical; 64° at 153 km/h in Márquez's 2017 Valencia save                          | [GPone, 2017](https://www.gpone.com/en/2017/11/21/motogp/marquez-at-153-kmh-and-64deg-heres-how-he-didnt-crash.html); [Visordown](https://www.visordown.com/news/racing/motogp/watch-marquez-be-outrageous-again-reveals-65%CB%9A-lean-isn%E2%80%99t-intended) | chassis 55.6–56.9° with full hang-off            | A few degrees short of race telemetry                                |
| Lap time                  | Poggio Alto is an original 5.245 km circuit, so there is no real lap to compare          | —                                                                                                                                                                                                                                                              | 114.3–114.6 s (165 km/h average)                 | Sanity only                                                          |

AI races complete deterministically. The 8-rider, 2-lap Poggio Alto race (seed 30101) gives an identical frame-hash sequence on two runs, both dry and wet. In the dry it classifies all 8 riders with no crash. It still has one 3 J touch between two riders running side by side, which `gp-tyre-contact` rejects. In the wet it completes, but is not clean (see below).

Not solved, measured:

- **Corner entry.** The GP AI's approach plan assumes the full straight-line braking envelope right up to the apex. On the leaned entry ramp it realises about half of that (3.6 m/s² against a planned 7.1 m/s², Poggio Alto hairpin), so both bikes reach the apex at 1.5 g and run 5–6 m wide of the racing line on exit. GP-R2 carries 24.24 m/s at the hairpin "apex" sample against the `gp-braking-approach` bound of < 24. Planning each corner speed 12 m earlier fixes the line, but costs 2.2–2.8 % of lap time everywhere, so it was not adopted.
- **Wet pace.** On standing water the slick-to-wet contact grip is 0.40 of dry. Wet AI laps take 188–227 s against 114–121 s dry, where real wet races are roughly 10–15 % slower. One rider runs 7.7 m off the track into a 28 m-radius bend at 16.8 m/s (about 1 g needed, 0.55 g available).
- **Passing.** The shared traffic planner keeps a car-sized following reserve, 7 m + v·(0.45 + 0.12·(1 − consistency)), about 33 m at 52 m/s, while a rival is inside the corridor of the bike's current position. A GP rider in the tow therefore cannot close up while it moves across, and the pass aborts as "not closing". This is why `gp-riding-control` catch-and-pass and the `bike-session` WP35 "GP faster than superbikes" race fail: in clean air GP-R1 laps Vellamar in 77.9 s against the superbike's 82.7 s.

## Background

- MotoGP on corner speed and rider hanging off: https://www.motogp.com/en/news/2020/11/26/how-do-motogp-riders-corner-so-fastx/1088112
- MotoGP on engine braking: https://www.motogp.com/en/blog-articles/what-is-motogp-engine-braking/823663
- Non-proprietary shared tyre-force law: src/simulation/tyre-force.ts
- Camber/cornering-stiffness ratio of racing slicks: V. Cossalter, _Motorcycle Dynamics_, ch. 2 (cited in motogp-physics.ts)
