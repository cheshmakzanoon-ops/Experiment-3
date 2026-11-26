# Assignment 60 — Published engine and corrective CI verification

**PASS: remote publication integrity and the corrective hosted `validate` job.**
The final observed CI snapshot is **2026-11-26T00:48:24.913Z**, for source commit
`b48249d2da1717e004f7f1c1b0f3501fa2c6739a`. The complete validation job finished successfully at
**2026-11-26T00:47:55Z**. Broader hosted tests and browser workflows remain
unfinished at this boundary; this report does not claim global CI or deployment success.
The [machine-readable evidence](../evidence/60-remote-verification.json) records
commit ancestry, tree and content checks, all observed jobs, and the initial failure.

## Actual published commits

| Role | Commit | Tree |
| --- | --- | --- |
| Preserved main baseline | `c9c94c7029dbc3e29b18101ef7ccea0a897184d1` | `5e9fea61ed17d0709a192e2106ef20e161788ffc` |
| Engine, tests and benchmarks | [`9b5fead87ae56902b138951e093c5f054b36d8a3`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/9b5fead87ae56902b138951e093c5f054b36d8a3) | `48e2f2104d145ee02697f3232bfd663d6ba48aec` |
| Initial engineering documentation | [`2904ea226590e4f9c75b7e4aecf544c7b7f8fb15`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/2904ea226590e4f9c75b7e4aecf544c7b7f8fb15) | `a09181be63652ea508bcdfce9c04e13204ca7262` |
| Corrective benchmark/test typing | [`b48249d2da1717e004f7f1c1b0f3501fa2c6739a`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/b48249d2da1717e004f7f1c1b0f3501fa2c6739a) | `abd4e15505397b438459027ca244efe54f32916f` |

The initial parent chain is baseline → engine → documentation. The corrective
commit's sole parent is `53f2abfe49bfa5042b0d1444387030603493ebb4`, preserving
both intervening CI report commits (`e3cf1324` and `53f2abfe`) and their six
`ci-reports/` paths. At the final lookup, main had advanced to
`16247dfd16f2e14564f8cb0fff056870e48e5292` with tree `6cf2284faae72df232e7e98e4a4d8e2fb545cbb7`.
GitHub comparison proves that this is one direct CI report successor of the
corrective commit, changing 29 paths entirely within `ci-reports/`. Its report
changes do not alter the engine, tests, authored assets or engineering reports.
Root must preserve any additional successors when publishing the final receipt.

## Independent content verification

| Boundary | Verified result |
| --- | --- |
| Initial publication | Exactly **188 paths**: 61 code/test/benchmark files and 127 documentation/evidence files |
| Code scope | **9 runtime**, 46 tests/helpers and 6 benchmarks |
| Manifest contents | Every published byte length, SHA-256, Git blob ID and mode matches the frozen manifest |
| Tree reconstruction | Independent Python Git blob/tree encoding reproduces the base, code and integration tree SHAs |
| Direct remote source tree | **1,126 source blobs**, complete and untruncated, match the immutable fetched Git objects |
| Fingerprint inputs | All **1,129** published source/build inputs produce the frozen fingerprint below |
| Authored assets/reference files | **291 files** match both the initial task baseline and integrated main |
| Other runtime source | **1,117 files** outside the nine changes remain identical to integrated main |
| Initial publication hygiene | Zero deletions, mode changes or unexpected paths |
| Corrective commit | Exactly the two reported benchmark/test files; every other parent-tree entry remains unchanged |

Frozen runtime fingerprint, also unchanged after the corrective publication:

```text
4c041cb338d0fa480e0514ee905137a24061494b98b9899949238f6b137be790
```

The fingerprint was recomputed from **published immutable Git blob bytes**, not
inferred from a clean working tree. Direct GitHub commit/root/source-tree reads
agree with those objects. The current local runtime also hashes identically.
The corrective remote source subtree remains `67364b3468a3184d26786bc026d523ad867764d9`;
all three additional fingerprint inputs are unchanged as well.

