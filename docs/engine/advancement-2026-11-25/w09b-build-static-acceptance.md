# W09B — compiler, build and static acceptance

Assignment **50/60**, wave 9. This review owns the focused workflow's minimal
coverage repair and this acceptance report. The source review uses original
baseline `350119e8ec0606e8c5de5b3ab80df41104025679` and the current checkout at
`714632a3db99c0016437d789bb9417c610c9a267`, with the coordinator's reviewed wave-8
patches awaiting their source freeze. The sections below preserve that review
and its failed and incomplete checks. The coordinator's final acceptance update
at the end records the successful exact-source run for `774e62fa`; it does not
substitute an earlier candidate's result.

## Finding and completed workflow repair

The focused workflow did not trigger for changes confined to `src/ui/`, despite
this programme changing UI lifecycle owners there. The generic Festival host,
`src/session/free-roam.ts`, is already covered by `src/session/**` and needs no
additional trigger. The repair adds `src/ui/**` to the existing push filter.

The coordinator also authorized adding three existing, modified compatibility
suites to both the push filter and the focused command:

- `tests/circuit-startup-settlement.test.ts`
- `tests/festival-ground-height.test.ts`
- `tests/festival-session-lifecycle.test.ts`

The resulting selection is `tests/engine-*.test.ts` plus seven explicitly named
suites, **70 files at this review point**. W09A owns the identical selection
inventory and unit results. This is an intentional expansion from the preceding
65-file checkpoint; test totals across different selections are not presented
as comparable coverage growth.

The shared path manifest is
[`evidence/w09-unit-selection.json`](evidence/w09-unit-selection.json).
An independent reconstruction of its 70 sorted paths produced the same SHA-256,
`87b33765d1d495165dee308d7cfbddbffde31b2b5d76b8aaf446fb98fe489e5b`,
over LF-joined relative paths with a final LF. This identifies the selection,
not frozen file contents or a completed execution.

A read-only path audit found **25 changed production paths** relative to the
original baseline and **zero uncovered paths** after this repair. The workflow
retains its original one-worker, zero-retry, no-`only`, source-stability and
failure-artifact rules. There is no backend, dependency, compiler-option,
assertion, permissions, timeout or publishing change.

## What the static gates cover

| Gate                     | Actual scope                                                                                           | Limit                                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `tsc --noEmit`           | Strict project checking of `src`, `tests`, `e2e`, TypeScript scripts and root TypeScript configuration | `skipLibCheck` remains enabled; this does not typecheck dependency declaration implementations or the `.mjs` benchmark scripts |
| Vite production build    | Actual application/worker bundles, lazy datasets, build identity and the existing product output guard | A successful bundle is not a runtime, performance or physical-hardware result                                                  |
| Scoped ESLint            | Modified TypeScript and JavaScript code using the repository's unchanged rules                         | Does not replace typechecking, execution or native tests                                                                       |
| Scoped formatting check  | Selected changed code and the workflow/report                                                          | Existing formatting debt must remain separately identified; no broad reformat is authorized                                    |
| Source stability wrapper | Input-tree snapshots before and after the command, with changes causing failure                        | It contains explicit exclusions, described below, so it is not by itself a complete protected-content audit                    |

`tsconfig.json` includes every changed TypeScript production and test location.
Its existing strictness, module resolution and no-emit settings are unchanged.
The `.mjs` measurement and proof tools remain JavaScript: their lint,
actual-module execution, source manifests and exact-output evidence are the
appropriate separate records. A full TypeScript success must not be described
as having typechecked those JavaScript tools.

### Direct compiler and build command

The focused workflow runs the installed compiler and Vite executables directly:

```sh
node --experimental-transform-types scripts/source-stability.ts -- bash -c \
  'node node_modules/typescript/bin/tsc --noEmit && node node_modules/vite/bin/vite.js build'
```

The surrounding step uses `set -euo pipefail` while preserving its log with
`tee`. Thus the build cannot begin after a failed compiler, and a failing build
or source-stability check cannot be hidden by the logging pipeline. Full
compiler/build acceptance belongs to the frozen GitHub source and artifact;
the local environment's limited memory is not a reason to replace it with a
transpile-only claim.

The workflow's unit command likewise invokes Vitest directly, and its browser
command invokes the Playwright CLI directly. This avoids this package's
`pretest`, `prebuild` and `predev` hooks, which generate player assets. No such
hook was run by this assignment. The current root package has no install or
prepare lifecycle hook; locked dependencies include installation hooks for
esbuild and optional fsevents packages. The workflow's existing `npm ci`
command is unchanged.

### Source and build identity

The workflow records the exact commit, Git tree and package-lock SHA-256 before
installation. `scripts/source-stability.ts` hashes files in `src`, `public`,
`scripts`, `tests`, `e2e`, `docs` and `.github`, together with root files, before
and after each guarded command. It records symbolic-link targets and executable
bits and returns failure when protected inputs change or a command terminates.

