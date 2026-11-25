# W03C — bounded attribute range coalescing

Date: 2026-11-25. Assignment 15, wave 3. This implements rendering audit scope 1 in the generic attribute helper. Changed files are `src/rendering/attribute-ranges.ts`, `tests/engine-attribute-range-coalescing.test.ts`, and this note.

## Change and preserved behavior

`markItems` now merges overlapping and touching component spans before applying the existing 16-span budget. It retains genuinely separated spans and falls back to the existing explicit full marker only when the resulting union would contain more than 16 spans. The incoming span remains outside the list until that decision, so helper calls never temporarily insert a seventeenth pending entry. A bridge can reduce an already full 16-entry budget without triggering a full upload.

Existing ranges added through Three's public API are normalized in place. Already ordered lists skip sorting; contained marks against a single span only increment the attribute version. These paths use no cache or state outside `updateRanges`. An explicit full marker absorbs subsequent supported partial marks, and Three's normal range clearing after an update permits narrow marks again.

Inclusive item bounds, item-to-component conversion, and the empty-span check remain unchanged. Every nonempty `markItems` call increments `version` exactly once, including duplicates, contained marks, and budget fallback. Every `markAll` increments it once. Empty marks change neither ranges nor version; array contents remain untouched by either helper. No new input clamping or validation was introduced.

Before editing, the audit, existing upload/terrain/Festival tests, and helper callers were inspected. Callers use inclusive item spans and existing `first > last` empty sentinels. Existing direct range manipulation in vehicle bodies and tyre/slip helpers was inspected but not modified. No authored models, effects, environments, geometry, materials, assets, callers, or Three vendor files changed.

## Actual Three transfer evidence

The tests import installed Three 0.180.0 `WebGLAttributes`. A recording GL shim primes storage through its actual `bufferData` call, then copies the precise `bufferSubData` byte windows into a separate buffer. Tests compare that buffer with independent CPU reference bytes. The shim does not implement Three's merge or version logic. A test-local reproduction of the previous append-only helper establishes the before values.

For a 4,096-item Float32 vec3 attribute, repeatedly changing and marking inclusive items 100–103:

| Marks before upload | Previous helper bytes | Coalesced helper bytes | Coalesced pending entries | Version |
| ------------------: | --------------------: | ---------------------: | ------------------------: | ------: |
|                  16 |                    48 |                     48 |                         1 |      16 |
|                  17 |                49,152 |                     48 |                         1 |      17 |
|               1,000 |                49,152 |                     48 |                         1 |   1,000 |

The 17/1,000-mark fixtures transfer 1,024 times fewer bytes. This is measured upload-argument volume, not GPU elapsed time or game performance.

Five 17-call workload fixtures also assert actual upload bytes:

| Workload                                  | Previous helper bytes | Coalesced helper bytes |
| ----------------------------------------- | --------------------: | ---------------------: |
| Duplicate four-item marks                 |                49,152 |                     48 |
| Overlapping four-item marks               |                49,152 |                     84 |
| Adjacent four-item marks                  |                49,152 |                    816 |
| Seventeen disjoint four-item marks        |                49,152 |                 49,152 |
| Explicit full mark, then 16 partial marks |                49,152 |                 49,152 |

A separate 256-item vec3 fixture verifies 16 disjoint single-item spans produce 16 transfers totaling 192 bytes, while 17 disjoint spans produce one 3,072-byte full transfer. Both buffers exactly match the written CPU bytes.

## Coverage and commands

The new test file contains **33 tests**. Coverage includes duplicate, contained, enclosing, overlapping, adjacent, bridging, and separated spans; unordered public-API ranges; both budget boundaries; full-to-partial and partial-to-full ordering; repeated full marks; empty ranges and empty attributes; post-upload clearing; exact version increments; unchanged CPU data; and Uint8/Uint16/Float32 view offsets and byte widths.

Deterministic randomized coverage spans item sizes 1, 2, 3, 4, and 16 with separate seeds. Each size performs 640 operations and 20 uploads, with deferral intervals of 1, 2, 17, 43, and 97 operations repeated four times. Overall: **3,200 operations, 100 byte-for-byte upload comparisons, 55 explicit full resets, 110 empty marks, and 3,035 nonempty partial marks**. A component bitset independently computes the expected pending union after every operation and enforces the 16-entry limit. It also checks all 3,090 expected version increments.

Direct validation, with no npm hooks:

```sh
./node_modules/.bin/vitest run tests/engine-attribute-range-coalescing.test.ts tests/effects-upload.test.ts tests/motocross-terrain-continuity.test.ts tests/festival-presentation.test.ts --maxWorkers=1 --reporter=dot
./node_modules/.bin/eslint src/rendering/attribute-ranges.ts tests/engine-attribute-range-coalescing.test.ts
```

Final result: **4 test files / 47 tests passed**; scoped ESLint passed. The existing coverage contributes one effects-upload test, seven terrain-continuity tests, and six Festival-presentation tests. Full-suite, full-build, and publication validation remain with the integration owner.

## Exploratory CPU cost and remaining limits

Setting `ENGINE_ATTRIBUTE_RANGE_BENCH=1` on the focused Vitest command additionally reports warmed local helper timings. Each workload uses 1,000 warm-up batches, followed by the median of five samples of 2,000 batches, with 17 marks per batch. Timing includes loop dispatch and clearing the pending list between batches; GPU upload time is excluded. It has no timing pass/fail threshold.

Observed local medians for the final helper implementation:

| Workload   | Previous helper ns/mark | Coalesced helper ns/mark |
| ---------- | ----------------------: | -----------------------: |
| Duplicate  |                   28.82 |                    19.91 |
| Overlap    |                   24.06 |                    19.46 |
| Adjacent   |                   18.78 |                    37.90 |
| Disjoint   |                   19.89 |                   225.27 |
| Full-dirty |                   29.91 |                    15.49 |

These measurements ran while another worker was executing physics work. They are exploratory, not isolated CPU benchmarks or acceptance thresholds. They expose extra helper cost for adjacent and especially disjoint sequences, which must remain separate from the proven transfer savings. The dedicated timing wave should measure this production helper without competing compute before drawing a CPU performance conclusion.

Native-browser execution is blocked locally. This assignment does not claim native GPU timing, FPS improvement, image equivalence, or a verified real culled-to-visible caller. Deferred uploads are exercised against the actual Three uploader through the recording shim; native caller evidence remains for later browser CI. Input support remains the existing valid item spans and empty sentinels used by callers.
