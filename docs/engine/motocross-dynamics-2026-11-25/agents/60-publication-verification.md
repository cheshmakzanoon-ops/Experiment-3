# Assignment 60 — independent verification of the published engine code

## Result and publication boundary

**The engine code was actually published to `main` as [39d9d497880e92801a7d77de6af2639b4186bfcc](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/39d9d497880e92801a7d77de6af2639b4186bfcc), and its immutable tree is exactly the accepted code tree.** Independent GitHub reads first observed that commit at the branch tip. A later read observed a direct CI-report successor; its only changed root subtree is `ci-reports`, so the published engine, tests, scripts, configurations and authored assets remain identical.

This is assignment **60 of 60**. It verifies code publication and source equality. The coordinator will subsequently publish the documentation containing this report. **This report does not claim to verify that future documentation commit or its final branch update.** The coordinator must perform that final comparison after the documentation commit exists.

Final native-browser acceptance **failed**. Publication does not convert that result into a pass or constitute deployment/release certification. The remaining physical-model and scoped inherited-CI limitations remain in [LIMITATIONS.md](../LIMITATIONS.md).

Evidence: [60-publication-verification.json](../evidence/60-publication-verification.json). Reusable local content verifier: [60-verify-publication.py](../evidence/60-verify-publication.py).

## Independent remote observations

Six read-only GitHub requests retrieved the branch, code commit, code root tree, a second branch observation, the subsequent CI commit and its root tree. The API responses were inspected directly rather than inferred from the coordinator's update receipt or a locally created object.

| Observation | Result |
| --- | --- |
| Initial `refs/heads/main` read, 2026-11-25 20:45:21 UTC | `39d9d497880e92801a7d77de6af2639b4186bfcc` |
| Published code commit's sole parent | `f3b39eb8e1b02fc0677086819fc384b6ceacefc2` |
| Published code tree | `b7f379a7aaea0f807b5623b2c981190c6d1a3a17` |
| Code tree API response | 31 root entries, `truncated: false` |
| Subsequent main read, 2026-11-25 20:49:53 UTC | `6dc4c70515bfde48b27e2794bd97cdf1e1bd681d` |
| Subsequent commit's sole parent | The published code commit `39d9d497…` |
| Subsequent commit message | `CI report: ci-reports/benchmark-smoke.md [skip ci]` |
| Subsequent tree | `9fc26764430e29c7e0283be435b117682dd77fdf` |
| Root-tree difference from code commit | Only `ci-reports`; all other path/mode/type/object-ID entries are identical |

The subsequent tree changed the `ci-reports` object from `87ba7cab36a5581f3aa9c290ddbfd3586623a926` to `6c16cd21d53ee90e61016bbbe3aaa7d3c137e04b`. Its unchanged root entries include `src`, `tests`, `scripts`, `e2e`, `public`, `assets`, `authoring`, `reference`, `docs`, package/configuration files and every other root entry. This comparison establishes the subtree boundary directly; it does not rely on the CI commit message to infer its scope or assert an uninspected individual-file diff.

The coordinator was notified immediately of the new head so it could preserve this CI child as the documentation commit's ancestor. The coordinator's recorded code publication used the expected previous SHA `f3b39e…` with `force: false`. Independently, the observed commit graph preserves that exact previous head as the code commit's sole parent, and the CI update preserves the code commit. No replacement of the known parent history is present in this chain.

The nonrecursive 31-entry remote tree is not presented as a recursive file inventory. Its exact tree identity was separately resolved locally and compared with the complete 10,467-entry code tree and index.

## Immutable content and current-file verification

The read-only verifier enumerated the fetched code commit, checked its parent, and confirmed that original task baseline `b527a7e01ea247f0233a2ec4f2850639bafbd887` is an ancestor of the retained parent. It compared changed paths with the acceptance inventory and streamed actual Git blobs through `git cat-file --batch` to hash their contents.

| Independent check | Observed result |
| --- | --- |
| Complete code tree | **10,467 entries**, exactly tree `b7f379a7…` |
| Change set from retained parent | **59 paths / 934,755 bytes**, exactly the published inventory |
| Runtime / tests / benchmark paths | **18 / 37 / 4**, as inventoried and reviewed by [A59](59-publication-preflight.md) |
| Source files | **1,126**, all included in the recomputed accepted source digest |
| Vite fingerprint inputs | **1,129**: every source file plus `package-lock.json`, `index.html` and `vite.config.ts` |
| Protected files | **1,772 / 264,155,763 bytes**, baseline modes, Git blob IDs and SHA-256 contents all equal |
| Distinct Git paths rehashed | **1,834**, covering source, changed files, protected content and fingerprint configuration |
| Current files compared with those Git blobs | **1,834**, all bytes and executable modes equal |
| Complete local index at this check | Exactly the 10,467-entry published code tree |
| Local HEAD at this check | The published code commit `39d9d497…` |