Two categories are intentionally excluded by the existing wrapper:

- Generated browser receipts: root `browser-backend.json` and
  `browser-progress.json`.
- `public/models/supplied-player-lods.bin.gz`.

The latter is a protected model under this task. The coordinator was explicitly
notified that source-stability success alone does **not** prove it unchanged.
The independent final baseline-blob audit must include that file. No exclusion
was added, removed or treated as permission to regenerate content.

`vite.config.ts` writes `dist/BUILD_IDENTITY.json` with a content fingerprint and
an exact commit only when its relevant source inputs are clean. Its fingerprint
covers the sorted `src` files, dependency lock, entry HTML and Vite configuration.
The build identity also names the product/owner/review variant and full/demo
edition. It does not fingerprint every test or document; the workflow's separate
Git tree is needed to identify the complete checked revision.

The product build's existing output guard runs after bundling. Its success
concerns generated output, not authorization to alter models or proof of game
runtime correctness. This review leaves all build variants and content handling
unchanged.

## Independently inspected prior exact-source evidence

The retained checkpoint at
[`evidence/checkpoint-6cb1c88/`](evidence/checkpoint-6cb1c88/) was inspected directly:

| Identity or result      | Recorded value                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| Workflow                | [45585197376](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45585197376) |
| Commit                  | `6cb1c881d19d190f5dbc68adeb9bf8b6c600da1b`                                                 |
| Tree                    | `a5b8816ef45c35ade9cd5ec6665fbbefd46d5707`                                                 |
| Package-lock SHA-256    | `610c1768c440c202a4e37f62d22467d4cbbddc44a5962e82bb256dcfb8627edf`                         |
| Focused unit result     | 820 passed in 65 files                                                                     |
| Full TypeScript check   | Passed before the production build                                                         |
| Production build        | Passed; Vite 7.1.7 transformed 1,097 modules                                               |
| Build variant / edition | `product` / `full`                                                                         |
| Build fingerprint       | `171dcbb66c8076ed023ed533b9ffc9bd3b203b62e553ecb265bd31de936a9932`                         |

The compiler has no success banner in the combined log. The recorded successful
step and `&&` command sequencing establish that it completed before the logged
Vite build. The build log retains the chunk-size advisory and experimental type
transform warning; neither is silently called an error or removed. No chunk
budget, assertion or warning threshold was changed to secure this result.

That workflow's overall result is **failure**, because 46 of 47 browser/replay
cases passed and the original complete-image shared-GPU witness failed. The
subsequent diagnostic isolates the observed native `vec3` raster path on its
recorded software backend. Static compiler/build success does not reverse that
failure, and this report does not claim all CI is green. W06C and the checkpoint
report preserve the exact native evidence and later test-witness scope.

## Frozen checkpoint and compiler repair

The first expanded exact-source run was
[45590533223](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45590533223),
at commit `26efaeefdf5a39b1d28cec4f8fb6bca1c97bf7e1`, tree
`0067cdfd51fb6b9cdecfa9cc1632f8ec19879b50`. Its expanded unit selection passed
**914 tests in all 70 files**. TypeScript then reported one error:

```text
tests/engine-ui-opening-review.test.ts(63,14): error TS2352
```

The controlled fixture deliberately constructs an `Interface` prototype without
the real constructor, providing only the fields exercised by the actual modal
methods. Its direct object-to-`Interface` assertion did not overlap sufficiently
with the full class type. The compiler specifically identified the missing
constructor fields and requested an explicit `unknown` boundary for an
intentional conversion. Vite **did not execute**, and all native steps were
**skipped**, after this compiler failure. W09C owns the original failed artifact.

With coordinator allocation, the repair changes one assertion:

```ts
}) as unknown as Interface;
```

No production code, fixture runtime operation or assertion changes. TypeScript
emits **byte-identical JavaScript** before and after this repair, with SHA-256
`2333a3f81225e32c369630b7b42fca3b330cfc531a6a5419c4ff9aaf984aaf8d`.
The seven focused modal cases passed with one worker and zero retries. Scoped
ESLint, Prettier and whitespace checks passed.

A targeted semantic check rooted at this test, using unchanged project compiler
options and the actual `Interface` dependency graph, was attempted with a
640 MiB heap. Its process terminated with exit **137** before a diagnostic
summary. It is recorded as **incomplete**, was not repeated, and is not described
as semantic acceptance. The cause of termination was not established by that
result. Full compiler/build acceptance remains the next exact-source CI gate.

## Completed lint and formatting review

After the timing reservation ended, a source-hashed selection of **89 changed
code files** passed ESLint with **zero errors, warnings or fatal errors**. All
89 file hashes remained unchanged during this gate. The retained input manifest,
results, focused repair log and incomplete semantic attempt are in
[`evidence/w09-static-acceptance.json`](evidence/w09-static-acceptance.json).

