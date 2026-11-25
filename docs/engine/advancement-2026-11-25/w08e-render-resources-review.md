# W08E — rendering range and resource review

Assignment **47/60**, wave 8. The review identified and repaired the measured
CPU cost of repeatedly normalizing disjoint dirty ranges. The repair preserves
the exact pending component coverage, existing 16-entry bound, full-upload
fallback, uploaded bytes, and attribute version behavior. Its CPU effect still
requires the coordinator's reserved measurement; correctness tests alone are
not a performance result.

Owned files are the generic `src/rendering/attribute-ranges.ts` helper,
`tests/engine-attribute-range-coalescing.test.ts`, the separate follow-up
`scripts/engine-advancement/measure-attributes-review.mjs`, and this report.
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
Run its untimed preflight after the coordinator commits the source, then run
one measurement only after exclusive compute is reserved:

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
remain in the report, including regressions and noisy samples. The current
acceptance decision is **correctness verified by the focused helper suite;
51 focused tests passed; shared-gate CI acceptance, clean-source preflight,
and reserved CPU remeasurement pending publication**.
