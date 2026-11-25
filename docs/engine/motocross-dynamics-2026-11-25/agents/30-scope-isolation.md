# Assignment 30 — non-MX scope isolation

## Result

Real gameplay comparison found and repaired one unintended non-MX arithmetic change. After the coordinator-authorized correction, the affected supermoto AI flight is bit-identical to the untouched baseline. Road supermoto, outdoor and stadium supermoto, Festival supermoto, GP motorcycle and touring-car scenarios also match exactly. Both knobby MX machines can legally run Aurel practice: their subsequent physics and outcomes match, while the intended MX placement tyre synchronization and optional foot-animation transport remain explicitly visible.

The new reusable comparator is `scripts/bench/motocross-scope-isolation.ts`. It loads the complete module graph separately from each explicit checkout, validates each session's eligibility, and drives production `Simulation` / `OpenWorldSimulation` instances. It never fabricates vehicle state, terrain, contact impulses or crash flags. The Festival reset uses its public command.

## Deterministic gameplay evidence

Baseline: `b527a7e01ea247f0233a2ec4f2850639bafbd887` in `../motobound-baseline`. Candidate HEAD: `f3b39eb8e1b02fc0677086819fc384b6ceacefc2`; task source was uncommitted. The intervening committed changes are CI receipts, not gameplay source.

The main matrix contains **11 scenarios × 48 seconds at 120 Hz**, each with **5,761 snapshots**, including initial placement. Every snapshot has 355 floats; total comparison is **63,371 snapshots / 22,496,705 frame values**. Production `Simulation` performs its ordinary two internal physics substeps. Seed is **30025**, weather clear, assist raw. Manual scenarios receive the same throttle, brake, rear-brake/clutch, steering and shift inputs: 4,920 throttle ticks, 840 braking ticks and eight shift edges. Three additional scenarios run their unchanged seeded autoplayer, covering much longer stretches of the actual venue. The Festival case also resets to the road at 30 seconds.

| Scenario | Distance, m | Peak speed, m/s | Crashes | Final state | Full-frame trajectory hash, baseline = candidate |
| --- | ---: | ---: | ---: | --- | --- |
| SM450 / Aurel, manual | 383.837 | 26.053 | 2 | riding | `0437a5bf2f084cf1` |
| SM450 / Valley Ridge, manual | 170.203 | 47.473 | 3 | riding | `56b14b92ea073442` |
| SM450 / Arena Nord, manual | 135.168 | 20.444 | 4 | separated | `a301c8a248b878af` |
| GP R1 / Aurel, manual | 529.711 | 30.662 | 2 | riding | `ea32d67338ceb1e6` |
| TC1 / Aurel, manual | 275.354 | 16.817 | 0 | four-wheel | `a716916d85a37ea8` |
| SM450 / Festival, manual/reset | 146.415 | 19.034 | 1 | remount | `21e3c573c0043049` |
| SM450 / Valley Ridge, AI, after correction | 535.222 | 23.101 | 0 | riding | `2b2c98d383d75fa1` |
| GP R1 / Aurel, AI | 1,858.303 | 68.011 | 0 | riding | `66c56c0a672ea107` |
| TC1 / Aurel, AI | 1,606.853 | 51.039 | 0 | four-wheel | `a3baa774ffc39139` |

These nine scenarios have **zero differing snapshot values** and **zero differences in the measured Float64 chassis, drivetrain, suspension, rotor and tyre state**. Outcome comparison includes travelled distance, peak speed, gears, observed rider states, final state/speed, retirement, crash count, lap count/validity and race-control events. Motorcycle controls produce actual highsides/lowsides, separation and remounts. All compared frame values are finite. The main matrix was run before the arithmetic correction; the affected SM450 AI row was rerun for the complete 48 seconds afterward. The other eight exact rows were unchanged by the correction.

## Two intended MX road-practice differences, retained without masking

Both checkouts' ordinary session eligibility accepts `mx250` and `mx450` on Aurel in practice. Festival explicitly rejects them, so no unsupported Festival path was invented.

1. **Placement tyre publication.** Each machine differs in exactly eight physical frame values, all at **tick 0**: `W0..W3.COMPRESSION` and `W0..W3.LENGTH`. First field is `W0.COMPRESSION`: MX250 **0 → 0.08213329315185547 m**, MX450 **0 → 0.08164596557617188 m**. Direct tyre state independently confirms the same eight changes. These are the intended shared-MX `settle()` synchronization from Assignments 14/15, now publishing the existing static suspension travel immediately. They are not excluded from the comparator's physical result. Every physical value from ticks **1 through 5,760** is identical, with physical hashes `ee1547dd40972900` for MX250 and `cffd793aad388b29` for MX450. Outcomes match exactly: MX250 travels 385.176 m with one crash and ends riding; MX450 travels 312.662 m with three crashes and ends remounting.
2. **Foot-animation transport.** The comparator separately reports only the explicitly named three `MX_FOOT` pose values and twelve `MX_FOOT_TRAJECTORY` values, and only for the two knobby machines. Complete-frame comparison still includes every value. The observed road differences are limited to six new trajectory fields: `RECORDED`, `EVENT`, `AGE`, `DIRECTION`, `CLOCK_HI`, `CLOCK_LO` (30,896 differing values for MX250; 15,740 for MX450). No posture, suspension-motion, chassis, race or other reserved field is broadly exempted. The original three foot poses did not differ in these runs.

