# Assignment 53 — build and publication provenance

## Result

**The actual staged code tree is byte-equivalent to the source accepted by the final build, selected unit run and final type/lint gates.** I independently checked tree `b7f379a7aaea0f807b5623b2c981190c6d1a3a17`, its 10,467 entries, its exact equality to the observed index, and its 59-path difference from parent `f3b39eb8e1b02fc0677086819fc384b6ceacefc2`. Recomputing the Vite fingerprint from the candidate's streamed Git blobs produces exactly `d32aa557b2619b63883312be75df7735fb8ede13b801bf5315e642b2664c88bf`.

The complete explanation, hash definitions, acceptance qualifications and read-only postcommit recipe are in [BUILD_PROVENANCE.md](../BUILD_PROVENANCE.md). The machine-readable audit is [53-build-provenance.json](../evidence/53-build-provenance.json). The audit observation was 2026-11-25 20:16:58 UTC; no task source commit existed at that time.

## Independent checks

| Check | Result |
| --- | --- |
| A50 captured build/native inputs | 1,734 of 1,734 current hashes and candidate Git blobs match; exact path set; build and completed journey before/after equal |
| Retained build output | 266 of 266 files / 135,946,574 bytes match the original and after-journey manifests |
| Vite identity | Product/full, `commit: null`; all 1,129 fingerprint inputs independently read from candidate Git objects |
| A49 final units | 165 distinct files / 1,836 passed cases; exit zero; all 2,710 captured inputs unchanged and currently equal |
| A49 tracked candidate inputs | 2,708 matching blobs; two explicitly captured installed Three shader files remain outside Git |
| Final root type/lint inputs | 2,835 current files match; 2,834 candidate blobs match; generated `browser-backend.json` is outside Git |
| Root-gate reconciliation | Exactly one intervening test edit; final full TypeScript and focused lint cover it; earlier full lint covers all unchanged files |
| Protected source/model/environment inventory | 1,772 files match current bytes, modes and sizes; candidate modes/blob IDs equal baseline; 18 allowed runtime hashes equal A51 |
| Publication inventory | 59 paths / 934,755 bytes; exact changed set, current SHA-256 values, staged modes and blob IDs match |
| Source digest reconciliation | A50 and A49 contain exactly the same 1,126 source hashes; different aggregates arise solely from path-component versus full-string ordering |

No unexpected input mismatch was found. The only mismatch against the **earlier** full-gate manifest is the expected strengthened `motocross-riding.test.ts` oracle, whose final SHA-256 is `f1d51d886210baadd8a85dd5b3828178b4954efca4a85b9108a91080c980f468`. That file matches the final type/focused-lint gate, A49's completed run and the candidate tree.

## Coverage distinctions found in the implementation

The actual Vite fingerprint covers `src/`, the lockfile, entry HTML and Vite config. A50's broader manifest is necessary to identify public assets, browser inputs and the lazy-data build plugin. The IP guard's imported `scripts/ip-denylist.mjs` is absent from A50's explicit four support scripts; root/A49 manifests and A51 protect its unchanged bytes. I flagged this to the coordinator so the input manifest is not described as hermetic. The installed dependency tree and operating environment are also not exhaustively content-addressed.

The existing release-artifact verifier requires an actual matching `identity.commit`. The build honestly contains `commit: null`, because task source changes were uncommitted when Vite ran. The retained artifact must not be relabeled after publication. Exact published-tree equality can prove that a future commit contains the source that passed these gates; it cannot move the execution time of those gates or manufacture a postcommit release build.

The coordinator's six recorded GitHub tree batches end at the same candidate tree and record no branch update. I checked their local receipt chain and path set; I did not query or mutate a remote branch. The actual published commit and ref still require root/A60 verification.

## Pending acceptance and limits

Final native-browser acceptance remains **pending after a completed real target-crash failure**. Ten checked images were preserved, Valley completed, and Arena cockpit/pause/paddock completion was not reached. The crash cause is undetermined. The authorized isolated diagnostic had not started in the audited evidence. A37's earlier green browser journey uses four earlier runtime versions and cannot stand in for final acceptance.

A52's grid receipt arrived after the original audit snapshot: it records eight of eight races passed, exit zero at 20:18:33 UTC, and all 1,131 inputs unchanged. I inspected and retained that receipt in the evidence's later-observation section. Its later calibration receipt also records exit zero and unchanged inputs; that receipt is retained as a separate later observation. Final native acceptance and actual publication verification remain outstanding. A49's green 1,836 cases establish the selected suite; they do not erase the four separately reproduced baseline CI failures. No physical-GPU performance, fully reproducible cross-machine build, or independently measured motorcycle/biomechanical calibration is claimed here.

## Ownership returned

I authored only this report, `BUILD_PROVENANCE.md` and the small evidence JSON. The temporary audit helper resides outside the repository. I performed read-only file/Git inspection and hashing; I did not rerun build, unit, lint, typecheck or benchmarks, alter production/test/model/environment inputs, modify the index or refs, or spawn another agent. Root alone stages documentation, creates commits and publishes. This assignment is complete and its active slot is released.
