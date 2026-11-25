# W08E — rendering range and resource review

Assignment **47/60**, wave 8. The review identified and repaired the measured
CPU cost of repeatedly normalizing disjoint dirty ranges. The repair preserves
the exact pending component coverage, existing 16-entry bound, full-upload
fallback, uploaded bytes, and attribute version behavior. The reserved
follow-up passed all **624 paired equivalence checks** and retained all transfer
savings. It shows a much smaller disjoint-range penalty than the separately
executed W07 run, while still exposing residual CPU regressions against the
original append-only baseline. All results and limits are recorded below.

Owned implementation files are the generic `src/rendering/attribute-ranges.ts` helper,
`tests/engine-attribute-range-coalescing.test.ts`, the separate follow-up
`scripts/engine-advancement/measure-attributes-review.mjs`, and this report.
The follow-up also adds its two raw evidence files, identified below.
No producer, model, character, environment, authored shader, material, profile,
tuning, dependency, or browser fixture was changed.

## Finding and implementation decision

The preserved [W07E measurement](w07e-attribute-measurement.md) recorded a
material CPU regression in the previous coalescer. For 16 disjoint entries,
helper cost rose from **22.26 to 193.07 ns/mark** and the complete mark plus
recording-upload scope rose from **98.90 to 296.53 ns/mark**. Both versions
uploaded the same **192 bytes in 16 calls**. These are the prior reserved
measurement's independent medians, not results from this repair. Repeated or
adjacent edits had separate, real transfer-volume benefits that must remain.

The prior helper checked ordering, normalized the whole list, searched for the
incoming span, and spliced the list for each insertion. The installed Three
`WebGLAttributes.updateBuffer` already sorts and merges that public list
immediately before `bufferSubData`, then clears it. Repeating canonicalization
on every mark is unnecessary when the list remains within its existing bound.

The revised helper uses the public pending list as its only state:

1. If the newest entry overlaps or touches the incoming span, extend that
   entry in place. This also absorbs duplicates and partial marks following an
   explicit full request.
2. If a separate entry fits below the 16-entry bound, append it directly.
3. If insertion would exceed the bound, normalize the actual public list and
   merge the incoming span before deciding whether to request a full upload.
   Existing duplicates or a bridge can free space; a genuinely seventeenth
   disjoint span still requests the full buffer.

The usual append/last-span path has constant work per mark. Full normalization
remains bounded for helper-owned lists and also handles oversized lists supplied
through Three's public API. No `WeakMap`, cached order, version-based trust,
retained side table, or caller protocol was introduced. Direct array mutation,
reordering, clearing, or replacement therefore cannot make hidden state stale.

### Preserved contract and representation change

Pending entries below the bound can now be unordered or overlap. Their exact
component union is unchanged. The existing upload boundary produces the same
bytes; helper calls still leave the source array untouched. Every nonempty
partial mark increments `version` exactly once, as does every full request.
Empty spans preserve both ranges and version. A full request remains sticky
until the public list is cleared, including Three's normal clearing after an
upload. No new clamping, validation, or accepted-input expansion was added.

The source review found no helper consumer that requires canonical pending
order. The three production sites that directly inspect pending ranges use
their own attributes and range-writing logic: vehicle shadow proxies,
motocross tyre traces, and GP slip marks. They were inspected without editing
them. Generic helper callers continue to supply inclusive item spans and the
same empty sentinels.

Tests that previously asserted canonical pending order now compare every
component of an independently constructed bitset union. This does not relax
coverage: omitted or extra components fail. The 16-entry bound, full-fallback
assertions, exact versions, untouched source bytes, upload byte counts, and
actual uploaded-buffer comparisons remain. Tests retain explicit exact single
ranges where full requests or last-span aggregation require them.

## Additional review of GPU ownership

The shared gate keys ownership by actual WebGL context identity and retains no
strong context registry. Each lease revokes itself before its final release;
releasing a borrower leaves the common pending fence owned by surviving
leases. The final owner deletes the map entry before driver cleanup. The
underlying gate polls real completion with zero wait timeout, retains pending
ownership on timeouts, and fails closed on loss or invalid wait results.

