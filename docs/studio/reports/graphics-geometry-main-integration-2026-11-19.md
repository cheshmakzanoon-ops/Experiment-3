# Prospective geometry integration — 19 November 2026

**Status: composed source verified locally; hosted High acceptance failed.**
This is a local continuation of the verified prospective main integration. It
adds the frozen retained-geometry change and its original evidence while
preserving the accepted main CI partitioning and browser fixture repairs. No
remote publication or acceptance is claimed.

## Exact composition

| Role | Commit |
| --- | --- |
| Previous verified integration and receipt | `bd3f98655c96f4bad0be202c4cb568567b84b305` |
| Frozen geometry source | `619ffceb23ed4351ddfcdf6a3fc232d15e5b5e12` |
| Original geometry report and evidence | `eb691e3c8abccc6cd7a0cee10aedfc207540fddd` |
| Local source cherry-pick | `f95c84e92e97a86620a2de5e0b24185620d6bbf9` |
| Composed source built and tested here | `c428219c1e80c1404b169e85d8fcdca931147c99` |
| Tested integration tree | `a6914907eb7dd653856c233c1428a30926e04f3e` |

The new branch is `studio/graphics-geometry-main-integration-20261119`. The
existing `studio/graphics-main-integration-20261119` branch still points at
`bd3f986`; the frozen geometry source branch still points at `619ffce`.

Only the following six source/test files and eleven original report/evidence
files were added or changed on top of `bd3f986`. Each source/test file equals
`619ffce` byte for byte; each historical report/evidence file equals `eb691e3`.

```text
src/rendering/geometry-preparation.ts
src/rendering/reflections.ts
tests/geometry-preparation.test.ts
tests/helpers/native-geometry-proof.d.mts
tests/helpers/native-geometry-proof.mjs
tests/helpers/native-renderer-harness.mjs
```

The entire application `src`, `public`, and `scripts` trees, both package
manifests, and the TypeScript/Vite/Vitest/Playwright configurations remain
identical to the frozen graphics source. The main CI workflow retains its four
unit partitions, sixteen ordinary browser partitions, and four owner
partitions. The reference-depth, APX01 assembly, and GP contact-effects fixture
repairs and CI partition tests are unchanged from the previous main
integration. The isolated graphics workflow and rejected physics experiments
are absent. The composition manifest retains the exact Git object identities,
path selection, and protected input hashes.

## Resulting graphics behavior

The first actual reflection capture prepares eligible retained static geometry
after hiding its existing exclusions and positioning its real cube camera. The
native renderer registers the original vertex/index owners through zero-count
draws before the first real cube face renders. Selection follows the visible
branches, six native face frustums, layer masks, and existing matrix ownership.
Ordinary refreshes do not repeat preparation after the first completed capture.

Original geometry disposal continues to own the uploaded buffers. Draw ranges,
materials, transforms, callbacks, and canvas state are restored. Non-null target
entry skips preparation and follows the original capture path. Instance
attributes and the excluded dynamic, morph, skinned, batched, external-buffer,
and automatic-LOD cases retain their native ownership and first-use behavior.
The separate [geometry report](retained-geometry-preparation-2026-11-19.md)
describes the selection and lifecycle proof in full.

This composition preserves the earlier final texture registration before the
far-shadow bake. Its intentional far/near texture-policy consistency change is
retained; historical far-shadow pixel identity is not claimed.

## Checks on this exact composition

Each command ran against clean committed source `c428219` through the existing
source-stability guard. The worktree was still clean after all commands, and
the source, frozen branch pointers, historical evidence, and protected inputs
were checked again before this documentation-only receipt was written.

| Check | Observed result |
| --- | --- |
| Focused cross-integration suite | **169/169 passed, 9 files**; Vitest duration 31.01 seconds; command exit 0 |
| Native geometry cases within that suite | **15/15 passed**, with parsed native evidence retained from this run |
| Product build | TypeScript `--noEmit` and Vite passed; 917 modules transformed; command exit 0 |
| Initial JavaScript bundle gate | **3.57 MiB gzip / unchanged 4 MiB limit**; command exit 0 |
| Product IP guard | Clean across 75 shipped text/GLB inputs; 90 existing internal identifier mentions tolerated; command exit 0 |
| Composition and protected inputs | Exact source and evidence parity; main workflow, fixtures, scripts, and package files preserved |

The nine test files cover release source identity, branchless release, CI
partitioning, browser shard planning, startup, session-sky preparation, retained
scene textures, final static texture ordering, and retained geometry. The
fifteen geometry cases execute the complete installed renderer and caches
against a recorded GL endpoint. They verify native owners, ordering,
cancellation, disposal, selection, and state restoration; they do not execute
a driver, measure pixels, or establish completed-GPU performance.

The product build records:

```json
{
  "commit": "c428219c1e80c1404b169e85d8fcdca931147c99",
  "fingerprint": "dc42ee366d537c598fd71cd142dbb7c9f57390ef8a44629dcae3cff3765c431f",
  "variant": "product",
  "edition": "full"
}
```

Vite emitted its existing warning for chunks larger than 500 kB. The separate
initial gzip gate passed without changing its threshold. The exact commands,
exits, timestamps, complete logs, build identity, bundle report, native results,
and post-validation parity checks are in the
[local receipt](evidence/graphics-geometry-main-integration-20261119/receipt.json).

## Hosted failure and next decision

The parent completed its log review of exact geometry source
`b8f1445cb07d57b35ac1c5dd45e54b01d6aaec92`, whose tree equals `619ffce`, in
[isolated run 44630631215](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44630631215).
Build, gameplay, component-GPU, and menu jobs passed. The High job
`135935986093` failed at the original
`e2e/graphics-high-journey.spec.ts:786` readiness assertion: it still read
`loading` instead of `paused` after 90,000 ms. Later GP, driving, and photo
assertions were not reached. The checkpoint agent verified artifact
`14582960224`, SHA-256
`5e7165c6f199fbf384e9442297b4b0a316d5b013bec2a8063d563f4dd791eb54`.
The extracted source-specific timeline was read before this receipt was frozen.

The trace starts shadow/reflection warming 35,634.467 ms into the readiness
window. That stage completes in 42,187.1 ms, and offscreen pit-service warming
begins at 77,821.567 ms. At the last retained diagnostic, the pit-service stage
has run for 12,110.7 ms and the application remains `loading`. The GPU frame
queue reports two submitted fences, zero completed fences, 703 deferred
callbacks, eleven flush refreshes, and 11,733.1 ms pending, with no recorded
failure. The bounded source-specific boundary is retained in the local
evidence. These numbers establish that this source progressed beyond chase
warming; they do not isolate the geometry change's timing contribution.

The native ordering proof and successful local composition do not resolve that
hosted failure. The trace does not yet establish which retained work keeps the
fence pending. The next task is to inspect actual pit-service material and
environment preparation, distinguish preparation work from later draw/driver
work, and establish a concrete cause before any further source change. Required
pit-service work and completed-GPU readiness remain part of that investigation.

The earlier reports remain verbatim historical receipts with their original
timestamps and acceptance status. Unchanged evidence was reused at its stated
scope; the earlier full rendering test selection and mutation-negative control
were not rerun here. No full unit suite or local browser was started for this
composition. The original High test, readiness deadline, quality settings, and
completed-GPU requirements are unchanged. The prospective integration remains
frozen and unaccepted.
