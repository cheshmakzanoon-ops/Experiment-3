# Assignment 52 — final tooling, shared contracts and bounded CPU cost

Wave 9. Completed 26 November 2026. **The final tooling gates pass** on the
traffic-priority candidate, including the previously blocked animation test
type checks. No production code, tests, assets, models, characters, authored
environments, compiler policy, dependencies or Git state were changed.

Source fingerprint before and after every phase of this assignment:

`4c041cb338d0fa480e0514ee905137a24061494b98b9899949238f6b137be790`

The complete command receipt, selected file hashes and results are in
[52-tooling-runtime-cost.json](../evidence/52-tooling-runtime-cost.json).

## Tooling results

| Gate | Result |
| --- | --- |
| Full production TypeScript | Pass, no diagnostics |
| All nine modified runtime modules and their dependencies | Pass, strict 512 MB dependency group |
| Air-drag, dynamic-suspension and shared flight-helper test dependencies | Pass, strict 1 GB group |
| Live-pose and joint-reversal test dependencies | Pass, strict 1 GB group; resolves assignment 48's resource-blocked attempt |
| Released collision and hard-stop test dependencies | Pass, strict 1 GB group |
| Changed-code ESLint | Pass, 62 files, no diagnostics; includes the reproducible CPU audit |
| Direct production Vite build | Pass, 1,106 modules, 15.19 s, product/full variant, IP guard clean |
| Focused shared-core regression tests | Pass, 181 tests in seven files; no skipped or todo cases |

All type groups extend the unchanged repository `tsconfig.json`, retaining
its strictness and existing compiler settings. Equivalent portable group
configurations are retained as [engine](../evidence/52-types-engine.json),
[flight](../evidence/52-types-flight-tests.json),
[pose](../evidence/52-types-pose-tests.json) and
[contact](../evidence/52-types-contact-tests.json). The full production check
uses the existing [production configuration](../evidence/tsconfig-production.json).

The first full-production attempt used a 2 GB heap cap and was killed with
exit **137**, leaving an empty diagnostic log. It was not reported as a
compiler pass. Root then removed the known, unused temporary Chromium cache
from tmpfs, releasing memory while retaining the earlier browser evidence.
After the smaller changed-engine group passed, root authorized one full
production retry under that materially different resource condition. The
retry used the same 2 GB cap and passed. All compiler groups ran serially.
The receipt retains both the failed resource attempt and the successful gate.

The build ran through the installed Vite binary directly, without npm
lifecycle hooks. Its [log](../evidence/52-build.log) retains the normal
nonblocking warning about chunks larger than 500 kB. No warning threshold,
build configuration or bundling policy was changed. `dist/BUILD_IDENTITY.json`
records the exact fingerprint above; its commit is `null` because the local
candidate still had uncommitted changes. This is a fingerprint-identified
local build, not a claim that it came from a published commit.

## Shared behavior checked separately

These files are outside the 154-file motocross/offroad sweep. Their distinct
counts must not be added repeatedly when later reports cite the same run.

| File | Tests |
| --- | ---: |
| `bike.test.ts` | 10 |
| `wheel-pose.test.ts` | 14 |
| `tire-motion-invariance.test.ts` | 7 |
| `session-identity.test.ts` | 110 |
| `gp-drive-traction.test.ts` | 8 |
| `gp-front-contact-steering.test.ts` | 10 |
| `recording-publication-ownership.test.ts` | 22 |
| **Total** | **181** |

The shared tests cover the changed bike core's surrounding contracts,
non-MX wheel presentation, GP brake/traction/steering behavior, session
identity and recording publication ownership. The unchanged tests include
actual GP adapter and replay paths. Their [run log](../evidence/52-shared-core.log)
records a 7.43 s run. This focused set complements assignment 50's immutable
five-discipline snapshot comparison; it does not prove every possible
non-MX trajectory unchanged.

## Current CPU observations and work bounds

The retained [audit script](../evidence/52-runtime-cost.ts) runs both MX
machines over the native Valley Ridge and Arena table jumps at 120 Hz. It
uses ordinary ground controls and the already validated public flight
feedback policy. Placement, terrain, physics state and thresholds are not
modified during a run.

Each case has one unmeasured warmup run, one separately instrumented run and
five uninstrumented timing repetitions, each six simulated seconds long.
There are **14,400 measured public `bike.step` calls**. Instrumented and
ordinary runs compare 26 unrounded quantities at all 720 public endpoints
per case: **2,880 paired states match exactly**. Every measured repetition
also reaches the same exact final state. All four cases remain ridden with
zero crashes.

| Machine / venue | Median `bike.step` | p99 `bike.step` | Maximum complete intervals | Maximum spring evaluations |
| --- | ---: | ---: | ---: | ---: |
| MX250 / Valley Ridge | 0.03745 ms | 0.51140 ms | 4 | 18 |
| MX250 / Arena Nord | 0.02634 ms | 0.38225 ms | 3 | 62 |
| MX450 / Valley Ridge | 0.02249 ms | 0.39251 ms | 4 | 24 |
| MX450 / Arena Nord | 0.02562 ms | 0.39024 ms | 3 | 80 |

The recorded environment is Node **v24.22.3**, Linux x64, AMD EPYC 9V74.
Full timing distributions, maxima, interval histograms and per-repeat CPU
totals are in [52-runtime-cost.json](../evidence/52-runtime-cost.json).
Per-step wall measurements exclude placement and control calculation;
separately recorded loop CPU totals include controls and finite-state checks.
The executor was shared, so wall-time tails include scheduling/GC effects.
These observations are not a before/after performance comparison, a full
world-step benchmark, a physical-device guarantee, or a graphics/FPS result.

The source still caps complete contact refinement at **8 intervals** and
supported vertical refinement at **16 stages per interval**. The loops and
event root searches remain bounded. Assignment 33's historical 3-interval /
76-spring observed maxima describe its earlier trajectories; the current
controlled traces observe **4 / 80**, and this report does not relabel those
older counts as final measurements. The theoretical additional supported
midpoint budget is 512 spring evaluations, with the existing bounded contact
projection/search work accounted separately.

## Input preservation and practical limits

The source fingerprint covers **1,129 source/configuration files**. The
assignment also captured hashes and modes for **1,388 materialized inputs**,
including **255 files in `public`, `assets` and `authoring`**. Before/after
comparison finds **zero changed, removed or added inputs**. All 62 ESLint
inputs retain their captured hashes through completion. The complete tracked
and sparse-file baseline proof remains assignment 50's separate audit.

No browser was launched. The operating-system socket restriction recorded
by assignment 44 remains outside these local tooling checks. Successful
bundling, CPU joint tests and simulation timing do not establish native
browser rendering, framebuffer correctness or GPU performance.

To reproduce the CPU observation from the repository root:

```sh
node --max-old-space-size=512 --experimental-transform-types docs/engine/mx-dynamics-2026-11-25/evidence/52-runtime-cost.ts
```

The script writes ignored measurement output under `test-results/agent52/`
and verifies its source fingerprint again before completing.
