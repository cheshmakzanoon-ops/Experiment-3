# Continuation engine evidence

## Disposition: commit 4c9 is rejected

Commit `4c9b858452fbf099509e471c3db619a7a4b33717` is **not accepted**. Its unchanged nineteen-scenario motorcycle matrix and strict GP calibration passed, but the original fifty-one-test gate on the same integrated physics files finished **49/51**: Vellamar seed 5222 and Montejaral seed 5111 each had one fall where zero was required. The passing broad matrix and calibration do not override these failures.

This archive contains completed historical acceptance runs, causal controls, and independent native path proofs. It is not a final release acceptance package. No tests were run to stage this archive, and no protected checkout was modified.

## Evidence map

| Directory | What it establishes |
| --- | --- |
| `rejected-4c9/matrix-and-calibration` | Original nineteen-scenario JSON, complete stdout, full source-guard receipts, and summaries for the rejected 4c9 source |
| `rejected-4c9/original51-support` | Original 49/51 failure log/receipt, the seventeen-file physics whitelist, and a read-only SHA-256 linkage to 4c9 for all seventeen files plus the four original gate files |
| `causal-controls/pure-history` | Both original Vellamar 5222 and Montejaral 5111 pass on the preserved history-only source |
| `causal-controls/preprofile` | History plus current-path handoff and the existing 220 m passing reservation: Vellamar passes, Montejaral fails with one fall before any extended prospective profile |
| `causal-controls/path-only` | The current-path handoff alone, on history-only physics and original traffic code, reproduces Montejaral's one-fall failure |
| `native-path` | Independent review, Cartesian world-motion proofs, full-native-update sampled-frame proofs, and exact test drafts |
| `native-path/moving-path-native` | Seven passing native consumer cases; source hashes and external test configuration |
| `native-path/relative-intent-positive` | Three passing native generator cases on the attributed relative-intent source |
| `native-path/relative-intent-negative` | The same generator tests on the old source: the flat control passes, both mirrored slopes fail on the expected invented 0.025 m lane displacement |
| `reproducibility` | The unchanged external guard wrapper and exact gate/guard inputs read from Git commit 4c9 |

`copy-provenance.json` maps every verbatim copy to its original file or committed Git input. `hash-index.json` records artifact hashes and subject dispositions. `SHA256SUMS` also covers the hash index. Historical absolute paths in receipts are preserved verbatim; the evidence map above gives their archived locations.

## Results and attribution

The nineteen-scenario matrix classified all **158 rider starts**. It recorded twelve falls in total, with twelve zero-fall scenarios, a maximum of four falls in one scenario, and a longest stop of 11.2583 s. These are passing results under that script's own unchanged limits; they are not zero-fall results. The separate strict calibration completed successfully for GP-R1 and GP-R2 at both time steps. The structured calibration summary transcribes the original log's displayed precision.

Both 4c9 acceptance receipts report the same 7,248-file input/output digest:

`9d568b6a29b057faa8714068ffb93a6eeeb9264d868b54b9e8cd755a73dce37a`

The original fifty-one-test gate ran in the frozen physics candidate rather than the root integration checkout. `original51-support/source-linkage.json` verifies every integrated candidate file and every original gate file against 4c9. The full checkout inventories and their guard digests differ; the archive does not claim that the two whole checkouts were byte-identical.

The causal controls preserve the original mixed-passing assertion file with SHA-256:

`de20c703b20d780a5aafee7eeba45be8efaab5f59c780c303a3b6c704e734253`

Their separate source-attribution records identify the exact five relevant production files. A passing control pair only establishes that those cases pass on its baseline; it is not general acceptance of that source.

## Native proof boundaries

The moving-path oracle prescribes world velocity independently of the native reference-course formula. It isolates temporal selected-lane motion, clipping at different stations, realized local edge slew, and sideslip representation. Its accompanying seven-case suite passes on the selected-path source. That source's closed-loop race composition was subsequently rejected, so local zero-error proofs must not be promoted into a race-success claim.

The held-lane oracle runs the complete native AI and TrafficPlanner with one rider on a prescribed stationary diagonal path. It demonstrates that retaining a sampled absolute target and subtracting a newly sampled authored line invents lateral lane motion. Caching the relative goal removes this artifact without changing rates or gains. Its positive receipt predates the subsequent `!preparingPit` capture restriction, as explicitly recorded in the independent review. These native receipts guard five relevant source files, not the full repository. They are distinct from the full source-guard receipts on the original races and calibration.

The actual Montejaral world-path comparison retains an approximately −0.70 m/s² stationary spatial-stencil residual. The temporal correction removes the additional moving-reference error. The review does not claim that the existing authored curvature reconstruction is exact.

## Reproducing the original guarded scripts

Restore the source revision or candidate whose hashes match the relevant receipt. Use its existing dependency installation. Run the wrapper with an output directory outside that source checkout. The wrapper imports that checkout's own `scripts/source-stability.ts`, inventories source before and after, captures actual process exit status and stdout, and rejects any source change. No assertion or integration loop is substituted.

For the nineteen-scenario matrix:

```sh
node --no-warnings --experimental-transform-types \
  reproducibility/run-frozen-acceptance.mjs \
  /absolute/source /absolute/external-output motorcycle-matrix \
  node --no-warnings --experimental-transform-types \
  /absolute/source/scripts/bike-race.ts
```

For strict GP calibration:

```sh
node --no-warnings --experimental-transform-types \
  reproducibility/run-frozen-acceptance.mjs \
  /absolute/source /absolute/external-output strict-gp-calibration \
  node --no-warnings --experimental-transform-types \
  /absolute/source/scripts/vehicle-calibration.ts --strict --only=gpr1,gpr2
```

Each causal-control receipt contains its exact original Vitest arguments, including its case selector. The same wrapper was used for those runs. Do not reinterpret their source directories as the current checkout; use the recorded hashes.

For a standalone native oracle:

```sh
node --no-warnings --experimental-transform-types \
  native-path/gp-moving-path-oracle.mjs /absolute/source /absolute/oracle-output.json

node --no-warnings --experimental-transform-types \
  native-path/gp-held-lane-oracle.mjs /absolute/source /absolute/oracle-output.json
```

For native Vitest drafts, create an external review directory with the archived `tests` and `vitest.config.ts`, plus `src` and `node_modules` links to the matching source/dependency directories. Run the exact command in its receipt from that external review directory. Source and dependency symlinks are intentionally not archived, and none of these commands were rerun during staging.