The comparator intentionally returns exit status 1 when physical publication differs, including the eight known placement fields; it does not silently turn those into an exact-match pass.

## Reproduced unintended change and authorized correction

The original `sm450-outdoor-ai` run first diverged in Float64 at **tick 3,061 / 25.508333 s**, `position.z`: baseline **−4.725345782091716**, candidate **−4.725345782091715**. The first snapshot difference was **tick 3,155**, `W2.WEAR`: **3.4512805664370894e−20** versus **3.437365837570299e−20**. At 48 seconds the largest snapshot difference was **5.960464477539063e−8**, in `B.LEAN_RATE`; the largest measured direct-state difference was **3.770674084080383e−7 N**, rear suspension load. Final speed differed by approximately **4.26e−11 m/s**. Crash/lap verdicts remained the same, but this was still a real deterministic-scope change.

A fresh 32-second run reproduced the exact first fields, ticks and values. A baseline-versus-baseline control returned zero differences. Source inspection isolated `advanceFlight()` regrouping non-MX translation from `(sin/cos(heading) * flightSpeed) * dt` to `sin/cos(heading) * (flightSpeed * dt)`. The coordinator independently confirmed the cause and authorized this assignment to change only that non-MX arithmetic. The corrected branch preserves the original multiplication order and returns before the MX analytic-distance path. No MX force law, integration branch, specification or tuning changed. Ownership of the adapter was returned immediately.

The full 48-second rerun is now exact: full-frame hash **`2b2c98d383d75fa1`**, direct-state hash **`85c9f124279f1b7d`**, zero differences and identical outcomes.

## Identity and protected-source audit

Simulation identity changes intentionally from **39 to 40**. All remaining session identity fields compare equal, including protocol version, tick rate, vehicle hashes, circuit hash, ruleset hash, assist and seed. This global record-category version change is separate from gameplay trajectory equality. Protocol remains 17, header 24, entrant stride 331.

Read-only `git diff --name-only` inspection found no changes under authored assets, public assets or authoring directories, and no vehicle-definition, course/environment or specification changes. `dirt-bikes.ts`, `bike-definitions.ts`, `vehicles.ts`, `config.ts`, `venues.ts` and `circuits.ts` were independently compared byte-for-byte against the baseline. All are identical. The complete source change list was reviewed, including the four new pure physics/motion controller files.

`src/rendering/bike.ts` was checked by applying exactly the permitted textual transformation to the baseline in memory: remove the old reader import, add `sampleMxFootField`, and replace its three consumers. The resulting entire file exactly equals the candidate. Thus its model-construction definitions are unchanged, not merely absent from a sampled grep.

No git mutation was performed. Assignment-owned changes are the comparator, this report, and the coordinator-authorized non-MX multiplication-order correction only.

## Reproduction and verification

From the candidate repository:

```sh
node --experimental-transform-types scripts/bench/motocross-scope-isolation.ts --baseline ../motobound-baseline --candidate .
node --experimental-transform-types scripts/bench/motocross-scope-isolation.ts --baseline ../motobound-baseline --candidate . --scenario sm450-outdoor-ai --details
node --experimental-transform-types scripts/bench/motocross-scope-isolation.ts --baseline ../motobound-baseline --candidate ../motobound-baseline --scenario sm450-outdoor-ai --seconds 32
npx vitest run tests/open-world-bikes.test.ts tests/road-bike-replay-state.test.ts tests/session-identity.test.ts --maxWorkers=1 --no-file-parallelism
npx vitest run tests/motocross-air-drag.test.ts tests/motocross-ballistic-timing.test.ts --maxWorkers=1 --no-file-parallelism
npx eslint scripts/bench/motocross-scope-isolation.ts src/simulation/offroad/dirt-bike-vehicle.ts
npx tsc --noEmit --target ES2022 --lib ES2022,DOM,DOM.Iterable --module ESNext --moduleResolution Bundler --allowImportingTsExtensions --skipLibCheck --types node,vite/client scripts/bench/motocross-scope-isolation.ts
git diff --check -- scripts/bench/motocross-scope-isolation.ts src/simulation/offroad/dirt-bike-vehicle.ts
```

Focused compatibility suites: **105/105 passed**. Air-drag/ballistic suites, including legacy supermoto paths: **33/33 passed**. Scoped comparator TypeScript, ESLint and whitespace checks pass; no full-project TypeScript run was performed.

Detailed receipts are under `/workspace/scratch/e91efca799c8/validation/scope-a30/`: `trajectories-120hz.ndjson`, `sm450-ai-repeat.ndjson`, `sm450-ai-baseline-control.ndjson`, and `sm450-ai-fixed.ndjson`. At the final checked source, adapter SHA-256 is `d9ca921a1fe09060769622417be2d6a2698773232c9974f0f516e5b3d4fb8e58`; comparator SHA-256 is `81f516a9ba94eeb09ad15ce74f1ffd73a28509641f61910b11443d798fb5b5a7`.

Limits: one fixed seed, clear weather, raw assist, 48-second practice/free-roam windows; this is not a full race-finish matrix, all-weather calibration, browser/render review or GPU measurement. AI comparisons use the same unchanged seeded driver; identical explicit input sequences are established by the eight manual scenarios. The tool's optional `--hz`, `--seconds`, `--scenario` and `--details` arguments support later targeted reproduction without changing the production environment.