Festival admission occurs before presentation mutation. GPU preparation waits
for existing ownership, fences synchronous stages, preserves the first stage
error if fencing also fails, and observes asynchronous compile rejection before
a possible synchronous fence failure. Draw submission uses the existing final
fence path. This review found no additional concrete lifetime defect requiring
another production change.

This source review and controlled tests are separate from native acceptance.
At review time, the preserved native attribute-upload case had passed, while
the shared-fence test's complete-image check remained under investigation.
The unchanged native fixture still expects one narrow duplicate range, a full
range after 17 disjoint marks, and one narrow adjacent range after clearing;
the revised helper retains those representations. No native assertion change
is needed for this repair. Native software-renderer results do not establish
physical-GPU correctness, GPU duration, frame-time, or FPS improvements.

## Correctness validation

The focused helper suite passes **35 tests**, including two added regressions:

- Non-last overlaps occupy entries temporarily, then are reclaimed when a new
  disjoint mark would exceed capacity. The exact 16-span union is retained
  without an unnecessary full upload.
- Actual Three uploads observe direct mutation of range fields, reordering,
  public additions, explicit clearing, and replacement of the range array.
  Typed-array-width recording copies match the complete CPU buffer, full stickiness
  ends after explicit clearing, and the replacement full request remains full.

The original randomized test still checks 3,200 marks across five item sizes,
every expected component of the pending union, all versions, 100 actual Three
publication boundaries, and complete recorded bytes. Its representation oracle
is independent of the helper's list layout.

The completed focused runs total **51 tests across five files**:

| Group                                                              | Completed result |
| ------------------------------------------------------------------ | ---------------: |
| Attribute coalescing and public mutation                           |        35 passed |
| Existing effects upload, terrain continuity, Festival presentation |        14 passed |
| Graphics advancement composition with actual Three upload          |         2 passed |

Scoped ESLint, Prettier, and `git diff --check` passed. Commands used the
installed tools directly, without package lifecycle hooks:

```sh
node --max-old-space-size=384 node_modules/vitest/vitest.mjs run \
  tests/engine-attribute-range-coalescing.test.ts --maxWorkers=1 --reporter=dot
node --max-old-space-size=384 node_modules/vitest/vitest.mjs run \
  tests/effects-upload.test.ts tests/motocross-terrain-continuity.test.ts \
  tests/festival-presentation.test.ts --maxWorkers=1 --reporter=dot
node --max-old-space-size=512 node_modules/vitest/vitest.mjs run \
  tests/engine-graphics-advancement-composition.test.ts --maxWorkers=1 --reporter=dot
node --max-old-space-size=384 node_modules/eslint/bin/eslint.js \
  src/rendering/attribute-ranges.ts tests/engine-attribute-range-coalescing.test.ts \
  scripts/engine-advancement/measure-attributes-review.mjs
```

An initial combined six-file command ended with
`ERR_IPC_CHANNEL_CLOSED` after partial progress and no completed result. A
subsequent separate `tests/engine-shared-gpu-ownership.test.ts` run was
terminated with exit code **137** before a completed summary. Neither attempt
is counted as a pass, and neither supplied an assertion failure establishing
a production defect. The unchanged gate-ownership group remains for the
coordinator's exact-source CI validation. No additional local retry, full
compiler/build, or browser run was attempted.

## Preserved and follow-up measurements

The original `measure-attributes.mjs` and its W07 evidence are unchanged. The
new `measure-attributes-review.mjs` retains all **26 cases**, both CPU scopes,
fixture sizes, input actions, byte expectations, raw samples, warmup/sample
counts, source manifests, lock, and actual FestivalTrails producer proof.
Its only functional change is the untimed current-side pending oracle:
compare the exact coverage bitset with the independent dirty bitset rather
than require a particular ordering and decomposition of the pending list.
The header identifies it as the W08E follow-up. No timing work is moved into
or out of the measured region.

The preserved original workload SHA-256 is
`a4083d90c8ea62850de3fc19c38a1057a9aff31f44885d4e21340aa61e8ca97e`;
the follow-up workload SHA-256 is
`3a7719e9ac5533c8b291b85088dcc2e904c7d359dc3c6e8f19fde323d1b7c0ce`.

The harness refuses dirty relevant source inputs and existing output paths.
Reproduction uses an untimed preflight before an explicitly reserved run. Use
a new output path rather than overwrite the retained evidence:

