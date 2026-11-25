# W07D — actual-source audio measurements

Assignment 40/60, wave 7. **Measurement and review complete.** The coordinator
executed the original prepared runner during its reserved local-compute window
at the stable candidate commit below. All 80 warmup/sample pairs preserve exact
mathematical output. Five warmed or aggregate workloads improve in every
measured pair; the first waveform, first family, and zero-gain control retain
measured costs that must accompany those gains.

Owned deliverables:

- `scripts/engine-advancement/measure-audio.mjs`
- `evidence/audio-measurement-smoke.json`
- `evidence/audio-measurement-operations.json`
- `evidence/audio-measurement.json`
- This report.

No production source, authored profile, recipe, model, character, environment,
dependency, or Git state changed in this assignment. The benchmark support
implementation and W04F guide were read in full, together with W03A, W04A,
W05E, and W06D. The earlier preparation pause is resolved; native audio
acceptance remains a separate CI responsibility.

## Actual source and authored fixtures

| Input                                  | Recorded identity                                                  |
| -------------------------------------- | ------------------------------------------------------------------ |
| Original checkout                      | `/dev/shm/aeebac160835-engine-baseline`                            |
| Original commit                        | `350119e8ec0606e8c5de5b3ab80df41104025679`                         |
| Candidate checkout                     | `/tmp/aeebac160835-engine/Experiment-3`                            |
| Prepared and measured candidate commit | `6a1c76fae3736e4d814ab6d0a354f6837320731c`                         |
| Original loudness SHA-256              | `01c9b225d95e3122fe3dff2278d40e8b279ef455bf5941c362d870adba5e3f00` |
| Candidate loudness SHA-256             | `19537125a0247ded5d1afb0992d5f9a7b4fcb4da318ec430f7ef3db045866c89` |

The runner uses the actual `src/audio/engine-loudness.ts` from each checkout.
The shared helper bundles both implementations without source rewriting,
minification, or tree shaking. Both sides use the same locked dependencies and
loader. There is no copied formula or reconstructed baseline.

The type-only profile import in the loudness module does not cover authored
values in its runtime graph. The runner therefore separately prepares and
loads each checkout's actual `src/audio/sound-profiles.ts` graph. All **29
recorded inputs in that fixture graph** match byte-for-byte between checkouts.
The actual exports contain **24 families, 72 family-band pairs, and 493 numeric
profile fields**. Complete profile objects and numeric values compare exactly.
Twenty-two families have three positive combustion-band gains; the two electric
families retain their original inactive combustion gains.

Both manifests retain source paths, file bytes/hashes, selected commits, config
and lock files, dependency root, loader and bundle identity. The helper and
workload hashes, runtime metadata, relevant Git status, and before/after
stability checks accompany the evidence. The authored fixture graphs receive
their own stability checks and value-mutation checks.

## Measured outcome

The retained [measured evidence](evidence/audio-measurement.json) contains two
warmup pairs and eight measured pairs for each of eight cases. The table uses
the independent median duration of each implementation's **eight measured
samples**, excluding warmups. A positive change means more elapsed time.
The invocation count is part of each workload; these durations must not be
combined into an overall engine or game improvement percentage.

| Sample workload                         | Original median ms | Candidate median ms | Elapsed-time change | Candidate faster pairs |
| --------------------------------------- | -----------------: | ------------------: | ------------------: | ---------------------: |
| First full waveform, module cold        |              2.282 |               4.668 |         **+104.5%** |                    0/8 |
| First active family, module cold        |              6.386 |               7.839 |          **+22.7%** |                    1/8 |
| First active family, basis already warm |              3.502 |               1.238 |              −64.6% |                    8/8 |
| 32 distinct fresh profiles, basis warm  |             99.441 |               8.039 |              −91.9% |                    8/8 |
| All 72 authored waveforms, module cold  |             71.666 |              13.264 |              −81.5% |                    8/8 |
| All 72 authored waveforms, basis warm   |             69.989 |               5.301 |              −92.4% |                    8/8 |
| 8,192 cached 117-harmonic updates       |             86.436 |              26.763 |              −69.0% |                    8/8 |
| 4,000,000 cached zero-gain updates      |             71.060 |              74.738 |           **+5.2%** |                    0/8 |

The change is `100 * (candidate median / original median - 1)`. Cached active
normalizers therefore take a median **10.551 → 3.267 microseconds per call** in
this loop, including dispatch and the store of every result. Those are local
arithmetic costs; they are not native render durations or game-frame savings.

The cold waveform pays about **2.386 ms more** at the independent medians. The
cold family's corresponding increase is **1.453 ms**. The initial waveform
still computes the same number of sines while additionally populating and
reading a retained basis. The full family reduces sine calls, but that
structural reduction did not translate into a faster first-family callback in
this run. Fresh module execution, allocation and JIT state are included in
these callback observations; this run does not isolate their individual
contributions. The complete 72-waveform cold sweep amortizes the initial basis
creation over many waveforms and is a separate, benefiting workload.

