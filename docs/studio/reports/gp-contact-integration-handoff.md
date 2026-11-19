# GP contact integration: frozen checkpoint and handoff

Assignment 6 / wave 2 hands the remaining GP integration failures to assignment 14. Production contact, momentum, control and thermal code was frozen for the checks below. No tyre-crown change was added. These results describe this checkpoint, before assignment 14's subsequent corrections.

## Outcome

The final joint checkpoint passes **55 of 59 selected tests**: all 36 new/contact invariants, 13 of 14 bike-session cases, and 6 of 9 GP braking-plan cases. Four integration cases remain red. All six seeded GP hairpin/cooldown runs and the mixed race finish; completion alone does not satisfy their incident limits.

The original two-GP snapshot reproduction now passes. The normal AI lap still meets its existing 250 km/h requirement and the recovery case still meets its existing 300 m progress requirement. The unfinished work is explicitly the remaining seeded incidents, not permission to relax those thresholds.

## Retained implementation

The detailed derivations and geometry measurements are in `docs/road-bike-contact-integration.md`.

| Area                          | Retained correction                                                                                                                                                                      | Principal files                                     |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Contact geometry              | Four suspension and two pose/road-pitch samples use the continuous collision ribbon with a narrow layer-aware cast and analytic off-ribbon fallback.                                     | `bike-vehicle.ts`, real-track contact regression    |
| Roll reaction                 | The production plant and GP inverse use actual normal reaction per unit mass. Gravity in free flight is unchanged.                                                                       | `bike.ts`, contact-reaction regression              |
| GP force reserve              | Preserve uncapped requested roll effort for traction/brake reserve; the AI asks for front-load reserve from its actual bounded path correction.                                          | `bike.ts`, `bike-ai.ts`                             |
| Planar momentum               | Apply the projected front contact force once, then rotate both velocity components by the pose's bounded yaw increment. Numerical guards remain dissipative. Standalone opt-out remains. | `motogp-physics.ts`, `bike.ts`, momentum regression |
| Grade and motorcycle stopping | Optional signed route grade, matched tyre-force feed-forward, and the shared rear-normal-load stopping bound.                                                                            | `ai.ts`, `bike-ai.ts`, `motorcycle-braking-plan.ts` |
| Path lean and preview         | Curvature converts to lean using the same actual normal reaction; steering and braking share `bikePreviewDistance`, with an explicit lever-response addition.                            | `bike-ai.ts`, path-reaction and preview regressions |

Assignment 9 owns the ordinary-road reserve/inverse controller and the reusable motorcycle stopping helper. Assignment 12 owns the finite tyre/brake thermal integration and steered contact slip-power reporting. Their production changes are present in the final joint checkpoint. Their changes should not be inadvertently overwritten during the GP review.

No contact retention delay, extra airborne support, gravity tuning or incident-limit relaxation was used. The six seamless-braking corner cases now assert the exact coupled force-then-rotation identity at their original ten-decimal precision; their old scalar identity was incompatible with the corrected body-frame momentum equation. Their force, load, use and lean bounds were retained.

## Current integration case matrix

### GP rider follows its braking plan

| Exact case name                                                             | Result                                                                          |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| reports the plan speed at every active sample without touching the tail     | PASS                                                                            |
| feeds the planned deceleration forward instead of waiting for a speed error | PASS                                                                            |
| brakes gently once the flag has fallen                                      | PASS                                                                            |
| no rider falls at the ardennes hairpin (seed 1000)                          | **FAIL** — rider 2 at 3154.643348 m; rider 1 at 3166.157759 m, both before flag |
| no rider falls at the ardennes hairpin (seed 1037)                          | **FAIL** — rider 0 at 3178.150386 m; rider 2 at 3157.055230 m, both before flag |
| no rider falls at the montejaral hairpin (seed 1000)                        | PASS                                                                            |
| no rider falls after taking the flag at montejaral (seed 1000)              | PASS                                                                            |
| no rider falls after taking the flag at ardennes (seed 1000)                | **FAIL** — rider 0 at 374.377141 m; rider 1 at 371.826556 m, both after flag    |
| no rider falls after taking the flag at ardennes (seed 1037)                | PASS                                                                            |

### Bike sessions

All names are from `tests/bike-session.test.ts`.