The index comparison occurred before the coordinator followed the CI successor or staged the final documentation. A later CI/documentation index legitimately differs from the original code tree; that does not change the identity of the immutable code commit verified here.

The source digest, using sorted `path + NUL + file SHA-256 + newline` records, is:

`5fea93841ed0da6949fe1dc2858c57f38b53595279222ab1550f74bfb6131096`

It matches the final A49 source identity. Vite's separate raw-content fingerprint, recomputed from the published Git blobs with its actual input order and separators, is:

`d32aa557b2619b63883312be75df7735fb8ede13b801bf5315e642b2664c88bf`

It matches the retained final product build. The 59 changed-path hashes match the [A53 publication inventory](../evidence/53-build-provenance.json). The protected rows independently match both the original baseline and the published code, using the paths and reference hashes recorded by [A51](../evidence/51-protected-scope.json). Exact complete-tree equality also ties all unchanged paths to the accepted candidate; verifying only the changed files would be a weaker identity check.

## Build identity and acceptance remain distinct

All **266 retained build files / 135,946,574 bytes** were rehashed, and the exact file set and SHA-256 values still equal the original dist manifest. Its identity is unchanged:

```json
{
  "version": 1,
  "commit": null,
  "fingerprint": "d32aa557b2619b63883312be75df7735fb8ede13b801bf5315e642b2664c88bf",
  "variant": "product",
  "edition": "full"
}
```

This artifact was built from the working tree before publication. The accurate claim is that its source was subsequently published unchanged in the verified code commit. It is not a postcommit release artifact, and this audit did not rebuild or edit its identity. [BUILD_PROVENANCE.md](../BUILD_PROVENANCE.md) describes the narrower fingerprint coverage and normal release-artifact requirements.

The final unit, race, calibration, cadence, type/lint and build results remain owned by their execution reports. This assignment ran no test suite, simulation, build or browser journey and does not count their cases as new executions. Their linkage to the exact published source is the purpose of this audit. [A49](49-final-units.md) · [A52](52-final-races.md) · [A54](54-final-cadence.md) · [A59](59-publication-preflight.md)

The completed [A50 evidence](../evidence/50-final-native.json) records failed native acceptance. The earlier final-build invocation crashed after ten gameplay captures. The authorized isolated diagnostic then exited **1** after its unchanged **1,200,000 ms** test limit, with `locator.click: Target crashed` during `APPLY & SAVE`. Low was selected in the form but was not successfully applied; no venue or gameplay capture was reached in that diagnostic. It recorded two GPU-process exits with code 9. The cause remains unproven. All 1,734 captured inputs and 266 build files stayed unchanged, and the browser, preview, observer and wrapper processes ended. Source equality does not remove that failure or establish hardware-GPU performance.

The separately documented four inherited failures in A42's scoped 52-case comparison also remain visible. Neither source publication nor this content audit establishes globally green repository CI. A CI-report successor is evidence of a later commit, not itself a claim that every workflow passed.

## Reproduce the immutable content check

From the repository root, with the referenced Git objects and this documentation present locally, run:

```sh
python docs/engine/motocross-dynamics-2026-11-25/evidence/60-verify-publication.py \
  --verify-worktree
```

The script derives the repository root from its location. It reads the fixed published code commit and sibling manifests, writes only its JSON result to standard output, and performs no network access, fetch, checkout, stage, reset or ref update. `--verify-worktree` also compares the 1,834 current files with the code blobs; omit it when intentionally inspecting a later changed source checkout. The immutable code-commit checks still run.

This assignment additionally used `--check-code-index` while the index still represented the original code commit. Omit that flag after a later CI or documentation commit. The script does not claim to inspect a live remote branch; the independent GitHub observations above supply that evidence for their stated times.

## Remaining coordinator action

Publish the final documentation, including the completed sixty-agent ledger and this report, on top of the then-current `main` without discarding CI updates. After that commit exists, verify its actual remote ancestry and diff, preserving the accepted source and the failed native status. That final publication proof belongs to the coordinator and cannot be supplied by a report inside the not-yet-created commit itself.

This assignment authored only this report, its compact evidence JSON and the read-only verifier. It changed no production source, tests, models, environments, specifications, index or refs and left no validation process running.