```sh
node --max-old-space-size=512 --no-warnings --experimental-transform-types \
  scripts/engine-advancement/measure-attributes-review.mjs \
  --baseline /dev/shm/aeebac160835-engine-baseline \
  --current /tmp/aeebac160835-engine/Experiment-3 \
  --output /absolute/new/attribute-review-preflight.json
```

The reserved run adds `--measure --exclusive`, the full published
`--expected-current` commit, and
`--lock /tmp/aeebac160835-engine-wave7.lock`. All 26 cases and both scopes must
remain in the report, including regressions and noisy samples. The commands
executed for this assignment and their complete results follow.

## Executed source-frozen follow-up

The coordinator published the reviewed repair before the follow-up and reserved
exclusive local compute. Both the untimed preflight and the single measurement
used original commit `350119e8ec0606e8c5de5b3ab80df41104025679` and revised
commit `26efaeefdf5a39b1d28cec4f8fb6bca1c97bf7e1` (tree
`0067cdfd51fb6b9cdecfa9cc1632f8ec19879b50`). All relevant source inputs were
clean, `allowDirty` remained false, and every source and workload identity
remained stable. No source, Git, benchmark parameter, or assertion changed
during the reservation.

The preflight passed all **26 case audits, 104 smoke pairs across 52 workloads,
and three actual-producer publication checkpoints**, with all workload timings
null. Only after that success did the measurement start. The full run retained
the default target of 250,000 helper invocations per side/sample/case, three
warmup pairs and nine sample pairs. It passed all **624 pairs** across 52
workloads: 156 warmup pairs and 468 measured pairs. Together the two arms made
**312,002,832 helper invocations**, including warmups. Every pair compared the
complete 49,152-byte buffer, exact versions and guards outside the timer;
the aggregate pairwise buffer comparison volume was **30,670,848 bytes**.

The process used Node **24.22.3**, a 512 MiB JavaScript heap limit, and the
recorded Linux/x64 AMD EPYC runtime. Each helper source manifest has four
inputs; the shared actual BufferAttribute and WebGLAttributes graphs contain
10 and four inputs respectively; the actual FestivalTrails graphs contain
79 inputs per side. Full runtime, source, dependency and workload identities
are retained in the raw evidence.

The cooperative lock was acquired at `2026-11-25T09:59:54.290Z`; the report was
created at `2026-11-25T10:00:26.105Z`. That 31.815-second interval includes
preparation and proofs and is **not** a workload performance metric. The lock
was released on successful exit, and the coordinator was immediately notified.
No calibration, selected-case rerun, forced GC, outlier deletion, or parameter
search occurred. A cooperative lock cannot itself exclude unrelated system
work; exclusivity also relied on the coordinator's worker reservation.

| Evidence                                                                    |     Bytes | SHA-256                                                            |
| --------------------------------------------------------------------------- | --------: | ------------------------------------------------------------------ |
| [Untimed preflight](evidence/attribute-review-preflight-26efaeef.json)      |   825,700 | `3eb43dcf30470f3d78269a694cd63b97109996dbe3728b2265a02551e774d07b` |
| [Reserved measurement](evidence/attribute-review-measurement-26efaeef.json) | 1,656,174 | `935b2a8cb75308c33b8d8f98151e2d6687212e22f81377a824f0e9d0f12ea62c` |

Exact executed commands, without package lifecycle hooks:

```sh
node --max-old-space-size=512 --no-warnings --experimental-transform-types \
  scripts/engine-advancement/measure-attributes-review.mjs \
  --baseline /dev/shm/aeebac160835-engine-baseline \
  --current /tmp/aeebac160835-engine/Experiment-3 \
  --expected-current 26efaeefdf5a39b1d28cec4f8fb6bca1c97bf7e1 \
  --output /tmp/aeebac160835-engine/Experiment-3/docs/engine/advancement-2026-11-25/evidence/attribute-review-preflight-26efaeef.json

node --max-old-space-size=512 --no-warnings --experimental-transform-types \
  scripts/engine-advancement/measure-attributes-review.mjs \
  --baseline /dev/shm/aeebac160835-engine-baseline \
  --current /tmp/aeebac160835-engine/Experiment-3 \
  --expected-current 26efaeefdf5a39b1d28cec4f8fb6bca1c97bf7e1 \
  --output /tmp/aeebac160835-engine/Experiment-3/docs/engine/advancement-2026-11-25/evidence/attribute-review-measurement-26efaeef.json \
  --measure --exclusive --lock /tmp/aeebac160835-engine-wave7.lock
```