| Exact case name                                                                  | Result                                                               |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| builds the bike adapter and bike AI for bike definitions only                    | PASS                                                                 |
| laps a circuit under AI with lean, gears, tyre wear and valid timing             | PASS                                                                 |
| crash flows through race control: rider down, separation, remount, back on track | PASS                                                                 |
| a hard contact between bikes unseats a rider without non-finite state            | PASS                                                                 |
| race control penalises a bike jump start like any entrant                        | PASS                                                                 |
| rear brake is the secondary (clutch) input and decelerates on its own            | PASS                                                                 |
| services a bike in the pit lane and releases it                                  | PASS                                                                 |
| round-trips lean, steer, rider pose and loads; cars carry zeros                  | PASS                                                                 |
| rejects unknown vehicle indices and old layouts                                  | PASS                                                                 |
| chassis lean inverts to the dynamics lean (tyre crown geometry)                  | PASS                                                                 |
| gives every bike its own identity hash and record category                       | PASS                                                                 |
| rejects mixed car and bike grids, admits all-bike grids                          | PASS                                                                 |
| validates bike content and names what is wrong                                   | PASS                                                                 |
| finishes a mixed GP/superbike race with bounded incidents and no stuck rider     | **FAIL** — 4 falls against the unchanged maximum of 3; race finishes |

The mixed test throws at the incident assertion. Assertions after it, including all individual classifications, maximum stop duration and the GP/SBK lap margin, are not independently claimed to pass at this checkpoint.

Its four diagnostic fall events are:

| Rider | Class | Simulation time (approximately) |   Station |     Speed | Lateral position |
| ----- | ----- | ------------------------------: | --------: | --------: | ---------------: |
| 4     | GP    |                         50.98 s | 1533.66 m | 33.78 m/s |          +4.19 m |
| 1     | SBK   |                         96.93 s | 3830.68 m | 49.32 m/s |          +7.56 m |
| 2     | GP    |                        137.96 s | 1533.06 m | 35.20 m/s |          +4.12 m |
| 2     | GP    |                        159.28 s | 1875.11 m | 42.60 m/s |          −7.70 m |

The preceding assignment-9 checkpoint passed this unchanged mixed gate (`w03-mixed-demand.log`). It predates the later GP momentum/path/preview and thermal integration; it must not be substituted for the final joint result.

### Physical invariants

| File                                      | Final joint result |
| ----------------------------------------- | -----------------: |
| `tests/road-bike-suspension.test.ts`      |              13/13 |
| `tests/road-bike-contact-surface.test.ts` |                3/3 |
| `tests/gp-contact-reaction.test.ts`       |                5/5 |
| `tests/gp-contact-momentum.test.ts`       |                5/5 |
| `tests/ai-braking-grade.test.ts`          |                5/5 |
| `tests/gp-path-reaction.test.ts`          |                4/4 |
| `tests/gp-control-preview.test.ts`        |                1/1 |

Before the final thermal integration, a separate 63/63 run passed `gp-path-reaction`, `gp-seamless-braking`, `gp-rear-pedal`, `gp-tyre-contact`, and `gp-drive-traction`. That run included all-eight-rider races at Aurel and dry/wet Poggio Alto. It is useful prior evidence, not a replacement for joint-source verification after new corrections.

Scoped ESLint passed for the five shared physics source files and the eight touched/new test files. The final whole-repository typecheck was blocked by `src/rendering/offroad/roost.ts:735` (nullable object filtering, TS2345/TS2677), during the independent offroad owner's active work. Root was notified; no offroad source was changed by this assignment.

## Exact reproduction

From the repository root:

```sh
npx vitest run tests/gp-ai-braking-plan.test.ts -t 'no rider falls at' --maxWorkers=1
npx vitest run tests/gp-ai-braking-plan.test.ts -t 'no rider falls after' --maxWorkers=1
npx vitest run tests/gp-ai-braking-plan.test.ts -t 'reports the plan|feeds the planned|brakes gently' --maxWorkers=1
npx vitest run tests/bike-session.test.ts --maxWorkers=1
node --experimental-transform-types scripts/studio/tools/gp-contact-checkpoint.mjs 1000 > gp-contact.trace.jsonl 2> gp-contact.events.jsonl
```

The trace script uses the same deterministic Ardennes configuration as the test: race, GP-motorcycle rules, one lap, four `gpr1` entrants, seed 1000, automatic player, 1/120 s steps, up to 600 s or race completion. Seed 1037 can be passed as its argument. The mixed case is Vellamar, two laps, seed 3303, `gpr1/sbk1000/gpr1/sbk1000/gpr1/sbk1000`, the same timestep, up to 400 s.

The diagnostic records every 0.05 s while any entrant is between stations 3090 and 3190, plus all fall events and the final summary. It observes the road suspension input before calling its original method without changing that input. It includes:

- Actual front/rear normal loads, ground heights and gaps, pre-step sprung state, suspension input, vertical acceleration and pitch.
- Lean, roll rate, yaw rate, forward/lateral/total speed, input steer, actual bars, throttle, brake and brake forces.
- Target speed, next planned speed, path target, AI offset, derived tactical offset, shared driver's tactical offset, line slope and bounded steering correction.
- Per-frame and accumulated-since-log centreline station change and actual contact-line planar travel.
- Grip, tyre temperatures, health, incident count, rider state and race decision.

