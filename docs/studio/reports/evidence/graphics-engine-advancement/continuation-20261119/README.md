# Continuation evidence checkpoint — 2026-11-19

**Captured 2026-11-19T13:52:56.924894+00:00 (UTC). Commit 4c9b858 is REJECTED.** Its original 51 gate and complete unfiltered unit run fail the zero-fall requirements for Vellamar 5222 and Montejaral 5111. Passing native, matrix, calibration and build checks do not override those failures. The minimal cache-only source is also REJECTED: its completed original 51 gate finishes 48/51, with Ardennes 1000 plus dry Aurel and Poggio contact failures, actual exit 1 and stable source. No accepted physics or changed-test High GPU result is claimed.

Read the [dated checkpoint report](../../../continuation-checkpoint-2026-11-19.md) for the findings and limitations.

| Archive | Contents |
| --- | --- |
| [Engine evidence](continuation-engine-evidence/README.md) | Original gates, matrix, calibration, immutable controls, world-motion proofs and exact source linkage |
| [Native evidence](continuation-native-evidence/README.md) | Independent horizon, selected-path, lifecycle, wet and snapshot proofs, with failed race compositions retained |
| [Admission supplement](continuation-native-supplement/README.md) | Explicitly rejected 2/3 selected-control result |
| [Current-history parity](current-history-parity-evidence/README.md) | Fresh 5760 paired comparisons on 8aaa/2a3 against recorded remote source; GP road control excluded |
| [Minimal cache review](gp-history-relative-independent-review/README.md) | Actual native negative controls and comment-only source attribution |
| [Full unit receipt](final-full-unit/full-unit-status.json) | Completed unfiltered `npm test` on 4c9: 702/703 files and 6860/6862 tests pass; exit 1; raw log and full input manifest included |
| [Build receipt](final-build-evidence-4c9b858/receipt.json) | Exact 4c9 lint, content, build, bundle and IP exits and build identity |
| [Completed cache-only gate](minimal-cache-51-complete/original51.json) | 48 pass, 3 fail; actual exit 1 and source stable; full log and source manifest included |
| [Earlier cache-only progress snapshot](minimal-cache-51-checkpoint/snapshot-receipt.json) | Historical partial record, superseded by the completed result above |
| [Pace causal review](gp-pace-causal-review/causal-review.md) | Diagnostic-only review and compact summaries; no large raw trajectories or implemented reachability policy |
| [Rejected-source patch (gzip)](reproduction/5fb2-to-4c9-rejected.patch.gz) and [verification](reproduction/receipt.json) | Exact full-index, binary-capable diff; temporary-index application reproduces the 4c9 target tree |

The [packaging verification receipt](packaging-verification.json) records actual copy, hash, link, whitespace, scoped-lint and exact-patch checks.

## Integrity and exclusions

`copy-provenance.json` maps each losslessly copied artifact to its original path and payload SHA-256. Historical logs, patches and two probes that trigger text/style checks are stored as deterministic gzip with zero timestamps; no payload byte is normalized or edited. `compression-map.json` records both original payload and compressed hashes and filenames. Historical absolute paths inside receipts are retained; the links above locate their copies here. `file-manifest.json` records every archived payload's bytes and SHA-256, and `SHA256SUMS` covers the manifest and all stored evidence files except itself. The package-local historical checksum files refer to original payload names; restore the archive to a fresh external directory before using those older package checksums. The external source packages remain unchanged.

The build helper file `private-excludes` is intentionally omitted. Its historical path remains mentioned in the original byte-identical build receipt; it is not acceptance evidence. The pace review references preserved large trajectories and additional analysis outside this compact archive; those data were not copied. Startup and High evidence already committed elsewhere was not duplicated.

No application source, test, browser script, package or configuration change belongs to this checkpoint. Archived `.ts` and `.mjs` files are historical reproduction artifacts under documentation, not production changes. No race, suite, build, browser or publication was rerun to create this archive. Remaining runnable archival JavaScript/TypeScript is checked with scoped ESLint; the two historical probes with unused bindings are retained byte-for-byte inside gzip instead of changing their source or lint configuration. Patch verification used only a temporary Git index, then removed it.

```sh
sha256sum -c SHA256SUMS
python restore-evidence.py /absolute/new-external-directory
```

The restoration helper refuses an existing destination and a destination inside this Git checkout. It copies the stored archive, verifies every compressed and payload hash, and restores original filenames only in the external copy. It runs no archived probe or test. The restored reproduction patch is `reproduction/5fb2-to-4c9-rejected.patch`; its uncompressed hash and exact target-tree proof remain in the reproduction receipt.

The original draft is retained as `checkpoint-draft-source.md`. The dated report adds relative evidence links, explicit dispositions, and the latest observed cache-only failures. The cache-only completion was added at 2026-11-19T13:55:09.786965+00:00; its earlier partial snapshot remains historical evidence. Neither source is accepted.