The asset/reference check includes `public`, `assets`, `authoring`, `reference`,
`playable`, `lookdev-tmp`, `screenshots` and `scratch-tmp`. No character models,
3D assets, textures, materials or authored environments were changed by this work.
The original manifest SHA-256 is
`205ebd34842a3db7ad7918d6a26d6cf37d7646348359297deac2ec1455750efd`. The [initial publication manifest](../evidence/final-publication-manifest.json)
remains historical evidence for the initial 188-file publication; the
[corrective publication receipt](../evidence/final-publication-correction.json)
records the two corrected hashes separately.

## Hosted failure found and corrected

The first hosted full-root TypeScript build exposed four diagnostics in two
files introduced by this pass. Earlier production and selected dependency-group
type checks had not covered every entry included by the root `tsconfig.json`.
These were **task-introduced build defects**, not unrelated baseline failures.
The [committed first-run log](https://github.com/cheshmakzanoon-ops/Experiment-3/blob/e3cf1324c92b3957eaf6e6bd283055b55d7955b7/ci-reports/logs/scenery-shadow-budget/browser-day.log)
records the exact diagnostics and exit code 2.

| File | First failure | Minimal correction |
| --- | --- | --- |
| `scripts/bench/motocross-rider-acceleration.ts` | TS7034/TS7005: inferred `any[]` trace | Explicitly type the six numeric trace fields |
| `tests/motocross-planar-transport.test.ts` | TS2345: observer mock returns `void` instead of `BikeState` | Return the original method result after sampling coordinates |

The benchmark emits byte-identical JavaScript after type erasure. The test keeps
its assertions, tolerances and original method call count. Assignment 58 reran
all **16 affected test cases**, the full acceleration benchmark (36 reversal
traces and six flight traces), strict types for the two files and their imported
dependencies, and focused lint; these checks passed. The
[correction receipt](../evidence/58-root-types-correction.json) records the exact
hashes and commands. Assignment 59 independently reviewed the delta.

The original **155-file / 1,736-test** sweep predates this test-wrapper correction.
Only that test file changes among its recorded inputs, and its 16 cases were
rerun successfully. The 16 are part of the original test count, not additional
unique tests. Runtime fingerprint inputs and test assertions remain unchanged.

Two local attempts at full-root TypeScript ended with SIGKILL (`-9`, shell 137).
They establish no full-root pass. The corrected hosted result below closes that
gate without changing compiler settings or excluding repository paths.

## Corrective hosted validation

[Build and validation run 45730817858](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45730817858)
uses the actual corrective source commit. Its
[`validate` job](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45730817858/job/139612194664)
completed **successfully at 2026-11-26T00:47:55Z**. Successful steps include:

- Full repository lint, content validation, `tsc --noEmit` and production Vite build.
- Production IP guard.
- Steam demo build and its IP guard.
- Build artifact upload.
- Exact committed-source preservation.

The unchanged workflow executes `npm run lint && npm run validate:content && npm run build`
under the source-stability guard; `build` expands to `tsc --noEmit && vite build`.
The root TypeScript project includes `src`, `tests`, `e2e`, `scripts` and root
`*.ts` files. Thus this success covers the full-root scope that the earlier
local selected-project checks had missed.

| Corrective workflow / job | Observed result at 2026-11-26T00:48:24.913Z |
| --- | --- |
| Build and validation / `validate` | **Success**; full-root gate and packaging complete |
| [Benchmark smoke](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45730817869) | **Success**, completed 00:48:21 UTC |
| [Motocross committed-source review](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45730817850) / `native-assets` | **Success**, completed 00:45:47 UTC |
| Motocross review / `prepare` | In progress |
| Remaining Build and validation unit, race, browser and owner-QA jobs | Running or queued; no completion claim |
| Publish validated playable release / deploy workflow observations | Skipped; no deployed-release claim |

The workflow collection's aggregate Build and validation status is `queued`
at this snapshot while its returned jobs include active work. The detailed
job receipt is authoritative for the completed `validate` result; it is not
promoted into a global workflow-success claim. The benchmark permits software
rendering and is not hardware GPU/FPS evidence. Local browser execution remains
unverified because the executor rejected Chromium socket creation before a page
could be created.

## Handoff

Assignment 60 is complete for the actual engine and corrective publications.
Root owns the final documentation-only receipt commit, its fresh lease, and the
last remote-main lookup. A report cannot prestate the SHA of the commit that
will contain it. This assignment made no Git mutations, runtime/test/asset
edits, broad reruns, browser launches or remote writes.