### Complete CPU results

The absolute columns are independent sample medians. The paired ratio is the
median of each revised/original duration ratio; it need not equal the ratio of
the two absolute medians. Values below one favor the revised helper. The full
range and count of faster pairs preserve variation rather than hide stalls.
Every case remains in both tables. Eighteen of 26 independent medians are
higher than the original baseline in each scope.

The helper scope includes clearing and dispatch. The second scope includes
actual Three merging/publication and the recording driver's JavaScript byte
copy. Setup, source loading, producer writes, checks, hashes, readbacks, and
object counters remain outside both timed regions. The public-range case also
includes three public writes for its one helper invocation. These scopes
overlap and must not be added or subtracted to infer separate costs.

#### Helper CPU

| Case                           | Original ns/mark | Revised ns/mark | Paired ratio |   Pair range | Revised faster |
| ------------------------------ | ---------------: | --------------: | -----------: | -----------: | -------------: |
| duplicate-17                   |            25.26 |           22.13 |       0.876× | 0.762–0.937× |            9/9 |
| duplicate-1000                 |            25.34 |           16.68 |       0.639× | 0.415–0.759× |            9/9 |
| contained-25                   |            23.66 |           20.35 |       0.837× | 0.760–1.013× |            8/9 |
| adjacent-17                    |            24.82 |           21.79 |       0.886× | 0.851–0.934× |            9/9 |
| overlap-17                     |            26.77 |           23.14 |       0.870× | 0.784–1.090× |            8/9 |
| bridge-at-16                   |            25.38 |           35.29 |       1.420× | 1.321–1.504× |            0/9 |
| disjoint-1                     |            66.47 |          123.06 |       1.850× | 1.792–1.911× |            0/9 |
| disjoint-2                     |            45.97 |           76.83 |       1.754× | 1.506–2.295× |            0/9 |
| disjoint-3                     |            37.59 |           66.41 |       1.836× | 1.663–2.279× |            0/9 |
| disjoint-4                     |            31.03 |           53.06 |       1.715× | 1.619–1.814× |            0/9 |
| disjoint-5                     |            28.75 |           47.48 |       1.660× | 1.507–1.757× |            0/9 |
| disjoint-6                     |            29.52 |           47.93 |       1.592× | 1.159–1.864× |            0/9 |
| disjoint-7                     |            28.28 |           45.86 |       1.677× | 1.609–1.914× |            0/9 |
| disjoint-8                     |            25.81 |           41.90 |       1.631× | 1.521–1.741× |            0/9 |
| disjoint-9                     |            25.09 |           40.98 |       1.686× | 1.460–5.931× |            0/9 |
| disjoint-10                    |            24.90 |           39.39 |       1.574× | 1.498–1.736× |            0/9 |
| disjoint-11                    |            25.11 |           41.21 |       1.699× | 0.495–2.315× |            1/9 |
| disjoint-12                    |            23.50 |           38.01 |       1.579× | 1.449–1.801× |            0/9 |
| disjoint-13                    |            26.50 |           39.81 |       1.596× | 1.334–1.935× |            0/9 |
| disjoint-14                    |            23.80 |           36.92 |       1.539× | 1.365–1.719× |            0/9 |
| disjoint-15                    |            24.68 |           38.11 |       1.532× | 1.426–1.726× |            0/9 |
| disjoint-16                    |            22.95 |           37.26 |       1.706× | 1.501–1.862× |            0/9 |
| disjoint-17                    |            28.29 |           60.66 |       2.112× | 1.802–2.446× |            0/9 |
| full-then-partials             |            27.01 |           20.58 |       0.778× | 0.714–1.149× |            8/9 |
| public-unsorted-then-enclosing |           113.32 |          110.49 |       0.974× | 0.915–1.051× |            8/9 |
| empty-mark                     |            44.66 |           43.71 |       0.944× | 0.896–1.039× |            7/9 |