Each initialized candidate module also retains a **655,360-byte (640 KiB)
numeric basis payload**. This is a fixed per-module cache rather than a
per-profile allocation. The payload and its initialization are a cost of the
optimization; the figures are not a retained-heap or total-memory measurement.

Zero gains require no filter work in either version. The candidate is slower
in all eight measured pairs, so this is retained as a local regression, not
described as a gain. Its independent-median difference is about **0.92 ns per
invocation**, within a loop that also dispatches calls and writes a 32 MB trace
per side. This does not isolate the cost of the function's inactive branch.

## Pair order, spread and limits

Every measured phase alternates **AB, BA, AB, BA, AB, BA, AB, BA**, with A the
original and B the candidate. Both sides receive the same input schedule and
derived seed in each pair. All raw samples and both warmup pairs remain in the
JSON; no outlier was deleted or rerun selected. The next table reports ratios
of candidate/original duration **within each pair**, which are distinct from
the ratio of independent medians above. Each order-specific median contains
four pairs.

| Case                    | Original sample range ms | Candidate sample range ms | Median paired ratio | AB median ratio | BA median ratio |
| ----------------------- | -----------------------: | ------------------------: | ------------------: | --------------: | --------------: |
| Cold first waveform     |              1.857–2.461 |               2.691–7.949 |               1.957 |           1.679 |           2.438 |
| Cold first family       |             4.921–11.022 |              5.991–10.663 |               1.193 |           1.248 |           1.193 |
| Warm-basis first family |              3.285–4.062 |               1.005–1.528 |               0.353 |           0.324 |           0.373 |
| 32 fresh profiles       |           92.917–107.513 |              7.259–15.802 |               0.082 |           0.079 |           0.084 |
| All 72 cold             |            70.235–87.680 |             11.797–16.869 |               0.187 |           0.188 |           0.187 |
| All 72 warm             |            68.017–74.927 |               5.088–6.440 |               0.076 |           0.076 |           0.076 |
| Cached active updates   |            81.871–88.952 |             24.390–35.955 |               0.309 |           0.317 |           0.307 |
| Zero-gain control       |           67.163–103.973 |            71.577–152.802 |               1.049 |           1.094 |           1.038 |

The five benefiting cases retain their direction in every pair and both order
groups. Both order groups also retain the unfavorable direction for all three
other cases. The cold-waveform magnitude varies considerably with pair and
order; eight pairs do not establish the cause of that spread. The one faster
cold-family candidate occurs against the largest original sample, 11.022 ms;
that pair remains included.

The zero-gain case has large early durations: its first warmup is
172.063/163.997 ms, its second is 85.388/95.435 ms, and its first measured pair
is 103.973/152.802 ms. These observations caution against treating this one
process as an asymptotic steady-state microbenchmark. Its later values and
median still preserve the candidate's slower direction. No post hoc trimming
or extra warmup rule was introduced.

The candidate cached-active batches lasted 24.390–35.955 ms, below the original
planning target of roughly 50 ms. The shorter durations and observed spread
remain explicit limitations; all eight pairs still retain the same direction.
No count-adjusted rerun was performed. Single first-use samples intentionally
remain one invocation and are shorter still.

Cases run in a fixed sequence within one process. Alternating pair order
reduces one source of ordering bias but does not reset VM/CPU/allocator state
or prove independence between samples. The coordinator arranged that other
active agents performed only light reading/editing during this run. The
cooperative lock records that reservation; it cannot certify the absence of
unrelated host activity. These are bounded local observations, not confidence
intervals, cross-machine predictions, or a universal speedup guarantee.

## Measured equivalence and reproducibility

The run completed with **0 numeric mismatches and maximum finite difference
0** across **40,085,160 workload output comparisons**. That total comprises
40,000,000 inactive-gain control results and 85,160 results from the other
seven cases; it must not be presented as 40 million active synthesis updates.
There are 16 warmup pairs and 64 measured pairs. All 493 authored-profile
numeric fields and 24 additional edge outputs match too, and every workload
input remains unchanged.

The report records `stableSources: true` and valid comparison timing for all
eight workloads. Reviewer inspection independently verified that both current
on-disk benchmark code hashes still match the hashes captured during the run.
The reviewed record is:

