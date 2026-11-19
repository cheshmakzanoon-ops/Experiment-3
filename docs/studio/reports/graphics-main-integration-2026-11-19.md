# Prospective graphics integration — 19 November 2026

**Status: local composition verified; graphics acceptance blocked.** This worktree
contains the reviewed graphics preparation changes on the current main-line
source, with its CI partitioning and browser fixture repairs preserved. It has
not been published. Before the documentation freeze, the parent agent reported
that isolated hosted run [44623276067](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44623276067)
passed its build, gameplay, and component-GPU jobs but failed the original High
journey; the menu job was still running. The High artifact was being collected.
This report makes no inference about that failure's cause.

## Exact composition

| Role | Commit |
| --- | --- |
| Main-line base, including the accepted CI and fixture repairs | `0e8d6e3a07f2fd2e39afb7d973fa54d86d7809bf` |
| Reviewed graphics source | `62f18b868163a9c86857ac3222414484b92bffc9` |
| Locally built and tested integration | `023be1cab35df4ea2af9b4ff80bbeaa4dee8a4e3` |
| Tested integration tree | `3938e0f55f8fe9ee802d45b86635bc7263a73b79` |

The graphics delta was selected from the shared ancestor
`d8d87c73a8f3e921e865acdc02c61e84b8c877a7` through the reviewed source. The ordered
changes are:

| Commit | Included change |
| --- | --- |
| `d784d94` | Bounded High diagnostic capture and its evidence; isolated workflow excluded |
| `872fa9d` | Recorded and fullscreen shader owners |
| `c5cb136` | Retained native PMREM background program |
| `062e0da` | Sky preparation from the actual paused session snapshot |
| `4bfdf81` | Retained exposure-meter preparation |
| `41c5759` | Active native fullscreen chain preparation |
| `4b9d6bb` | Retained static texture-owner preparation |
| `62f18b8` | Final scene texture policy before the far-shadow bake |

The resulting source commit contains 20 application/test paths and 65 historical
report/evidence paths. Each selected file is byte-identical to `62f18b8`.
The isolated `graphics-high-diagnostic.yml` workflow and its workflow-specific
report are excluded. No rejected physics changes are included.

The complete `src`, `public`, and `scripts` trees, package manifests, TypeScript
configuration, and Vite/Vitest/Playwright configurations are identical to the
reviewed graphics source. The main-line CI workflow and its tests retain the
four unit partitions, sixteen ordinary browser partitions, and four owner
partitions. The reference-depth, APX01 assembly, and GP contact-effects fixture
repairs remain byte-identical to the main-line base. The exact path selections,
Git object identities, and protected-file hashes are retained in the evidence.

The final texture-policy change runs registration at construction priority 8,
after queued material/foliage work and before the priority-9 far-shadow bake.
Far, near, and colour consumers therefore use the final texture owners and
samplers. This intentionally corrects the old far-shadow policy mismatch;
historical far-shadow pixel identity is not claimed.

## Checks on the composed source

All commands ran against clean source commit `023be1ca` under the existing
source-stability guard. No source was changed during a check.

| Check | Result |
| --- | --- |
| Focused cross-integration tests | **154/154 passed, 8 files**, Vitest duration 21.68 seconds, exit 0 |
| Product build | TypeScript `--noEmit` and Vite passed; 916 modules transformed; exit 0 |
| Initial JavaScript bundle gate | **3.57 MiB gzip / unchanged 4 MiB limit**, exit 0 |
| Product IP guard | Clean across 75 shipped text/GLB inputs; 90 existing internal-identifier mentions tolerated; exit 0 |
| Composition and protected inputs | All selected files equal the reviewed graphics source; main workflow, fixtures, scripts, and package files preserved |

The focused tests cover release-source identity, branchless release, CI
partitioning, browser shard planning, startup, session-sky preparation, retained
native scene textures, and static-scene texture ordering. Their exact command
and logs are included in the receipt. This selection checks the interaction
between the graphics changes and the accepted main-line repairs.

The product build records:

```json
{
  "commit": "023be1cab35df4ea2af9b4ff80bbeaa4dee8a4e3",
  "fingerprint": "9654582fc293da474310e3a5a19db6be2fadc6c0e780b7b1348d9fc6c019837c",
  "variant": "product",
  "edition": "full"
}
```

Vite emitted its ordinary warning for chunks larger than 500 kB; the separate
initial gzip budget passed without changing either threshold. Source-only
whitespace validation passed. Five trailing blank-line warnings belong to
verbatim historical evidence logs, which were preserved to retain their hashes.

## Evidence and acceptance boundary

The local receipt and checks are in
[`evidence/graphics-main-integration-20261119/`](evidence/graphics-main-integration-20261119/receipt.json).
They include the composition manifest, complete production-input parity,
protected-source verification, build identity, test/build logs, bundle report,
and explicit bundle/IP command exits.

Earlier native graphics evidence remains attached to its original source and
scope. It was reused where those inputs are unchanged; it is not represented as
having been rerun for this integration. In particular, the texture-order
positive and mutation-negative checks use deterministic native-module fixtures,
not measurements of the full High scene or browser-rendered pixel equivalence.

No full unit suite or new browser run was started for this local composition.
The original High test, readiness deadline, quality settings, and completed-GPU
requirements remain unchanged from the reviewed candidate. The hosted High
failure must be diagnosed before this prospective integration is accepted or
published. The documentation-only receipt commit does not change the tested
application inputs.