#### Mark plus actual Three recording-upload CPU

| Case                           | Original ns/mark | Revised ns/mark | Paired ratio |   Pair range | Revised faster |
| ------------------------------ | ---------------: | --------------: | -----------: | -----------: | -------------: |
| duplicate-17                   |            99.73 |           30.72 |       0.316× | 0.216–0.376× |            9/9 |
| duplicate-1000                 |            26.30 |           17.62 |       0.663× | 0.448–0.728× |            9/9 |
| contained-25                   |            80.08 |           26.03 |       0.317× | 0.299–0.425× |            9/9 |
| adjacent-17                    |            94.19 |           30.46 |       0.329× | 0.294–0.341× |            9/9 |
| overlap-17                     |            97.07 |           30.56 |       0.310× | 0.295–0.325× |            9/9 |
| bridge-at-16                   |            95.55 |           68.01 |       0.721× | 0.454–0.930× |            9/9 |
| disjoint-1                     |           195.73 |          256.49 |       1.354× | 1.195–1.478× |            0/9 |
| disjoint-2                     |           172.11 |          238.52 |       1.368× | 1.309–1.527× |            0/9 |
| disjoint-3                     |           137.80 |          182.19 |       1.329× | 1.249–2.073× |            0/9 |
| disjoint-4                     |           126.02 |          170.26 |       1.363× | 1.245–1.469× |            0/9 |
| disjoint-5                     |           114.01 |          145.92 |       1.265× | 1.169–1.309× |            0/9 |
| disjoint-6                     |           107.35 |          134.12 |       1.251× | 1.173–1.302× |            0/9 |
| disjoint-7                     |           104.37 |          130.36 |       1.255× | 1.182–1.297× |            0/9 |
| disjoint-8                     |           100.08 |          124.30 |       1.254× | 1.194–1.520× |            0/9 |
| disjoint-9                     |            99.53 |          123.02 |       1.244× | 1.186–1.352× |            0/9 |
| disjoint-10                    |            98.05 |          118.25 |       1.201× | 0.850–1.249× |            1/9 |
| disjoint-11                    |            97.33 |          119.11 |       1.200× | 1.153–2.225× |            0/9 |
| disjoint-12                    |            94.42 |          111.70 |       1.175× | 0.975–1.269× |            1/9 |
| disjoint-13                    |            91.99 |          111.11 |       1.218× | 0.761–1.251× |            1/9 |
| disjoint-14                    |            94.08 |          113.41 |       1.195× | 0.686–1.563× |            1/9 |
| disjoint-15                    |            92.27 |          107.19 |       1.184× | 1.137–1.324× |            0/9 |
| disjoint-16                    |            92.52 |          113.32 |       1.215× | 0.978–1.316× |            1/9 |
| disjoint-17                    |            94.99 |          123.52 |       1.314× | 1.242–1.479× |            0/9 |
| full-then-partials             |            97.46 |           93.12 |       0.942× | 0.734–1.010× |            7/9 |
| public-unsorted-then-enclosing |           453.66 |          382.72 |       0.855× | 0.810–0.904× |            9/9 |
| empty-mark                     |            21.05 |           21.89 |       1.004× | 0.977–1.361× |            3/9 |

### Preserved transfer and producer results

All 26 cases retain the original W07 transfer-volume expectations exactly.
These are actual Three upload arguments into a recording boundary, followed by
complete byte comparisons; they are not native GPU elapsed times.

| Case group                              | Original bytes | Revised bytes | Original → revised observed pending objects |
| --------------------------------------- | -------------: | ------------: | ------------------------------------------: |
| 17 duplicates                           |         49,152 |            48 |                                      17 → 1 |
| 1,000 duplicates                        |         49,152 |            48 |                                   1,000 → 1 |
| 25 contained marks                      |         49,152 |           144 |                                      25 → 1 |
| 17 adjacent marks                       |         49,152 |           816 |                                      17 → 1 |
| 17 overlapping marks                    |         49,152 |            84 |                                      17 → 1 |
| Bridge after 16 disjoint entries        |         49,152 |           732 |                                     17 → 16 |
| Each disjoint count 1–16                |     12 × count |    12 × count |                               count → count |
| 17 disjoint marks                       |         49,152 |        49,152 |                                     17 → 17 |
| Full then 16 partial marks              |         49,152 |        49,152 |                                      17 → 1 |
| Three public ranges then enclosing mark |          2,436 |         2,436 |                                       4 → 3 |
| Empty mark                              |              0 |             0 |                                       0 → 0 |