| Recorded field        | Value                                                              |
| --------------------- | ------------------------------------------------------------------ |
| Report creation time  | `2026-11-25T09:03:29.714Z`                                         |
| Runtime               | Node `v24.22.3`; V8 `13.6.233.17-node.63`; Linux x64               |
| CPU metadata          | AMD EPYC 9V74 80-Core Processor; 9 exposed logical CPUs            |
| Evidence file bytes   | 243,875                                                            |
| Evidence SHA-256      | `b2f295ae8f54453247cfe50e38a654b50389a512189c91220bdb25acc9bf3791` |
| Workload SHA-256      | `b718f86fda366ccb34c18ecc1165cd2ecf2ce5b11553f4c08cc19bed1d8c6cf7` |
| Shared-helper SHA-256 | `dd913599e80387a2e9f8e34364e5bd57b5a2845e9d330966430183eafe2d7522` |
| Coordinator log       | `/tmp/aeebac160835-engine/validation/w07d-audio-measurement.log`   |

The coordinator recorded exit 0 and released the shared lock. This review did
not rerun the benchmark or change the runner, production code, or evidence.

## Workload and cache boundaries

| Case                          | Work performed by one sample                                                                       | Cache setup                                                                                                                                  |
| ----------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `cold-first-waveform`         | One actual 40-coefficient normalization; both `peak` and `power` recorded                          | Entire fresh bundled graph per sample. The first basis allocation/population is inside the callback.                                         |
| `cold-first-family`           | One active three-band APX-family normalizer call                                                   | Entire fresh graph per sample; basis and profile waveform cache are absent.                                                                  |
| `warm-basis-first-family`     | One active APX-family normalizer call                                                              | Entire fresh graph, followed by one direct waveform normalization in setup. The basis exists; no profile waveform cache entry exists.        |
| `warm-basis-fresh-profiles`   | A batch of distinct cloned profile objects with unchanged authored values                          | Basis primed outside timing. Every measured profile identity is new and has no cached waveforms.                                             |
| `all-72-waveforms-cold`       | One complete authored sweep; all 144 peak/power numbers recorded                                   | Fresh graph; first basis construction remains inside the sweep.                                                                              |
| `all-72-waveforms-warm`       | The same complete authored sweep                                                                   | Basis explicitly primed in setup; direct normalization does not cache per-spectrum results.                                                  |
| `cached-117-harmonic-updates` | Cached normalizer updates through a deterministic 64-call schedule across active authored families | All actual profile objects and waveforms primed outside timing; 39 harmonics in each of three bands remain below the inclusive 20 kHz limit. |
| `cached-zero-gain-control`    | The same style of call loop with three zero gains                                                  | The profile is actively primed outside timing. The measured calls require no waveform/filter work.                                           |

The first waveform and first-family cases contain **exactly one invocation**.
They never average a first use together with cache hits. The complete 72-pair
cold sweep is an aggregate workload and must not be presented as the first
waveform's latency. The warm-basis first-family case primes a direct waveform,
which deliberately leaves the weak profile cache empty.

Imports, fixture generation, profile cloning, schedules, output-buffer
allocation, comparisons and report writes occur outside the callback. Actual
production allocations and stores of every returned number remain inside.
Hot-case schedules vary frequencies, cutoff and target without changing authored
profiles or gains. Their frequencies force all 117 harmonic evaluations.

Fresh module graphs reset module-owned caches, not the process, JIT, CPU cache,
or allocator. Node retains fresh ESM instances until process exit; sample counts
are bounded. This is not a cold-process startup benchmark.

## Exactness preflight

The smoke completed **8 cases and 16 sample pairs**, with one AB and one BA pair
for every case. Direct comparisons covered:

- **4,880 complete workload output numbers**, including both numbers returned
  by every waveform normalization.
- **493 authored-profile numeric fields**, alongside complete profile-object
  equality and all 29 unchanged fixture graph inputs.
- **24 edge outputs**, covering eight empty, silent, nonfinite, signed-zero-input,
  full-length and long-fallback spectra, public filter edge calls, and inactive
  gains. Eight matching NaNs were observed.

All compared outputs match; maximum finite difference is **0**. Every workload
duration and median is **null** and `timing.validForComparison` is **false**.
Recorded build/import/setup diagnostics are not workload performance evidence.

The numeric comparator uses `Object.is`: NaN matches NaN, while positive and
negative zero differ. An explicit comparator check rejects opposite zero signs
and accepts matching NaNs. Checksums canonicalize NaN payloads only and do not
replace direct comparisons. All workload input values are checked before and
after execution using a canonical value encoding that preserves nonfinite
numbers, signed zero, typed-array kinds and their complete contents. This avoids
mistaking V8 internal numeric representation changes for input mutation.

## Separate untimed structural counts

`--mode counts` runs in its own process. Only that mode wraps `Math.sin`,
`Math.cos`, and `Float64Array` construction; it never performs timed work.
Fixture construction and cache priming precede instrumentation. It compares all
**296 produced output numbers** directly in the eight instrumented cases.

