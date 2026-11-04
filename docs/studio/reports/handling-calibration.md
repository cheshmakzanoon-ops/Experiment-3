# Handling and calibration — Gameplay QA (headless)

Branch `studio/qa-handling-calibration`, cut from main `99a235d` (physics v21). Physics version bumped to **23** (22 is reserved for the GP-bike mixed-field passing work; the PM reconciles). Numbers only: **no human has driven any of these machines**, so everything below is a measurement of the simulation, not a judgement of feel.

## 1. Verdict

- A repeatable benchmark now exists for **all 57 machines** (`scripts/studio/tools/machine-benchmark.ts`; output in `machine-benchmark.{json,md}` beside this file, the pre-fix run in `machine-benchmark-before.*`).
- It found **one genuine defect**: HF-86's automatic gearbox hunted between 1st and 2nd for ever and the car could not pass **124 km/h** (its strict calibration had been red since physics v20; the committed `docs/vehicle-calibration.json` still said 321 km/h because it was stale). Fixed in data, with a failing-then-passing test.
- It found **one clear calibration error** (MX-450 capped at 125 km/h, below the 250 two-stroke), **two machines that did not match their own brief** (GT-6S, XT-1) and **a stale XF-2 AI envelope** hidden by the stale calibration file. All fixed with data edits only; no core physics code changed.
- Flags against the general-knowledge sanity bands: **19 before, 17 after**. The rest are marginal (0.5 to 15 % outside a deliberately wide band) or AI-side; each has a disposition in section 5.
- `scripts/vehicle-calibration.ts --strict`: **228 of 228 metrics in band** (57 machines x 4), exit 0. Before: HF-86 top speed 124.09 km/h against 305 to 345, exit 1.
- Every machine now has a distinct one-line character shown under the MACHINE dial of the Paddock Board (section 8).

## 2. What was measured, and how

`scripts/studio/tools/machine-benchmark.ts` — fixed dry day, no weather, default `sport` assist (ABS + traction control), medium compound, default setup, 240 Hz.