All nonempty rows issue one upload except disjoint counts 1–16, which issue
one per span. Pending-object counts are observable identities from a separate
untimed audit. They do not count temporary splice/sort/iterator allocations,
allocated bytes, garbage collection, or retained heap. The helper retains at
most 16 entries after each valid nonempty call; 17 observed objects in the
fallback row are cumulative identities, not simultaneous pending entries.

The real FestivalTrails producer again passed all three publication boundaries:

| Snapshots | Segments | Version of each attribute | Original bytes | Revised bytes |
| --------: | -------: | ------------------------: | -------------: | ------------: |
|        41 |      320 |                        40 |         81,920 |        25,600 |
|       181 |    1,024 |                       181 |         81,920 |        81,920 |
|       182 |    1,024 |                       182 |            640 |           640 |

All three attributes, complete bytes, draw ranges, versions, ring overwrite
proof and return to narrow publication match. The revised pending entries at
the ring-wrap boundary can overlap instead of being one canonical full span;
Three still publishes the exact full union. This producer proof is untimed
and deliberately controls publication. It does not assert that GPU-gated
Festival presentation keeps mutating its scene.

### Interpretation and comparison with the preserved W07 execution

The new original-versus-revised pairs establish the residual cost explicitly.
For 16 disjoint marks, helper medians are **22.95 → 37.26 ns/mark** and complete
recording-upload medians are **92.52 → 113.32 ns/mark**. The paired ratios are
**1.706×** and **1.215×**. For a 16-mark batch, the independent-median overhead
is approximately **0.229 microseconds** for the helper scope or **0.333
microseconds** for the complete recording-upload scope. All nine helper pairs
are slower; eight of nine complete-scope pairs are slower. These are local CPU
costs and cannot be converted into an FPS or frame-time claim.

For 17 disjoint marks, normalization and full fallback still add work:
**28.29 → 60.66 ns/mark** helper and **94.99 → 123.52 ns/mark** complete scope,
with paired ratios **2.112×** and **1.314×**. At the other end, one disjoint mark
costs **66.47 → 123.06 ns** in the helper scope and **195.73 → 256.49 ns** in the
complete scope. The repair therefore does not remove the append-only baseline's
advantage for separate sparse edits.

Adjacent-17 improves in both scopes in all nine pairs, with paired ratios
**0.886×** and **0.329×** while preserving the 49,152-to-816-byte reduction.
Bridge-at-16 still costs more in the helper (**1.420×**) but improves the
complete recording-upload scope in every pair (**0.721×**), preserving the
49,152-to-732-byte reduction. Duplicate, contained and overlapping complete
workloads also improve in all nine pairs. Empty-mark differences are tiny,
mixed and dominated by shared dispatch/loop costs; no useful optimization
claim is made for that control.

The prior W07 measurement ran original `350119e8…` against candidate
`6a1c76fa…` in a different reserved execution. The table below records both
sessions rather than treat them as one direct previous-versus-revised
experiment. Original medians also vary between sessions. Cross-session
candidate differences are descriptive observations, not matched-pair effect
estimates or a universal improvement claim.

