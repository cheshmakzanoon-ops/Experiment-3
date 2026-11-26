# Motocross engine dynamics and motion — 25–26 November 2026

This pass improves the motocross engine's momentum transport, tyre and rotor work,
fast suspension response, recovery motion, wheel animation data, and the control
handoffs needed to ride those dynamics. Its production changes are confined to
**nine runtime files**. Models, character geometry, materials, textures, authored
venues and environment construction are outside its scope. The exact preservation
audit finds **all 291 authored asset/reference files unchanged from the starting
baseline**. [Preservation evidence](agents/50-preservation-audit.md)

**Publication status:** the engine, initial engineering record and subsequent
two-file TypeScript correction are published on `main` at the exact commits
listed below. Assignment 60 has independently verified the initial **188-path**
publication and the exact two-file correction. The runtime fingerprint remains
unchanged. The corrective commit's hosted **`validate` job completed successfully
at 00:47:55 UTC on 26 November**, independently observed by root and assignment
60. It covers full-root lint/content/type checking, production and Steam demo/static
builds, IP guards and committed-source preservation. Benchmark smoke also passed
at 00:48:21 UTC. The overall Build and validation workflow remains unfinished;
longer unit, race and browser checks are still queued or running.

The initial publication's MX/offroad sweep passes **1,736/1,736 tests in 155 files**;
a disjoint shared-core set passes **181/181 in seven files**. The later correction
changes one test's spy return contract: its **16/16 cases pass again**, with no
assertions or tolerances changed and no extra tests added to those totals. The
original eight full-grid races, exact four-lap Valley event and unchanged default
eleven-scenario offroad matrix pass locally. A coverage gap in the earlier scoped
type checks exposed four diagnostics in a benchmark/test pair; that correction,
its verification and the two resource-killed full-root attempts are recorded
explicitly. **All 60 distinct assignments are complete.** The final
[remote verification](agents/60-remote-verification.md) and
[publication receipt](evidence/final-publication.json) record the exact source and
hosted observation. Historical intermediate failures retain their own identities.
[Acceptance reconciliation](agents/58-acceptance-reconciliation.md),
[type-correction receipt](evidence/58-root-types-correction.json),
[independent correction review](agents/59-publication-preflight.md#post-publication-type-correction-addendum)

## Reading this record

- [Integration findings and acceptance register](integration.md) explains which
  changes were retained, rejected or superseded, and how the evidence fits together.
- [Runtime architecture and observation contracts](architecture.md) defines the
  force, motion, clock and snapshot phases that future code and tests must respect.
- [Reconciliation history](reconciliation.md) records incoming-main integration
  and justified fixture changes, including the final fuel-mass drag observation.
- The [ten-wave assignment ledger](#ten-wave-assignment-ledger) links the individual
  investigations. Each report keeps its original source identity and measured results.
- `evidence/` contains machine-readable observations, receipts and selected logs.
  Overlapping suites are never added together to manufacture a larger test total.

## Retained improvements

| Engine problem | Retained behavior and evidence |
| --- | --- |
| Sampling a different terrain chord or touching down could change horizontal momentum without a corresponding force. | Ground speed is re-expressed when its coordinate frame changes; compliant touchdown does not count retained vertical velocity a second time. Unsupported wheels no longer receive ground-only grade, rolling or bulldozing effects. [07](agents/07-landing-momentum.md), [24](agents/24-slope-momentum.md), [27](agents/27-planar-transport.md), [40](agents/40-ridden-flow.md) |
| A sequential stop or later forward-speed clamp could close an already resolved contact. | The two tyre stops and nonnegative forward-speed constraint are solved together in the correct mass metric, including the final yawed touchdown frame. [20](agents/20-bounded-contact.md), [30](agents/30-final-contact-frame.md) |
| Rapid tyre pickup changed pitch torque faster than a vertical-only refinement could follow. | Player MX uses bounded complete contact intervals and an event-aware supported midpoint solve. Collision, gear and landing decisions retain their public-call ownership. [33](agents/33-supported-accuracy.md), [37](agents/37-coupled-lifecycle.md) |
| Drive and brake adapters could infer an actuator command from net force or display telemetry, then limit it again. | The core exposes the exact gross assisted drive command and explicit brake ceilings. Tyre contact, engine drag and free-rotor braking keep distinct budgets. Twelve native hill starts move under the corrected drive path. [25](agents/25-launch-traction.md), [26](agents/26-drive-budget-review.md), [29](agents/29-brake-budget.md) |
| One wheel's finite-step work correction could unnecessarily suppress the other wheel's valid grip. | Each contact's brush vector is corrected independently; valid static bank support stays inside its own friction circle. [22](agents/22-cross-slope.md), [32](agents/32-contact-work.md) |
| Flight used a different inertia for the same front rotor than ground contact used. | Player flight uses the live front-tyre inertia for brake heat and pitch reaction. The controlled energy audit removes roughly 21.5 J / 43.0 J of spurious MX250 / MX450 work. [42](agents/42-rotor-energy.md) |
| Wheel phase and its reported displayed angular speed described different interpolation curves. | Interior MX angular speed differentiates the same winding-aware, limited phase curve. Selected endpoints and reset/service holds keep their measured state. [19](agents/19-wheel-motion-consistency.md) |
| Recovery could change position or heading abruptly at the old timeout or mounting boundary. | Rider travel and turn rates, bike pushing and the final seat approach are bounded; readiness requires the actual position and heading handoff. [12](agents/12-remount-motion.md), [23](agents/23-remount-handoff.md) |
| Shoulder steering could override a traffic decision that found no safe lane. | Extra shoulder recentering is permitted only in ordinary line following. The seeded wet-race regression is reproduced before the guard and passes after it. [21](agents/21-jump-guidance.md), [49](agents/49-wet-race-regression.md) |

The original two-lap player-feedback gates pass on both venues with no falls.
At assignment 40's comparison boundary, Valley elapsed time changed from
174.62 s to 167.39 s, and Arena from 167.95 s to 149.82 s; Arena's longest stall
fell from 7.04 s to 0.183 s. These are results of the specified headless feedback
driver against its documented pre-integration checkpoint, not a general claim
about human lap times. Assignment 49 reruns the original player/corridor gates
against the final traffic-priority candidate. [40](agents/40-ridden-flow.md),
[49](agents/49-wet-race-regression.md)

## Source identity and provenance

| Identity | Value |
| --- | --- |
| Repository | `cheshmakzanoon-ops/Experiment-3` |
| Starting main | `f3b39eb8e1b02fc0677086819fc384b6ceacefc2` — simulation 39 |
| Incoming engine work retained | `39d9d497880e92801a7d77de6af2639b4186bfcc` — simulation 40 |
| Integrated main comparison point | `c9c94c7029dbc3e29b18101ef7ccea0a897184d1` |
| Published runtime source fingerprint | `4c041cb338d0fa480e0514ee905137a24061494b98b9899949238f6b137be790` |
| Simulation identity | **41** |
| Snapshot protocol / entrant stride | **17 / 331 floats**, unchanged by this task |
| Published engine commit | [`9b5fead87ae56902b138951e093c5f054b36d8a3`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/9b5fead87ae56902b138951e093c5f054b36d8a3) |
| Published initial engineering record | [`2904ea226590e4f9c75b7e4aecf544c7b7f8fb15`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/2904ea226590e4f9c75b7e4aecf544c7b7f8fb15) |
| Published benchmark/test type correction | [`b48249d2da1717e004f7f1c1b0f3501fa2c6739a`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/b48249d2da1717e004f7f1c1b0f3501fa2c6739a) |
| Remote content verification | Assignment 60 verified the original 188-path publication and exact two-file correction. Corrected hosted `validate` succeeds; the overall workflow remains unfinished. |

The fingerprint covers **1,129 files**: regular files under `src`, plus
`package-lock.json`, `index.html` and `vite.config.ts`. It hashes sorted relative
POSIX path strings and each file's bytes, separated by NULs. It identifies the
engine/build inputs independently of later report-only edits or the benchmark/test
type correction. The [original publication manifest](evidence/final-publication-manifest.json)
records the initial 188 paths and expected trees; it retains its original
preparation status and is not a manifest for later correction/report commits.
The engine and initial record were published together, followed by the correction.
Each main-branch update used a fresh `expected_sha` and `force: false`, retaining
concurrent CI-report successors. The [correction receipt](evidence/final-publication-correction.json)
and [final publication record](evidence/final-publication.json) preserve those actual updates.

This folder, `docs/engine/mx-dynamics-2026-11-25`, is the current pass. The similarly
named `docs/engine/motocross-dynamics-2026-11-25` belongs to a separate incoming
engine pass. Its agents are not counted in this ledger. Incoming work was
reconciled, rather than overwritten or credited as new work here.

Local checkpoints such as `b451b72`, `61434f1`, `8b181bc`, `38661da` and `b287924`
are historical local audit provenance. They are not promised to be the published
API commit IDs or reachable revisions in a fresh clone. Current-source benchmark
commands work without those refs. Optional historical `--adapter-ref` comparisons
require the corresponding local history; the retained JSON records their results.

## Validation status by source

| Gate | Observed result | Evidence boundary |
| --- | --- | --- |
| Original calibration | 20 jump holds, 20 walking checks, 24 deliberate gap probes and three standing starts pass. | [47](agents/47-race-calibration.md), source `a153c34d…`; the later change is an AI traffic branch not used by this calibration driver. |
| Original full-grid races | **8/8 pass**, 96/96 entrants finish, no retirements; worst rider has one crash within the unchanged limit. | [49](agents/49-wet-race-regression.md), final `4c041cb3…`. |
| Exact Valley four-lap event | **Pass**, 10/10 finishers, one total crash, maximum stop 13.26 s. | [49](agents/49-wet-race-regression.md), final `4c041cb3…`. |
| Unchanged default offroad race matrix | **11/11 scenarios pass locally**, exit 0, no failures or changed inputs; `OFFROAD_RACE` unset. | [Final receipt](evidence/final-default-offroad-receipt.json), [raw results](evidence/final-default-offroad-races.json), final `4c041cb3…`; not a hosted-workflow result. |
| Complete MX/offroad unit sweep | **155 distinct files / 1,736 tests pass at initial publication**; zero failures, skipped or todo, no retry. The later corrected planar file passes **16/16** again, without increasing that total. | [46 receipt](evidence/46-final-engine-units.json), runtime `4c041cb3…` with initial test hashes; [correction boundary](evidence/58-root-types-correction.json). |
| Animation fixture repairs | **53/53** targeted tests pass; all 52 existing tests retain their assertions, plus one adverse six-cadence test. | [48](agents/48-animation-contract.md), `4c041cb3…`; overlaps the broad sweep. |
| Air-drag phase repair | **22/22** pass, including 20 original tests and two observer checks, with original tolerances. | [Reconciliation](reconciliation.md#final-integration-airborne-drag-and-changing-fuel-mass), [receipt](evidence/root-air-drag.json). |
| Hard-stop/collision contracts | **29/29** tests pass with the original physical tolerances, safety envelopes and exact replay checks. | [51](agents/51-contact-contracts.md), final `4c041cb3…`; overlaps broad-unit coverage. |
| Non-MX behavior | Five selected workloads match all **6,005 complete snapshots / 16,477,720 bytes**, with only simulation identity normalization. | [Final refresh](evidence/final-preservation.json), `4c041cb3…`; [50](agents/50-preservation-audit.md) retains the broader historical file audit. |
| Scoped strict types | Original production and selected dependency-group projects pass. Four later full-root diagnostics in two omitted entry files exposed incomplete coverage; the corrected pair and its imported dependencies now pass strict checking. | [52](agents/52-tooling-runtime-cost.md), [58 correction](evidence/58-root-types-correction.json). These scoped checks do not establish a full-root pass. |
| Complete root TypeScript | **Pass on hosted `validate` at `b48249d…`**, job completed 00:47:55 UTC. The earlier local 2560/2048 MiB attempts remain SIGKILL results, exit −9 / 137. | [58 local logs and commands](evidence/58-root-types-correction.json), [successful hosted validate job](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45730817858/job/139612194664). The overall workflow remains unfinished. |
| Changed-code lint | Initial 62-file check passes. After correction, 60 file hashes remain unchanged and both changed files pass fresh focused lint. | [52](agents/52-tooling-runtime-cost.md), [58 correction](evidence/58-root-types-correction.json), [59 review](agents/59-publication-preflight.md#post-publication-type-correction-addendum). |
| Production build | Original direct Vite build succeeds: 1,106 modules, 15.19 s. Corrected hosted `validate` also passes production and Steam demo/static builds, IP guards and committed-source preservation. | [52](agents/52-tooling-runtime-cost.md), runtime `4c041cb3…`; [hosted validate](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45730817858/job/139612194664). The earlier local browser restriction remains in [44](agents/44-native-browser.md). |
| Shared-core regression | **181/181** tests pass in seven files outside the MX/offroad sweep; zero failures, skipped or todo. These seven files are unchanged by the correction. | [52](agents/52-tooling-runtime-cost.md), runtime `4c041cb3…`; [58](agents/58-acceptance-reconciliation.md) verifies disjoint paths and records the later one-file MX test-hash change. |
| CPU runtime cost | 14,400 measured native steps: case medians 0.02249–0.03745 ms and p99 0.38225–0.51140 ms on the shared executor. | [52](agents/52-tooling-runtime-cost.md); not a full-world, GPU, FPS or device guarantee. |
| Local browser / GPU | **Not executed successfully.** Installed Chromium aborts before page creation because the OS rejects its required socket operation. | [44](agents/44-native-browser.md); no gameplay, screenshot, framebuffer or GPU pass is claimed. |
| Independent source / claim reviews | No new concrete release blocker found in the scoped reviews; two documentation phase/frame clarifications retained. | [55](agents/55-source-review.md), [56](agents/56-claims-oracle-review.md), final `4c041cb3…`. |
| Hosted repository-wide CI | The four new-source type diagnostics are corrected; the complete hosted **`validate` job succeeds**. Benchmark smoke succeeds. Baseline global-unit failures remain separately attributed; the overall Build and validation workflow is still unfinished. | [54 baseline attribution](agents/54-ci-attribution.md), [58 coverage correction](evidence/58-root-types-correction.json), [Build and validation](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45730817858), [Benchmark smoke](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45730817869). No all-CI pass is claimed. |
| Main publication | **Engine, initial engineering record and two-file correction published.** Assignment 60 verified their content boundaries; hosted acceptance remains separate. | Exact commits above; [original 188-path manifest](evidence/final-publication-manifest.json), [59 preflight/addendum](agents/59-publication-preflight.md). |

## Known limits retained openly

| Limit | Meaning and evidence |
| --- | --- |
| Reduced compliant suspension work | The full compression Jacobian and compliant pitch-force arm are not work-conjugate. The benchmark finds 1.7448 / 1.8394 J around its closed MX250 / MX450 configuration loop. Changing that arm alone caused four of four player table-jump regressions, so the isolated replacement was rejected. [28](agents/28-spring-work.md) |
| Separate yaw damping port | A strong within-step yaw reversal can give the explicit yaw damper about `5.73e-7` J of positive work in the documented probe. Contact work accounting identifies this separate port; this pass does not claim global passivity of the full reduced bike. [32](agents/32-contact-work.md) |
| Neutral rider acceleration corner | The retained posture composition is C1. Tested C2 alternatives worsened sampled acceleration and were rejected. [35](agents/35-rider-acceleration.md) |
| Sparse impact reconstruction | CPU pose checks have small mean error but local impact maxima of 40.853 mm at 30 Hz and 18.911 mm at 60 Hz publication. This is not a claim of exact interior reconstruction between sparse snapshots. [48](agents/48-animation-contract.md) |
| Deliberately held flight controls | The MX450 Valley held-input trajectory is a converged flat crash: 7.063701 m/s bottoming at 3840 Hz against the unchanged 7 m/s limit. It is preserved as an adverse regression; ordinary feedback-driven animation traces remain separate. [40](agents/40-ridden-flow.md), [48](agents/48-animation-contract.md) |
| Native approach cadence | The complete median approach rear-crashes at 120 Hz in both assists; 240/480/960 Hz produce Raw loop-out and Sport survival. Safety envelopes remain bounded, but identical whole-approach crash labels across outer cadences are not claimed. [51](agents/51-contact-contracts.md) |
| Narrow scenario margins | One player shoulder landing has about 1.09 mm of margin to its existing CG corridor boundary; the final full-grid maximum stop has 0.85 s of margin. Passing these fixtures is not proof over arbitrary seeds, inputs or cadences. [40](agents/40-ridden-flow.md), [49](agents/49-wet-race-regression.md) |
| Existing representation limits | Reduced force-contact geometry versus drawn geometry and protocol-17 Float32 time precision remain. The engine has not become a fully coupled 3D multibody motorcycle model. [Architecture](architecture.md) |
| Visual/device acceptance | Local browser startup is blocked. CPU articulation tests and build success do not establish rendered quality or physical-device frame rate. [44](agents/44-native-browser.md), [48](agents/48-animation-contract.md) |

## Ten-wave assignment ledger

The requested work is organized into **ten numbered waves of six distinct agent
assignments**. Execution is staggered with at most three worker agents running at
once; these are not strict six-worker barriers or two fixed batches per wave.
Assignment 26 is the independent child review under assignment 25 and counts once.
**All 60 distinct assignments are complete.** The ledger includes the source/claim
reviews, publication manifest, acceptance reconciliation, type correction and
independent preflight. Assignment 60 independently verified the initial publication,
exact correction content and successful corrected hosted `validate` job. Its
[final report](agents/60-remote-verification.md) preserves the timestamped
observation of the remaining running or queued hosted jobs.
Continuations of 58 and 59 are the same agents, not additional assignments.

| Wave | ID | Investigation / report | Disposition at this handoff |
| --- | ---: | --- | --- |
| 1 | 01 | [Contact audit](agents/01-contact-audit.md) | Completed diagnosis; supplied momentum/contact work. |
| 1 | 02 | [Traction audit](agents/02-traction-audit.md) | Completed diagnosis; supplied support and actuator work. |
| 1 | 03 | [Motion audit](agents/03-motion-audit.md) | Completed diagnosis of neutral/recovery discontinuities. |
| 1 | 04 | [Snapshot audit](agents/04-snapshot-audit.md) | Completed diagnosis of phase/rate and joint reconstruction. |
| 1 | 05 | [Lifecycle audit](agents/05-lifecycle-audit.md) | Completed diagnosis of gate placement and restart policy. |
| 1 | 06 | [Validation baseline](agents/06-validation-baseline.md) | Immutable five-discipline baseline captured. |
| 2 | 07 | [Landing momentum](agents/07-landing-momentum.md) | Retained, integrated with later contact fixes. |
| 2 | 08 | [Front steering](agents/08-front-steering.md) | Retained supported steering authority. |
| 2 | 09 | [Rider blend](agents/09-rider-blend.md) | Alternative superseded by incoming local C1 blend. |
| 2 | 10 | [Coupled stops](agents/10-coupled-stops.md) | Alternative kernel superseded; independent invariant coverage retained. |
| 2 | 11 | [Gate placement](agents/11-gate-placement.md) | Retained complete validated physical gate assignments. |
| 2 | 12 | [Remount motion](agents/12-remount-motion.md) | Retained, completed by 23's actual seat handoff. |
| 3 | 13 | [Contact integration](agents/13-contact-integration.md) | Incoming/output phase contract integrated with upstream. |
| 3 | 14 | [Ridden-lap diagnosis](agents/14-ridden-lap-diagnosis.md) | Diagnosis retained; later fixes address causal findings. |
| 3 | 15 | [Jump corridor candidate](agents/15-jump-corridor.md) | Regressing broad candidate rejected; narrower work continues in 21. |
| 3 | 16 | [Drive reserve](agents/16-drive-reserve.md) | Exact command defect isolated; implementation completed by 25. |
| 3 | 17 | [Upstream contact review](agents/17-upstream-contact-review.md) | Incoming solver reviewed; forward-bound defect assigned onward. |
| 3 | 18 | [Upstream motion review](agents/18-upstream-motion-review.md) | Incoming motion retained; remaining wheel-rate defect assigned onward. |
| 4 | 19 | [Wheel motion consistency](agents/19-wheel-motion-consistency.md) | Retained shared phase/rate sampling. |
| 4 | 20 | [Bounded contact](agents/20-bounded-contact.md) | Retained joint normal/forward constraint projection. |
| 4 | 21 | [Jump guidance](agents/21-jump-guidance.md) | Narrow shoulder guidance retained, with final traffic guard in 49. |
| 4 | 22 | [Cross-slope support](agents/22-cross-slope.md) | Retained lateral gravity and static brush support. |
| 4 | 23 | [Remount handoff](agents/23-remount-handoff.md) | Retained bounded distance/turn/seat completion. |
| 4 | 24 | [Slope momentum](agents/24-slope-momentum.md) | Retained ground-angle and mode-handoff corrections. |
| 5 | 25 | [Launch traction](agents/25-launch-traction.md) | Retained exact gross command and single limiter ownership. |
| 5 | 26 | [Drive budget review](agents/26-drive-budget-review.md) | Independent child review completed; counted once. |
| 5 | 27 | [Planar transport](agents/27-planar-transport.md) | Retained per-microstep forward projection without scaling horizontal slide. |
| 5 | 28 | [Spring work review](agents/28-spring-work.md) | Isolated force-arm replacement rejected; diagnostic retained. |
| 5 | 29 | [Brake budget](agents/29-brake-budget.md) | Retained explicit actuator aid ceilings. |
| 5 | 30 | [Final contact frame](agents/30-final-contact-frame.md) | Retained correction in actual touchdown storage frame. |
| 6 | 31 | [Ridden controller](agents/31-ridden-controller.md) | First qualifying landing deadline retained without rebound renewal. |
| 6 | 32 | [Contact work](agents/32-contact-work.md) | Retained independent per-contact finite-work correction. |
| 6 | 33 | [Supported accuracy](agents/33-supported-accuracy.md) | Retained bounded complete intervals and event-aware midpoint support. |
| 6 | 34 | [Flight control review](agents/34-flight-control.md) | Alternative controllers rejected; existing control calibration retained. |
| 6 | 35 | [Rider acceleration review](agents/35-rider-acceleration.md) | C2 alternatives rejected; read-only acceleration audit retained. |
| 6 | 36 | [Recording contract](agents/36-recording-contract.md) | Native crash/recovery and branch replay coverage retained. |
| 7 | 37 | [Coupled lifecycle](agents/37-coupled-lifecycle.md) | Public means, lifecycle contracts and physical thermal observation retained. |
| 7 | 38 | [Landing oracles](agents/38-landing-oracles.md) | Physical event classification and explicit corridor contract retained. |
| 7 | 39 | [Contact oracles](agents/39-contact-oracles.md) | Actual first-contact/stop observation replaces stale endpoint assumptions. |
| 7 | 40 | [Ridden flow](agents/40-ridden-flow.md) | Momentum, unsupported translation and automatic-shift fixes retained. |
| 7 | 41 | [Contact time contract](agents/41-contact-time-contract.md) | Physical interval/impulse ledger and transparency checks retained. |
| 7 | 42 | [Rotor energy](agents/42-rotor-energy.md) | Live front-rotor inertia retained across ground and flight. |
| 8 | 43 | [Transition oracles](agents/43-transition-oracles.md) | Event momentum separated from subsequent motion. |
| 8 | 44 | [Native browser/build](agents/44-native-browser.md) | Build passed; browser blocked before page creation. |
| 8 | 45 | [Wheel-pickup contract](agents/45-wheel-pickup-contract.md) | Force-phase slip timing, work and observer checks retained. |
| 8 | 46 | [Full engine units](agents/46-full-engine-units.md) | Final 155-file / 1,736-test sweep passes; historical failure map preserved. |
| 8 | 47 | [Race/calibration audit](agents/47-race-calibration.md) | Calibration/event passed; new wet-race regression correctly escalated. |
| 8 | 48 | [Animation contract](agents/48-animation-contract.md) | Existing feedback policy used in complete-riding fixtures; adverse trajectory preserved. |
| 9 | 49 | [Wet-race regression](agents/49-wet-race-regression.md) | Traffic-priority fix retained; all original race gates pass. |
| 9 | 50 | [Preservation audit](agents/50-preservation-audit.md) | Exact file and five-workload audit completed; root's final non-MX refresh also passes. |
| 9 | 51 | [Contact contracts](agents/51-contact-contracts.md) | Completed: 29/29 tests, phase-correct impulses and physically classified collision/replay cases. |
| 9 | 52 | [Tooling/runtime cost](agents/52-tooling-runtime-cost.md) | Completed scoped types/build/lint, 181 shared tests and CPU audit; full-root coverage gap corrected by 58. |
| 9 | 53 | [Engineering report](agents/53-engineering-report.md) | Completed documentation handoff; later final receipts reconciled by 58. |
| 9 | 54 | [CI attribution](agents/54-ci-attribution.md) | Completed baseline attribution; later new-source type errors are separately owned and corrected by 58. |
| 10 | 55 | [Independent source review](agents/55-source-review.md) | Completed scoped review; no new concrete release blocker. |
| 10 | 56 | [Oracle and claim audit](agents/56-claims-oracle-review.md) | Completed; no new blocker, two phase/frame documentation clarifications. |
| 10 | 57 | [Publication manifest](agents/57-publication-manifest.md) | Completed preparation; original 188-path manifest retained with its exact initial publication boundary. |
| 10 | 58 | [Final acceptance reconciliation](agents/58-acceptance-reconciliation.md) | Completed reconciliation, minimal benchmark/test correction and explicit full-root coverage addendum. |
| 10 | 59 | [Publication preflight](agents/59-publication-preflight.md) | Completed source/protected-scope review and independent two-file correction review. |
| 10 | 60 | [Remote publication verification](agents/60-remote-verification.md) | Completed: published contents, protected scope, ancestry, corrected hosted `validate` and benchmark smoke independently verified; remaining CI status timestamped. |

## Reproduction without asset regeneration

Use the locked dependencies and direct binaries. The repository's npm lifecycle
hooks can regenerate protected model assets, so they were not used for these gates.
The precise file lists and exit codes belong in the source-specific receipts.
The production-only project below is scoped; the full root gate is
`node --max-old-space-size=2048 node_modules/typescript/bin/tsc --noEmit`.
Both full-root local attempts after correction were resource-killed, so the
scoped project must not be used as a substitute claim of full-root success.
[Correction command record](evidence/58-root-types-correction.json)

```sh
node --max-old-space-size=2048 node_modules/typescript/bin/tsc \
  --project docs/engine/mx-dynamics-2026-11-25/evidence/tsconfig-production.json
node node_modules/vitest/vitest.mjs run tests/motocross*.test.ts \
  tests/offroad*.test.ts --maxWorkers=1
node --max-old-space-size=2048 node_modules/vite/bin/vite.js build
node --max-old-space-size=384 --experimental-transform-types \
  scripts/bench/mx-dynamics-preservation.ts \
  --compare docs/engine/mx-dynamics-2026-11-25/evidence/non-mx-baseline.json
node --experimental-transform-types scripts/bench/motocross-player-dynamics.ts
node --experimental-transform-types scripts/bench/motocross-rotor-energy.ts
node --experimental-transform-types scripts/bench/motocross-landing-oracles.ts
```

The original calibration and race scripts write relative output paths. Assignments
47 and 49 run the unchanged scripts by absolute path from isolated output folders,
so their historical tracked reports are not overwritten. Their receipts preserve
the exact commands and inputs, including `--mx-full-grid` and
`OFFROAD_RACE='event valley-ridge-mx-moto-1'`. The final default matrix uses the
same unchanged race script with `OFFROAD_RACE` unset and no `--mx-full-grid` flag;
its [receipt](evidence/final-default-offroad-receipt.json) records the isolated
working directory, exact command and unchanged input hashes.