| Instrumented operation             | Calls | Original sin | Candidate sin | Original cos | Candidate cos |
| ---------------------------------- | ----: | -----------: | ------------: | -----------: | ------------: |
| First full waveform                |     1 |       79,872 |        79,872 |            0 |             0 |
| First full family                  |     1 |      239,733 |        79,873 |          819 |           235 |
| First family with warm basis       |     1 |      239,733 |             1 |          819 |           235 |
| Two fresh profiles with warm basis |     2 |      479,466 |             2 |        1,638 |           470 |
| All authored waveforms, cold       |    72 |    5,750,784 |        79,872 |            0 |             0 |
| All authored waveforms, warm       |    72 |    5,750,784 |             0 |            0 |             0 |
| Cached 117-harmonic update         |     1 |          117 |             1 |          819 |           235 |
| Cached zero-gain control           |     1 |            0 |             0 |            0 |             0 |

A separate fresh-module inactive-gain probe uses a profile that throws on any
property access. Both versions return 1 with no profile access, sine/cosine call,
or Float64 allocation. Inactive gains include zero, negative zero, and NaN.

Each cold candidate waveform/family/sweep records exactly one **655,360-byte
(640 KiB) Float64 numeric payload allocation**. This is the lazy fixed
`2048 * 40` basis, including the unused column zero. The measured-operation
boundary records no further Float64 allocation in the warm cases. This observes
the payload's construction, not retained heap, GC, object headers, coefficient
arrays, existing weak profile-cache entries, or total process memory.

The first full waveform does **not** save sine calls and additionally builds the
basis; the measured first-use latency is worse in this run. Zero gains already
do no filter work in the original and also measured slower here. The structural
counts explain work differences but do not supersede those elapsed results.

## Execution and bounded reservation

Completed commands:

```sh
node scripts/engine-advancement/measure-audio.mjs \
  --baseline /dev/shm/aeebac160835-engine-baseline \
  --current /tmp/aeebac160835-engine/Experiment-3 \
  --current-commit 6a1c76fae3736e4d814ab6d0a354f6837320731c \
  --mode smoke \
  --output /tmp/aeebac160835-engine/Experiment-3/docs/engine/advancement-2026-11-25/evidence/audio-measurement-smoke.json

node scripts/engine-advancement/measure-audio.mjs \
  --baseline /dev/shm/aeebac160835-engine-baseline \
  --current /tmp/aeebac160835-engine/Experiment-3 \
  --current-commit 6a1c76fae3736e4d814ab6d0a354f6837320731c \
  --mode counts \
  --output /tmp/aeebac160835-engine/Experiment-3/docs/engine/advancement-2026-11-25/evidence/audio-measurement-operations.json

node scripts/engine-advancement/measure-audio.mjs \
  --baseline /dev/shm/aeebac160835-engine-baseline \
  --current /tmp/aeebac160835-engine/Experiment-3 \
  --current-commit 6a1c76fae3736e4d814ab6d0a354f6837320731c \
  --mode measure --exclusive \
  --output /tmp/aeebac160835-engine/Experiment-3/docs/engine/advancement-2026-11-25/evidence/audio-measurement.json

node node_modules/eslint/bin/eslint.js scripts/engine-advancement/measure-audio.mjs
```

Scoped ESLint passed; the script was formatted with Prettier before both
preparation evidence runs and retained the same hash for measurement. The
coordinator executed the measured command under its explicit reservation. No
full compiler/build, npm lifecycle hook, browser, or Git mutation was run by
this assignment.

The measured mode requires `--mode measure --exclusive`, the coordinator's
reserved full `--current-commit`, and a new explicit output path. It acquires
the shared `/tmp/aeebac160835-engine-wave7.lock` without stealing an existing
lock. Absolute baseline/current/output paths are mandatory and existing evidence
cannot be overwritten. All raw paired samples are retained without outlier
removal; source or benchmark drift aborts the run.

Defaults are 2 warmup pairs and 8 sample pairs, 8,192 cached active updates per
sample, 4,000,000 zero-gain updates per sample, and 32 fresh profiles in the warm
batch. The latter two use output traces of 32 MB and 256 bytes per side,
respectively; traces are compared outside callback timing. The explicit
`--hot-iterations`, `--zero-iterations`, `--fresh-profiles`, `--samples`,
`--warmups` and `--cases` options allow a bounded reservation to adjust counts.

The canonical reserved run used these original defaults without a subsequent
calibration or count-adjusted rerun. The earlier 20–60 second wall-time estimate
was planning guidance only; the actual sample durations and their limitations
are recorded above. Single first-use cases remained one invocation.

No native Web Audio, PCM, audio-device, audible-quality, browser latency, or
game-frame-rate claim follows from this arithmetic work. The native test's
control variability and fixture acceptance bound are owned by W06D and the
coordinator's CI record. This benchmark retains exact mathematical equality.