The initial Prettier audit checked those 89 files plus the workflow and this
report. It found 16 failures: ten files already failed at the original baseline,
five code files were created during this programme, and this report needed
formatting. The distinction matters: the new cross-mode test already failed at
`714632a`, but did not exist at the original baseline, so that is not pre-task
formatting debt.

The coordinator allocated formatting of four task-created tests:

- `tests/engine-cross-mode-startup.test.ts`
- `tests/engine-festival-frame-pacing.test.ts`
- `tests/engine-network-advancement-composition.test.ts`
- `tests/engine-page-lifecycle.test.ts`

Their emitted JavaScript was compared before writing the formatted files.
TypeScript's raw output has different whitespace; after the recorded esbuild
**whitespace-only** normalization, it is byte-identical for each file. No
assertion or runtime expression changed. Per-file original/formatted hashes,
normalized emitted-code hashes and exact compiler/normalizer options are
retained. All four files subsequently passed scoped ESLint, Prettier and
whitespace checks. No redundant runtime test run was added for this cosmetic
change. The report was also formatted.

### Explicit remaining formatting debt

These ten files already fail the same formatter at original baseline `350119e8`:

| Area                            | Files                                                                                                    |
| ------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Host and input                  | `src/main.ts`, `src/input/controller.ts`                                                                 |
| Rendering and generic session   | `src/rendering/renderer.ts`, `src/rendering/open-world/festival-renderer.ts`, `src/session/free-roam.ts` |
| Weather, UI and worker          | `src/simulation/weather.ts`, `src/ui/interface.ts`, `src/workers/physics.worker.ts`                      |
| Existing compatibility fixtures | `tests/festival-ground-height.test.ts`, `tests/festival-session-lifecycle.test.ts`                       |

This establishes file-level pre-existing formatting debt, not a claim that every
current style difference in those files predates the programme. They were not
globally reformatted.

The task-created `scripts/engine-advancement/network-composition-proof.mjs` also
fails formatting. The coordinator explicitly retained its exact recorded bytes
for evidence reproducibility. This is **remaining task-created evidence-script
formatting debt**, not original-baseline debt and not a passed formatting gate.
The overall changed-file formatting check is therefore **not green**, although
the corrected new tests, workflow and report pass their scoped checks.

## Gate pending at source freeze — historical status

The one-line fixture type repair and four cosmetic test changes are released to
the coordinator for a new source freeze. Its full TypeScript/build result,
source/tree/lock receipts and product build identity must still be inspected.
Prior checkpoint success, 914 passing units, syntax checks and identical emitted
code do not substitute for that pending full semantic/build gate.

This assignment changed the workflow, five explicitly allocated test files,
this report and its validation record. No production code, authored model,
character, environment, shader, profile, tuning, dependency, Git state or
publication was changed. No process was started during the earlier reserved
read/edit-only period, and no asset-generation hook was run afterward.

## Coordinator final acceptance update

After this assignment released its files, the coordinator independently inspected
the corrected source's retained job metadata, complete unit/build/browser logs,
source/tree/lock receipts and product build identity. This is a coordinator
update, not an additional execution by agent 50.

The [focused workflow](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45592833399)
for commit `774e62fafdfd9ecd84001a2fcdb3b9f6ee973b86`, tree
`5f466294eca0b188db58375a1caf4cd76088527b`, **passed**:

- **914 unit tests in all 70 selected files**.
- The full project **TypeScript check and production Vite build**. The chained
  step completed successfully; Vite transformed 1,097 modules and completed in
  10.45 seconds. This is build duration, not application performance.
- **47 native browser/replay cases**, with zero failures, skipped cases, flaky
  results or retries.

The build identity is `product` / `full` at the same commit, with fingerprint
`08a29559c6223e8bef3d6c5af2229ea9421e1c6d9d9659e3144cd7c044267529`.
The original artifact is `15012585753`, 1,300,824 bytes, SHA-256
`3ae96693bf5bc12acdbd449592ef36b94bd1d05ffa9a1ce492d24e401cb2598a`.
All 23 files listed by the [retained result manifest](evidence/checkpoint-774e62f/result.json)
were independently rehashed and matched their recorded byte lengths and digests.
The exact build log and successful job step are retained alongside that manifest.

The earlier TS2352 checkpoint and local exit-137 attempt remain failed and
incomplete respectively. This successful full check resolves the pending
semantic/build gate; it does not turn either earlier attempt into a pass.
The scoped lint result and explicit remaining formatting debt above still apply.

Native acceptance remains limited to the recorded Mesa llvmpipe software backend
and each fixture's contracts. MeshBasic and raw `vec3` diagnostics each still
show 64 differing bytes out of 256, with two visible limitation annotations;
the strict `vec4` ownership witness is exact. Physical GPU/controller/audio
hardware and every material path are not certified. Broader repository workflows
also contain failures described in [W09D](w09d-baseline-failure-classification.md).