The final scratch evidence is available to the reviewing agent under `/workspace/scratch/d611aefdb08c/`:

| Evidence                                            | Filename                                      |
| --------------------------------------------------- | --------------------------------------------- |
| Full detailed seed-1000 trace, approximately 3.5 MB | `gp-final-ardennes-1000.trace`                |
| All fall events and final completion                | `gp-final-ardennes-1000.events`               |
| Hairpin cases                                       | `gp-final-hairpins.log`                       |
| Cooldown cases                                      | `gp-final-cooldown.log`                       |
| Three planner unit cases                            | `gp-final-planner-unit.log`                   |
| All bike-session cases                              | `gp-final-bike-session.log`                   |
| Mixed fall summaries                                | `gp-final-mixed.trace`                        |
| 36 physical invariants                              | `gp-final-invariants.log`                     |
| Scoped lint and whole-repository typecheck          | `gp-final-lint.log`, `gp-final-typecheck.log` |
| Prior 63-case GP run                                | `gp-path-momentum-core.log`                   |

## Observed Ardennes sequence

These are selected pre-fall samples for rider 2, seed 1000. Speed and target are m/s, normal loads are N, lean is radians, and roll/yaw rates are rad/s.

|    Time |  Station |  Speed / target | Front / rear load | Lean / roll rate | Yaw rate | Throttle / brake |
| ------: | -------: | --------------: | ----------------: | ---------------: | -------: | ---------------: |
| 102.408 | 3120.289 | 14.920 / 14.924 |       2117 / 1581 |    0.350 / 1.050 |    0.394 |    0.050 / 0.101 |
| 102.908 | 3129.773 | 14.758 / 13.918 |        762 / 1645 |    0.600 / 0.250 |    0.497 |        0 / 0.151 |
| 103.458 | 3139.714 | 14.589 / 12.793 |       1946 / 1812 |    0.733 / 0.331 |    1.153 |        0 / 0.316 |
| 104.058 | 3149.910 | 13.680 / 12.659 |        817 / 1459 |    0.851 / 0.328 |    2.494 |        0 / 0.188 |
| 104.408 | 3154.476 |  8.919 / 13.512 |        1091 / 820 |    1.205 / 1.563 |    2.453 |            0 / 0 |

The fall is registered at 104.433 s / 3154.643 m. Rider 1 then encounters the resulting caution/avoidance change: its tactical offset moves from approximately −0.17 m at 3120 m to −3.32 m at 3160 m. Its speed is 14.238 m/s versus a 12.497 m/s target at 3160.287 m; yaw is 2.079 rad/s. It falls at 106.900 s / 3166.158 m. The full trace retains both riders' exact ground and suspension values.

Actual travel differs materially from centreline progress before the first hairpin fall:

| Rider and interval             | Centreline progress | Planar travel | Travel / progress |
| ------------------------------ | ------------------: | ------------: | ----------------: |
| Rider 2, 3120.289 → 3149.910 m |           29.6206 m |     24.0494 m |            0.8119 |
| Rider 1, 3120.228 → 3150.143 m |           29.9148 m |     25.0022 m |            0.8358 |

Use summed distances across multiple samples. The nearest-polyline station itself jumps: one rider-2 frame advances 0.4864 station metres during 0.1243 m of planar travel. That makes a single-frame distance ratio an unsuitable local metric.

The full event log also records earlier falls around Ardennes stations 367–377 and repeats this area during seed-1000 cooldown. The hairpin assertions do not cover every part of the lap; a passing named hairpin case must not be reported as a globally incident-free race.

## Hypotheses for independent review

1. **Path-distance consistency is the priority candidate.** `limitSpeed` adjusts curvature and grade for the inside path, but the stopping envelope and feed-forward denominator still use a fixed 12 m centreline sample as physical stopping distance. The measured path is shorter. A closed-form offset-circle test should establish the required distance metric, including any changing-offset term, before a correction is accepted. The observations above do not by themselves isolate this as the sole cause.
2. **Asymmetric contact transitions, tyre relaxation and roll-arrest control remain candidates.** Loads fluctuate and yaw approaches its guard before the hairpin fall. No additional controller or tyre-model change was made after the freeze.
3. **A finite tyre crown has not been shown to solve the incident.** A scratch-only approximate `castTire` probe still produced two hairpin falls near 3154/3169 m. It used approximate contact dimensions and is neither a production implementation nor a calibration result. No crown patch was retained.

Assignment 14 received the commands, exact failures, trace paths and observed distance ratios directly. Preserve the established gravity/zero-force, momentum/work, replay, tyre-circle and seeded race acceptance bounds while resolving the remaining integration failures.