| Case / scope                  | W07 original → candidate ns/mark | Follow-up original → revised ns/mark | W07 paired ratio | Follow-up paired ratio |
| ----------------------------- | -------------------------------: | -----------------------------------: | ---------------: | ---------------------: |
| disjoint-1 / helper           |                    68.73 → 90.87 |                       66.47 → 123.06 |           1.301× |                 1.850× |
| disjoint-1 / complete         |                  195.10 → 227.93 |                      195.73 → 256.49 |           1.173× |                 1.354× |
| disjoint-2 / helper           |                    42.74 → 63.96 |                        45.97 → 76.83 |           1.484× |                 1.754× |
| disjoint-2 / complete         |                  180.53 → 231.84 |                      172.11 → 238.52 |           1.293× |                 1.368× |
| disjoint-16 / helper          |                   22.26 → 193.07 |                        22.95 → 37.26 |           8.643× |                 1.706× |
| disjoint-16 / complete        |                   98.90 → 296.53 |                       92.52 → 113.32 |           2.936× |                 1.215× |
| disjoint-17 / helper          |                   26.80 → 207.63 |                        28.29 → 60.66 |           8.204× |                 2.112× |
| disjoint-17 / complete        |                   95.93 → 293.62 |                       94.99 → 123.52 |           3.064× |                 1.314× |
| bridge-at-16 / helper         |                   24.72 → 206.01 |                        25.38 → 35.29 |           8.330× |                 1.420× |
| bridge-at-16 / complete       |                   97.90 → 227.00 |                        95.55 → 68.01 |           2.315× |                 0.721× |
| adjacent-17 / helper          |                    24.82 → 36.97 |                        24.82 → 21.79 |           1.509× |                 0.886× |
| adjacent-17 / complete        |                   103.92 → 48.49 |                        94.19 → 30.46 |           0.477× |                 0.329× |
| duplicate-17 / helper         |                    25.69 → 15.70 |                        25.26 → 22.13 |           0.638× |                 0.876× |
| duplicate-17 / complete       |                    95.01 → 23.99 |                        99.73 → 30.72 |           0.247× |                 0.316× |
| duplicate-1000 / helper       |                    24.02 → 11.51 |                        25.34 → 16.68 |           0.481× |                 0.639× |
| duplicate-1000 / complete     |                    24.48 → 11.69 |                        26.30 → 17.62 |           0.476× |                 0.663× |
| contained-25 / helper         |                    23.55 → 14.92 |                        23.66 → 20.35 |           0.610× |                 0.837× |
| contained-25 / complete       |                    78.09 → 19.50 |                        80.08 → 26.03 |           0.250× |                 0.317× |
| overlap-17 / helper           |                    25.76 → 20.01 |                        26.77 → 23.14 |           0.778× |                 0.870× |
| overlap-17 / complete         |                    95.12 → 29.56 |                        97.07 → 30.56 |           0.312× |                 0.310× |
| full-then-partials / helper   |                    26.31 → 15.92 |                        27.01 → 20.58 |           0.609× |                 0.778× |
| full-then-partials / complete |                    98.93 → 87.37 |                        97.46 → 93.12 |           0.874× |                 0.942× |
| empty-mark / helper           |                    41.92 → 42.21 |                        44.66 → 43.71 |           1.026× |                 0.944× |
| empty-mark / complete         |                    21.33 → 20.65 |                        21.05 → 21.89 |           0.980× |                 1.004× |

The severe prior 16-disjoint candidate costs, **193.07 ns/mark** helper and
**296.53 ns/mark** complete scope, are absent from the revised execution's
medians of **37.26** and **113.32 ns/mark**. This is consistent with the source
change that removes repeated whole-list normalization. It is not proof that
every workload improved over the previous candidate. Across the separately
executed sessions, the revised candidate median is higher for eight cases in
each scope: duplicate-17, duplicate-1000, contained-25, overlap-17, disjoint-1,
disjoint-2, full-then-partials and empty-mark. Those observations are included
above; no adverse sample or case was omitted.

Variation remains visible. The revised/original helper ratio for disjoint-9
ranges from **1.460× to 5.931×**, while disjoint-11 includes a **0.495×** pair.
No cause is assigned to these stalls. All raw warmups, measured pairs, order,
module lifetime, fixture setup and observation durations remain available.
The work is a synchronous warmed Node workload. Recording upload copies are
CPU work, and the actual producer proof is untimed. These results establish
neither native upload latency nor physical-GPU behavior, application FPS,
energy use, long-session heap savings, or game-wide image equivalence.

**Recommendation:** retain the stateless bounded repair and its documented
residual cost. It preserves every measured transfer benefit and byte contract,
removes repeated normalization from the common append path, and substantially
reduces the severe high-count disjoint penalty observed in the prior execution.
Do not claim a universal CPU improvement or erase the remaining original-baseline
regressions. No additional production edit or benchmark rerun is proposed.
Final shared-gate and native acceptance remain part of the coordinator's
exact-source CI evidence; this measurement does not substitute for them.