| metric | how |
|---|---|
| 0-100, 0-200 km/h, top speed | full throttle on the 100 km analytic runway until 4 s without gain; the entrant is built by `createEntrant`, the factory the production `Simulation` uses (Vehicle, BikeVehicle or DirtBikeVehicle) |
| 100-0 km/h | full ABS stop; bikes front brake plus rear |
| skidpad lateral g | **closed loop** on a 50 m circle (and a 150 m one, where downforce machines show their aero grip): a pure-pursuit driver holds the circle while the speed creeps up 0.3 (0.6) m/s per s; g = v squared over R at the best 0.6 s-filtered value while within 2 m of the circle and pointing along it. Cars trim steering on the curvature made; bikes lean-steer with a long preview |
| understeer gradient, lift-off and full-throttle rotation (cars) | steady state on the 50 m circle at 90 % of the limit speed; then the steering is frozen and the throttle lifted (or floored) for 1.5 s and the rotation toward the circle measured |
| slalom exit speed | 80 km/h, then coast (no throttle, no brake) through three 60 m waves of 1 m amplitude with the same pursuit driver; scrub = speed lost against a straight coast over the same distance |
| mass, power, power/weight | mass from the definition (a bike's includes its rider); power derived from the solver's net torque curve (hybrid crankshaft motors included, a front-axle motor not), a bike's stated peak |
| reference lap | the **whole production `Simulation`** (AI driver, race control, lap timing), solo practice, 4 laps, best valid lap, seed 90210, on **Aurel** for every machine, plus `valley-ridge-mx` (motocross rules) for the two motocross bikes and `kestrel-rx` (rallycross) for the rally, rallycross and off-road cars. Karts run on Aurel too: that is where the catalogue races them |

Honest limits:

- The straight-line, braking, skidpad and slalom runs use the repository's analytic calibration fixture (`scripts/dynamics-fixtures.ts`) with the production vehicle code, not the full `Simulation` on a track. Only the lap runs use the whole `Simulation`.
- The sanity bands are **general-knowledge class ranges written for this review** (`machine-benchmark.md`, section "General-knowledge sanity bands used"). They are **not licensed or measured data** for any vehicle, every machine here is original, and they are wide on purpose: an out-of-band value is a question, not a verdict. The ranges the brief stated (formula, GT3, GP bike, motocross 450, hot hatch, electric hypercar) are used as given; a few others were widened or aligned after the first look, each with its reason in the tool.
- "Feel" is three numbers (understeer gradient, lift-off rotation, full-throttle rotation) on a flat skidpad with the default assist. It says nothing about steering weight, kerbs, camber, transitions through braking, tyre wear, turbo lag, aero platform or any input device. Bikes have no feel measurement.
- The full-throttle test saturates: every powerful rear-drive car "spins" (50 degrees and more), so those cars are only separated by the other numbers.
- AI laps measure the AI and the machine together. Four machines run wide at one Aurel corner on later laps (section 5), so their best valid lap comes from laps 1 and 2.
- The host is a shared 4-CPU machine: wall-clock times in the logs mean nothing; the simulated numbers are deterministic (re-running reproduces them exactly, which is how the before/after table isolates the five edited machines).

## 3. What was fixed (data only, plus tests)

| file | change | why |
|---|---|---|
| `src/simulation/vehicle-catalogue/single-seaters.ts` | HF-86 `downshiftRPM` 8000 -> 7200 | the 1->2 step is 1.357, so a shift at 11 600 rpm lands at 8 550, and the launch wheelspin that triggered it collapses once the torque is cut: road-coupled rpm in 2nd fell to about 7 900, under the 8 000 downshift point, so the box went straight back to 1st, for ever (55 gear changes in the last 10 s). Every other four-wheel machine keeps at least 14 % margin; HF-86 had 6.8 %. A previous attempt to fix this in `vehicle.ts` (a road-rpm upshift guard, commit 447b160) was rolled back in 652a00f because it blocked wheelspin-relieving launch shifts, so this is deliberately a data fix |
| `src/simulation/offroad/dirt-bikes.ts` | MX-450 fifth gear 3.12 -> 2.78 | the old ratio hit the rev limiter at 125 km/h, below the 250 two-stroke (129) and below a 450's real top end (130 to 150). A longer **fourth** was tried first and rejected: it changed which riders fell in the seeded Valley Ridge moto (3 falls, 2 unclassified, 408 s against 284 s), while a fifth-only change leaves that race bit-identical |
| `src/simulation/vehicle-catalogue/gt-layouts.ts` | GT-6S `rearGrip` 1.07 -> 1.14 | its brief is "stable, nose-heavy, understeering", but it measured *less* understeer than the front-mid V8 (1.95 against 2.38 deg/g) and spun on full throttle exactly like it (56 against 55 degrees): a copy-paste feel. Now 2.48 deg/g and 39 degrees. Side effect: 0-100 3.49 -> 3.30 s (the brief said about 3.5) |
| `src/simulation/vehicle-catalogue/experimental.ts` | XT-1 `tireGrip` 0.90 -> 0.94 and its AI envelope refit; XF-2 AI envelope refit (lateral 20.64, braking 27.82, fan share 7.58 / 12.18) | XT-1 measured 1.47 g at 80 km/h against a 1.6 g brief and 0.014 above its 1.45 g band floor (the repository requires 0.015); the stale calibration file had hidden it. Regenerating that file showed the XF-2 AI braking envelope 2.6 % optimistic (the fan-share test went red) |
| `src/core/session-identity.ts`, `tests/session-identity.test.ts` | physics 21 -> **23** | the HF-86, MX-450, GT-6S, XT-1 and XF-2 definitions changed, so their seeded sessions move; every other machine replays as under v21 (the lap tables confirm it: only those five differ) |
| `docs/vehicle-calibration.json`, `docs/production/CONTENT_PIPELINE.md`, `docs/offroad-calibration.json`, `docs/wildcard-races.json` | regenerated | the committed calibration was stale for **every** machine (braking 0.1 to 0.6 m, 0-100 up to 0.12 s) because physics changed since it was last written; content hashes changed only for hf86, gt6s, xt1, xf2, mx450 |
| `tests/gear-hysteresis.test.ts` (new) | every four-wheel machine keeps its post-upshift rpm 10 % above its downshift point; HF-86 passes 250 km/h in under 25 s with at most six gear changes | **failed before (2 of 2), passes after.** It also guards the data of future machines |

Before and after, for the five machines that changed (full tables in the benchmark reports):

| machine | metric | before (v21) | after (v23) |
|---|---|---:|---:|
| hf86 | top km/h | 124 | 322 |
| hf86 | 0-200 s | not reached | 5.39 |
| hf86 | gear changes in last 10 s of top-speed run | 55 | 0 |
| hf86 | Aurel lap 1 s (standing start) | 77.95 | 60.31 |
| hf86 | Aurel best valid lap s | 61.13 | 58.74 |
| hf86 | 0-100 s, 100-0 m, skid g | 2.98, 20.8, 1.81 | unchanged |
| gt6s | 0-100 s | 3.49 | 3.30 |
| gt6s | 100-0 m | 25.6 | 25.1 |
| gt6s | understeer deg/g | 1.95 | 2.48 |
| gt6s | full-throttle rotation deg | 56.2 | 39.1 |
| gt6s | skid g at 50 m / 150 m | 1.47 / 1.48 | 1.48 / 1.51 |
| gt6s | Aurel best valid lap s | 70.20 | 70.18 |
| xt1 | 0-100 s | 2.49 | 2.38 |
| xt1 | 100-0 m | 22.0 | 21.1 |
| xt1 | skid g at 50 m | 1.71 | 1.79 |
| xt1 | lateral g at 80 km/h (calibration) | 1.47 | 1.53 |
| xt1 | Aurel best valid lap s | 61.59 | 60.12 |
| xf2 | Aurel best valid lap s (AI envelope refit only) | 52.66 | 52.82 |
| mx450 | top km/h | 125 | 140 |
| mx450 | 0-100 s, 100-0 m, skid g | 5.08, 46.2, 0.78 | unchanged |
| mx450 | Aurel / Valley Ridge best lap s | 103.70 / 72.34 | 103.64 / 72.34 |

Not changed on purpose: the AI source files (`ai.ts`, `bike-ai.ts`, `traffic.ts`) belong to the concurrent GP-bike passing work, so AI-side findings below are reported, not fixed.

## 4. Sanity-band results, all 57 machines

The full table (by class, outliers marked `!`, plus the band table) is in [machine-benchmark.md](machine-benchmark.md). The ranges the brief stated, as measured now:

| class | reference | measured |
|---|---|---|
| hot hatch (RH-3) | 0-100 about 5 to 7 s | 5.20 s |
| GT3-style (GT-8F, GT-10M, GT-6R, GT-6S) | 0-100 3 to 3.5 s; 1.4 to 1.8 g skid | 3.30 to 3.53 s; 1.48 to 1.53 g |
| formula (APX-01, FX-26) | 0-100 2.2 to 2.6 s; 100-0 under 30 m; 3 g or more with aero | 2.54 / 2.34 s; 18.7 / 18.3 m; 3.48 g (APX-01 at 150 m) and 2.69 g (FX-26, by design about a quarter less downforce) |
| GP bike (GP-R1, GP-R2) | 0-100 2.6 to 3 s; top 330 to 360 km/h | 3.03 / 3.07 s (1 to 2 % slow, left as marginal); 354 / 343 km/h |
| motocross 450 (MX-450) | top 130 to 150 km/h | **125 -> 140 km/h** |
| electric hypercar (EH-3) | 0-100 2 to 2.5 s | 2.43 s |
| trophy truck (DX-8) | no stated figure | 0-100 5.29 s, top 211 km/h, 0.99 g |
| shifter kart (SK-125) | no stated figure | 0-100 4.08 s, top 137 km/h, 1.95 g, 18.8 m stop |

## 5. Every flag, and what was done

Flags before (19) and after (17):

| flag | disposition |
|---|---|
| HF-86 top speed 124 km/h, 55 gear changes at top speed | **fixed** (section 3) |
| MX-450 top speed 125 km/h | **fixed** |
| GT-6S feel identical to GT-8F | **fixed** |
| XT-1 under its brief (1.47 g against 1.6 g) | **fixed** |
| GP-R1 / GP-R2 0-100 3.03 / 3.07 s against 2.6 to 3.0 | marginal (1 to 2 %), left: both are inside the authors' own design band and the 0-100 is traction-limited |
| HY-9 skid 1.79 g (band floor 1.8); HY-9, HY-11, PR-2, XH-3, XT-1 on the 150 m circle at 1.7 to 1.94 g (band floors 1.8 to 2.2) | marginal (0.5 to 15 %), left: these are the low-drag endurance designs, my band probably over-asks them |
| SC-7 100-0 28.2 m (band 30 to 38), RS-5 31.2 (32), RM-8 32.4 (33) | marginal (3 to 6 % short), left: road-tyre ABS stops slightly too well; a tyre trim would change their lap pace and needs its own pass |
| RH-3 skid 1.18 g (band 1.15), SM-450 100-0 44 m (band 42) | marginal (3 to 5 %), left |
| GT-6R only 1 valid AI lap on Aurel; GT-10M 2; GS-4 3; XT-1 2 and a 5.5 s stand-still | **not fixed, AI-side.** Same pattern for all four: laps 1 and 2 are clean, then on lap 3 or 4 the car runs 7 to 10 m wide at Aurel station 660 to 740 and is penalised or stops. Lowering GT-6R's AI margins did not remove it (tested, reverted), so it is not a margin value. Needs the AI owner (tyre temperature or wear at that corner is the first suspect) |
| HF-67 AI lap 100.06 s, slower than the hot-hatch racer (83.89 s) and as slow as the 100 kW vintage roadster; SP-71 90.88 s, slower than the road hot hatch (88.94 s) | **open, recommended.** Both are 500 kW/t machines on the `historic` bias-ply tyre family at 1.09 and 1.17 g. Not edited: HF-67 is hash-frozen by `tests/vehicle-catalogue-growth.test.ts` and its design bands (lateral 0.95 to 1.35 g, braking 32 to 52 m) say the low grip is intended. If a plausible 1960s car is wanted, raise the historic tyre family by about 10 % and move those bands with it |

Lap checks: all 57 machines complete 3 laps on Aurel and the dirt and rallycross reference laps complete; the class ordering holds except for the HF-67 / SP-71 cases above. Karts are slower than touring cars on Aurel (SK-125 90.3 s at 118.6 km/h average, top speed 137): that is a kart on a 3 km circuit with long straights, not a defect.

### Near-identical pairs in one class

Largest relative difference of 0-100, top speed, 100-0, skid g, fast skid g, mass, power/weight and lap under 10 %:

| pair | performance | feel distance (under 1 = same feel) | verdict |
|---|---|---|---|
| GT-8F / GT-6S | 3.6 % | 1.04 (understeer 2.38 / 2.48, full throttle 55 / 39 degrees) | distinct since the fix, but only just |
| GT-8F / GT-10M, GT-8F / GT-6R, GT-6R / GT-6S | 6 to 8 % | 1.8 to 3.7 | twin performance (a balanced class), distinct feel |
| GS-4 / GS-6M | 5.9 % | 1.86 | twin performance, distinct feel |
| GP-R1 / GP-R2 | 4.7 % | not measured | twin by design; a test already pins their trade (GP-R2 stops shorter, tops out lower, launches slower) |
| **PR-2 / PR-3** | 6.3 % | 0.08 | **copy-paste in steady state.** They differ in turbo lag and wake drag, which this suite does not measure. Recommended: a transient corner-exit test, then differentiate |
| **RH-3 / RR-4** | 8.4 % | 0.63 | **copy-paste in steady state** (FWD against AWD only shows in power-on drift, 2.27 against 1.42 m). A 4 % lower rear grip on RR-4 gave +1.5 degrees of lift-off rotation: too small to matter, reverted. Needs a larger, brief-backed change |

Previously close, now clear once power/weight and the fast-circle grip are part of the comparison: APX-01 / FX-26 (785 against 989 kW/t; 3.48 against 2.69 g) and MX-450 / MX-250 (top speed 140 against 129 km/h; 262 against 209 kW/t).

## 6. Verification (what was run, and what it said)

| command | result |
|---|---|
| `node --no-warnings --experimental-transform-types scripts/studio/tools/machine-benchmark.ts` (all 57, with laps) before and after; XT-1, XF-2 and MX-450 re-measured with `--merge` after their last edits | 57 machines; 19 flags before, 17 after; deterministic |
| `scripts/vehicle-calibration.ts --strict` | exit 0, 228 OK, 0 OUT (before: HF-86 `topSpeed` OUT) |
| `scripts/offroad-calibration.ts` | 0 band failures (0-60 m: 4.53 / 4.50 / 4.43 s) |
| `scripts/wildcard-races.ts knobblies-on-the-banking,the-long-way-round` (the two events whose machine changed: MX-450) | both PASS |
| `scripts/offroad-races.ts` (`OFFROAD_RACE="motocross moto"` and `"supercross main"`; evidence file restored afterwards) | both complete and classify everyone; the first attempt (longer fourth gear) failed and was rejected |
| circuit events that field HF-86, GT-6S, XT-1 or XF-2 (6 events, run headless by a scratch script, not committed) | EVENTS_RESULT |
| vitest: `vehicle-catalogue`, `vehicle-catalogue-growth`, `vehicle-definitions`, `calibration`, `gear-hysteresis`, `machine-character`, `session-identity`, `steam-leaderboards`, `wildcard-series`, `wildcard-venues-2`, `circuit-catalogue-wave2-review`, `machine-options`, `front-end-board`, and eight motocross / offroad files | all pass |
| `npx tsc --noEmit`, `eslint` on every changed file, `prettier --check` | clean |
| DOM-only render of the real Interface (`scripts/studio/tools/uxdom.mjs`: menu, GP, dirt, festival) | the line renders under the MACHINE dial in all four and there are no page errors; **no WebGL boot and no real-GPU or full-flow run** |
| `tests/demo-edition.test.ts` | **one failure that is not mine**: it expects "44 MORE CIRCUITS" and the demo plate now says 48 (the four new venues); it fails the same way on main |
| `scripts/catalogue-races.ts` | not run: it drives a Formula-car field on every circuit and none of the five changed machines is in it. `scripts/endurance-event-races.ts` and the one-hour `loirette-dusk-endurance` event (which fields GT-6S) were not run: they take far longer than this session allowed |

## 7. Recommended next (ranked)

1. AI owner: the Aurel station 660 to 740 run-off on later laps (GT-6R, GT-10M, GS-4, XT-1) and what the AI does with hot tyres there.
2. Retune the historic tyre family and the HF-67 / SP-71 bands together (HF-67 is hash-frozen: update `FROZEN` with a stated reason).
3. A transient test (corner-exit throttle after a lift) so turbo-lag machines (PR-3, HF-86, GB-4, RR-4) can be told apart from their naturally-aspirated twins; then break the PR-2 / PR-3 and RH-3 / RR-4 copy-pastes.
4. A bike feel measure (lean-in rate, wheelie and stoppie onset) so GP-R1 / GP-R2 and the two motocross bikes can be compared on feel as well as on numbers.
5. A human drive of the five changed machines (HF-86 launch, MX-450 top end, GT-6S, XT-1 and XF-2): none of this has been felt.
6. Re-run `machine-benchmark.ts` whenever a definition, tyre family or the solver changes: the committed calibration had silently drifted for every machine.

## 8. Machine identity (all 57)

Each line is `MACHINE_CHARACTER` in `src/ui/machine-character.ts`, written from the numbers above. The line carries **no figures of its own**: the mass, power and drive beside it are derived from the definition at run time (`machineFacts`), so a recalibration cannot leave a stale number on screen. `tests/machine-character.test.ts` enforces one distinct line per machine, no figures, no real brand or team name (it runs the IP deny-list) and no repeated opening within a class. The line appears under the MACHINE dial of the Paddock Board (`#machineBlurb`, set in `launch-board.ts`). The measured columns are from `machine-benchmark.json` (physics v23).

| class | id | machine | facts | good at / feels like | 0-100 s | top km/h | 100-0 m | skid g | Aurel lap s |
|---|---|---|---|---|---:|---:|---:|---:|---:|
| Formula | apx01 | APX-01 FORMULA | 770 kg · 605 kW · RWD | The reference formula car: huge downforce and brutal brakes, near neutral on the nose, and it spins if you floor it mid-corner. | 2.54 | 321 | 18.7 | 2.44 | 49.77 |
| Formula | fx26 | FX-26 FORMULA | 768 kg · 759 kW · RWD | Electrified top-tier formula: more power and a quarter less downforce than the APX-01, so it launches harder and lifts earlier in fast sweeps. | 2.34 | 342 | 18.3 | 2.48 | 51.34 |
| Junior formula | jf2 | JF-2 JUNIOR FORMULA | 790 kg · 456 kW · RWD | Feeder-series single-seater: two-thirds of the top cars' aero grip, firm brakes, and a rear that steps out when you floor it. | 2.65 | 309 | 20.2 | 2.06 | 54.79 |
| Feeder formula | fr3 | FR-3 FEEDER FORMULA | 675 kg · 277 kW · RWD | Third-rung spec formula: honest balance, little speed lost weaving, and tow-heavy pack racing on modest power. | 2.93 | 267 | 21.1 | 1.95 | 60.34 |
| Entry formula | fe4 | FE-4 ENTRY FORMULA | 570 kg · 126 kW · RWD | First rung of the ladder: light, nearly neutral and planted under power, with a sharp turn-in on a lift and little power to cover mistakes. | 3.6 | 208 | 23.7 | 1.81 | 69.88 |
| Historic formula | hf67 | HF-67 HISTORIC FORMULA | 595 kg · 306 kW · RWD | Sixties cigar-tube: light and quick in a straight line but short of grip on narrow tyres, so it pushes, then spins when you add power. | 4.06 | 276 | 33.4 | 1.09 | 100.06 |
| Historic formula · 1970s | hf76 | HF-76 HISTORIC FORMULA | 650 kg · 357 kW · RWD | Seventies winged formula: wide slicks and a big wing give real fast-corner grip and drag; a lift swings the tail round quickly. | 3.12 | 285 | 24.9 | 1.54 | 69.09 |
| Historic formula · 1980s turbo | hf86 | HF-86 TURBO FORMULA | 620 kg · 583 kW · RWD | Turbo-era brute: huge power for its weight, and the boost arrives late, so it comes in a rush out of slow corners. | 2.98 | 322 | 20.8 | 1.81 | 58.74 |
| Hypercar | hy11 | HY-11 HYPERCAR | 1030 kg · 520 kW · RWD | Hybrid prototype with more downforce and less top speed than the HY-9, its torque helped by a small crankshaft motor. | 2.87 | 318 | 21.8 | 1.83 | 59.58 |
| Hypercar | hy9 | HY-9 HYPERCAR | 1030 kg · 460 kW · RWD | Hybrid endurance prototype: low drag, a front motor that only joins in at speed, strong stable braking, and a rear that steps out on full throttle. | 2.93 | 335 | 22 | 1.79 | 60.1 |
| Prototype | pr2 | PR-2 PROTOTYPE | 950 kg · 440 kW · RWD | Closed spec prototype: near neutral and strong in fast corners, short of straight-line speed against the hypercars. | 2.93 | 312 | 21.9 | 1.82 | 59.59 |
| Prototype | pr3 | PR-3 OPEN PROTOTYPE | 930 kg · 403 kW · RWD | Open-cockpit prototype: turbo torque and low-speed downforce, draggy on the straights and laggy at corner exit. | 3.08 | 295 | 21.7 | 1.84 | 60.72 |
| Historic sports prototype | sp71 | SP-71 LONG-TAIL PROTOTYPE | 860 kg · 435 kW · RWD | Long-tail seventies prototype: very high top speed on little grip, so it pushes in corners and takes a long stop, but stays planted on power. | 3.46 | 336 | 28.3 | 1.17 | 90.88 |
| GT | gt8f | GT-8F FRONT-ENGINE GT | 1310 kg · 405 kW · RWD | Front-mid V8 GT: stable under braking with torque out of slow corners; it pushes on turn-in and spins up on full throttle. | 3.42 | 279 | 25.3 | 1.53 | 69.23 |
| GT | gt6s | GT-6S STRAIGHT-SIX GT | 1340 kg · 400 kW · RWD | Long front-engine straight-six GT: the stable, understeering heavyweight, with turbo torque that gets it up to speed quickly. | 3.3 | 282 | 25.1 | 1.48 | 70.18 |
| GT | gt10m | GT-10M MID-ENGINE GT | 1290 kg · 432 kW · RWD | Mid-engine V10 GT: the most power of the four GTs, neutral-ish balance, and it spins less than the V8 under full throttle. | 3.3 | 280 | 24.9 | 1.49 | 71.29 |
| GT | gt6r | GT-6R REAR-ENGINE GT | 1270 kg · 381 kW · RWD | Rear-engine flat-six GT: the weight over the rear tyres gives traction and braking, staying planted on power while the light nose pushes. | 3.53 | 291 | 24.8 | 1.48 | 74.6 |
| GT Sport | gs4 | GS-4 GT SPORT | 1460 kg · 330 kW · RWD | Entry GT: easy-to-read turbo six with plenty of torque, the heaviest GT, and it lets go on full throttle at the limit. | 3.84 | 259 | 29 | 1.36 | 78.84 |
| GT Sport | gs6m | GS-6M MID-ENGINE GT SPORT | 1400 kg · 300 kW · RWD | Mid-engine entry GT: planted under power and neutral-ish, with a third less torque than the GS-4 and a lighter nose. | 3.98 | 257 | 28.8 | 1.28 | 79.91 |
| Touring | tc2 | TC-2 TOURING | 1240 kg · 280 kW · RWD | Rear-drive touring saloon: rotates well on entry, then goes loose if you are early on the power. | 4.07 | 240 | 27.3 | 1.39 | 75.02 |
| Touring | tc3 | TC-3 AWD TOURING | 1300 kg · 286 kW · AWD | All-wheel-drive touring saloon: the best launch of the touring cars and planted on throttle, though it pushes on turn-in. | 3.61 | 246 | 28 | 1.36 | 76.6 |
| Touring | tc1 | TC-1 TOURING | 1265 kg · 198 kW · FWD | Front-drive touring saloon: stable on a lift and under braking, but it pushes wide as soon as you ask for power. | 4.94 | 232 | 27.6 | 1.41 | 79.74 |
| Club | cr1 | CR-1 CLUB ROADSTER | 620 kg · 132 kW · RWD | Lightweight club roadster: low inertia and quick to rotate, with a tail that comes round fast on throttle or a lift; short of top speed. | 4.36 | 200 | 28.9 | 1.27 | 83.18 |
| Club | hh2 | HH-2 HOT-HATCH RACER | 1180 kg · 207 kW · FWD | Front-drive hot-hatch racer: braking-stable and torquey, but the front tyres are overloaded on power and it pushes wide. | 4.83 | 229 | 31.7 | 1.26 | 83.89 |
| Vintage club | vc62 | VC-62 VINTAGE ROADSTER | 760 kg · 100 kW · RWD | Vintage club roadster: slow and soft with a long brake lead, forgiving until the tail swings out under power. | 6.38 | 194 | 35.5 | 0.95 | 99.32 |
| Rally | rl2 | RL-2 RALLY | 1330 kg · 213 kW · AWD | Rally car on gravel tyres: traction on any surface and short gearing, but very understeery and tall on asphalt. | 4.25 | 192 | 32.7 | 1.17 | 89.03 |
| Historic rally | gb4 | GB-4 GROUP RALLY | 1120 kg · 368 kW · AWD | Group-supercar rally monster: violent acceleration and planted traction everywhere, understeering on asphalt. | 3.54 | 221 | 30.6 | 1.24 | 87.53 |
| Historic rally | rl7 | RL-7 CLASSIC RALLY | 1100 kg · 182 kW · RWD | Seventies rear-drive rally saloon: light and tail-happy on throttle, very stable on a lift, short of grip and top speed. | 5.44 | 186 | 33.2 | 0.96 | 91.84 |
| Rallycross | rcx6 | RCX-6 RALLYCROSS | 1300 kg · 472 kW · AWD | Rallycross supercar: brutal sprint acceleration and abrupt power with short gearing; built for loose surface, very understeery on tarmac. | 2.55 | 237 | 31.3 | 1.2 | 81.85 |
| Rallycross | rxe | RX-E ELECTRIC RALLYCROSS | 1490 kg · 518 kW · AWD | Electric rallycross car: instant torque and no gear changes, but heavy and understeery in direction changes. | 2.5 | 226 | 31.8 | 1.19 | 82.77 |
| Off-road | dx8 | DX-8 TROPHY TRUCK | 2720 kg · 630 kW · RWD | Desert trophy truck: huge power in a heavy, tall body that rolls, brakes long and spins up on throttle; a loose-surface specialist. | 5.29 | 211 | 39.1 | 0.99 | 99.49 |
| Off-road | bg2 | BG-2 DESERT BUGGY | 1650 kg · 323 kW · RWD | Desert buggy: lighter than the truck and quick to turn, but the tail swings on a lift and under power, and it brakes long. | 4.51 | 191 | 39.8 | 1.08 | 99.79 |
| Kart | sk125 | SK-125 SHIFTER KART | 175 kg · 36 kW · RWD | Shifter kart: enormous grip for its weight and the shortest stops of any machine, but a low top speed makes it slow on a big circuit. | 4.08 | 137 | 18.8 | 1.95 | 90.27 |
| Kart | dk100 | DK-100 DIRECT-DRIVE KART | 155 kg · 23 kW · RWD | Direct-drive sprint kart: momentum and line discipline, slow off the line, with rear-only brakes that make it stop long. | 9.39 | 116 | 40.5 | 1.83 | 104.44 |
| Experimental | xf2 | XF-2 FAN PROTOTYPE | 780 kg · 390 kW · RWD | Fan-assisted prototype: grip and braking that do not wait for speed, the highest in the game, until a crest or kerb breaks the seal. | 2.63 | 317 | 14.5 | 2.78 | 52.82 |
| Experimental | xe1 | XE-1 ELECTRIC TIME ATTACK | 1000 kg · 508 kW · AWD | Electric time-attack prototype: the quickest launch here and strong downforce in medium and fast corners, drag-capped on the straights. | 2.18 | 256 | 19.1 | 2.23 | 56.46 |
| Experimental | xt1 | XT-1 TRACK HYPERCAR | 1120 kg · 748 kW · RWD | Track-only V12 hypercar: power everywhere, the highest top speed of any car, and a rear that spins up on full throttle. | 2.38 | 355 | 21.1 | 1.79 | 60.12 |
| Experimental | xh3 | XH-3 HYDROGEN PROTOTYPE | 1250 kg · 494 kW · AWD | Hydrogen prototype: efficient low drag and four-wheel traction, but a single reduction gives up acceleration at the top. | 2.97 | 316 | 22.8 | 1.71 | 61.63 |
| Road (open-world) | eh3 | EH-3 ELECTRIC HYPERCAR | 1980 kg · 1131 kW · AWD | Electric road hypercar: instant torque and four-wheel traction launch it hard, but its mass pushes wide in every corner. | 2.43 | 349 | 28.5 | 1.29 | 73.86 |
| Road (open-world) | sc7 | SC-7 SUPERCAR | 1480 kg · 530 kW · RWD | Mid-engine road supercar: acceleration and top speed first, planted on power, with strong road-tyre braking. | 3.21 | 332 | 28.2 | 1.25 | 78.05 |
| Road (open-world) | rs5 | RS-5 SPORTS SEDAN | 1820 kg · 395 kW · AWD | Four-door sports sedan: launch, torque and all-weather traction, with a heavy, understeery nose and mass in the braking zones. | 3.47 | 302 | 31.2 | 1.2 | 87.47 |
| Road (open-world) | rh3 | RH-3 HOT HATCH | 1500 kg · 233 kW · FWD | Road hot hatch: usable torque and a soft front end that saturates on power out of slow corners. | 5.2 | 260 | 33.9 | 1.18 | 88.94 |
| Road (open-world) | rr4 | RR-4 RALLY-BRED ROAD CAR | 1600 kg · 228 kW · AWD | Rally-bred road car: traction on any surface and a little more rotation on a lift than the hot hatch, with turbo lag and understeer on power. | 4.98 | 266 | 32.4 | 1.2 | 89.28 |
| Road (open-world) | lx12 | LX-12 LUXURY GT | 2080 kg · 475 kW · RWD | Luxury grand tourer: effortless torque, top speed and great stability, the most understeery machine here and heavy in every corner. | 3.97 | 333 | 36.1 | 1.08 | 90.77 |
| Road (open-world) | rd2 | RD-2 ROADSTER | 1110 kg · 135 kW · RWD | Light road roadster: balanced and easy to slide, a lift rotates it readily, short of power and top speed. | 6.33 | 233 | 35 | 1.2 | 91.36 |
| Road (open-world) | rm8 | RM-8 MUSCLE COUPE | 1820 kg · 341 kW · RWD | Front-engine muscle coupe: torque and a long top gear, planted under throttle until the tail snaps at the limit. | 4.72 | 295 | 32.4 | 1.17 | 91.85 |
| Road (open-world) | rp6 | RP-6 DESERT PICKUP | 2650 kg · 358 kW · AWD | Performance pickup: goes anywhere with torque to spare, but mass and height give it the longest stop of any road machine. | 5.15 | 187 | 40.4 | 0.94 | 105.17 |
| Road (open-world) | rg63 | RG-63 CLASSIC GRAND TOURER | 1250 kg · 220 kW · RWD | Sixties grand tourer: a sweet high-revving V12 and a long top speed on narrow tyres, long to stop and rolling in corners. | 6.15 | 268 | 39.2 | 1.04 | 106.35 |
| GP motorcycle | gpr2 | GP-R2 PROTOTYPE | 229 kg · 216 kW · BIKE | Second GP prototype: inline-four with more wing and drag, stops shorter but tops out and launches slower than the GP-R1. | 3.07 | 343 | 34.7 | 1.44 | 64.05 |
| GP motorcycle | gpr1 | GP-R1 PROTOTYPE | 229 kg · 224 kW · BIKE | Prototype GP bike: wings, the highest top speed here and the strongest lean grip; braking is stoppie-limited. | 3.03 | 354 | 36.4 | 1.44 | 64.08 |
| Superbike | sbk1000 | SBK-1000 SUPERBIKE | 272 kg · 160 kW · BIKE | Production-based superbike: quick, but a step down from the prototypes in lean, braking and top speed, with kind electronics. | 3.16 | 308 | 38.9 | 1.23 | 65.83 |
| Supersport | ss600 | SS-600 SUPERSPORT | 247 kg · 95 kW · BIKE | Supersport: light and agile, revs hard to make its speed, with less power to correct a late line. | 3.48 | 265 | 38.1 | 1.18 | 67.47 |
| Classic motorcycle | cr750 | CR-750 CLASSIC RACER | 232 kg · 75 kW · BIKE | Seventies two-stroke racer: narrow tyres, the weakest brakes of any bike and a lean limit you can feel; delicate to ride. | 4.21 | 237 | 48.5 | 1 | 76.29 |
| Road motorcycle (open-world) | nr900 | NR-900 NAKED ROADSTER | 257 kg · 88 kW · BIKE | Naked roadster: upright and draggy on road tyres, quick off the line, out of breath at high speed and long to stop. | 3.34 | 224 | 40.9 | 1 | 74.26 |
| Motocross | mx450 | MX-450 MOTOCROSS | 179 kg · 47 kW · BIKE | Four-stroke motocross bike: torque everywhere and a tall fifth for the straights; built for jumps, with long stops on asphalt. | 5.08 | 140 | 46.2 | 0.78 | 103.64 |
| Motocross | mx250 | MX-250 TWO-STROKE | 172 kg · 36 kW · BIKE | Two-stroke motocross bike: light and revvy, quicker off the line than the four-stroke but out of breath at the top end. | 4.98 | 129 | 45.5 | 0.78 | 106.41 |
| Supermoto | sm450 | SM-450 SUPERMOTO | 183 kg · 47 kW · BIKE | Supermoto: the motocross chassis on road wheels, with the best tarmac grip and top speed of the dirt bikes, still long to stop. | 4.75 | 150 | 44 | 0.95 | 89.94 |
