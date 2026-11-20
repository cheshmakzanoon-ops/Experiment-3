# Wet-path width correction: hosted paired proof

This compact evidence bundle preserves the final results from [GitHub Actions run 44647781041](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44647781041). The 14 copied paired-run JSON files are byte-identical to the collected evidence; `copy-integrity.json` records only those original copies and their sizes and SHA-256 hashes. The outer `SHA256SUMS` covers every current file except itself, including this README and the separately collected `main-build-and-graphics.json` supplement.

## Exact source and scope

- Baseline checkout: `f80309fce06e97ada17cde1ef330971d9af6ffd9`, tree `48ec011f2caaf5a68137dd3e02f8b14f26ee427b`.
- Tested candidate: `5f23cf60923638bd03b29df9c7b533c536e8624f`, tree `97674f9a9e89ecb7a00427a11310cd5743daf121`.
- Accepted main merge: `93c4c55469ecc2fe44157e74d4e81f3d6c9055c4`, tree `183094280b5c0f3ec40ef5c29537477c7150c204`. A read-only Git comparison found exactly 42 differences from the tested candidate, all under `ci-reports`. `merge-binding.json` records the full parents and changed paths. The hosted jobs ran the exact candidate above; they did not run this later report-only merge.
- Both hosted jobs used Node `v22.23.4`, npm `10.9.9`, unchanged original race files and their existing assertions/deadlines. Installation and execution were guarded against source changes. Checkout, input hashes, runtime and clean-state verification are recorded in `source-verification.json` and both `artifact/source-and-runtime.json` / `artifact/outcomes.json` pairs.

## Results

| Complete original file | Baseline | Candidate |
| --- | --- | --- |
| `tests/gp-tyre-contact.test.ts` | 21 passed, 1 failed | 22 passed, 0 failed |
| `tests/bike-session.test.ts` | 13 passed, 1 failed | 13 passed, 1 failed |
| Both files | 34 passed, 2 failed | 35 passed, 1 failed |

All 36 original case identities match; none are missing, added, pending or skipped. `original-case-comparison.json` retains every case, outcome and failure message. The only changed outcome is the original eight-rider Poggio Alto rain contact case: the baseline fails with impact `0.9916666666666667` against `0`; the candidate passes the original assertion. Every other passing original case remains passing.

The existing mixed GP/superbike pace failure remains byte-identical in both reports: GP `91.13427179346363` seconds versus superbike `90.36337145755091` seconds, where the original assertion requires GP to be faster. Both original-race jobs therefore retain failure status. This proof supports the narrow wet-path correction; it does not establish complete unit-suite or whole-game acceptance.

Candidate focused validation passed **128/128 cases across 10 files**, including eight scaled-path geometry checks and 64 session-identity cases. Candidate scoped lint and full TypeScript checking also passed. The raw focused report is `candidate/artifact/focused-and-identity.json`.

## Supplemental accepted-main build and graphics results

`main-build-and-graphics.json` separately records terminal job statuses and log summaries for accepted main `93c4c55469ecc2fe44157e74d4e81f3d6c9055c4`: validate/build from run **44650977053**, and component GPU, gameplay and High journeys from run **44650976953**. Validate/build succeeded; component GPU validation passed seven cases and the gameplay journey passed one case. The High journey failed its original 90-second wait for `paused`, with the application still `loading`.

This supplement covers only those jobs. It does not establish full CI acceptance and does not change the paired race results above. Log filenames in the supplement refer to the acquisition evidence; those logs are not included in this compact package. The original paired-run copy receipt and artifact receipts remain unchanged.

## Evidence and integrity

`summary.json` gives the final paired findings. `expected-source-manifest.json` and `source-verification.json` bind the reports to exact source inputs. Both original Vitest JSON reports and the candidate focused JSON report retain their original bytes.

Artifact receipts preserve the verified GitHub archive digests and per-file hashes:

- Baseline artifact `14589069185`: SHA-256 `00c1471bd49944b249c2903312960da31e93e4192e7b93c9c402635b4f237e21`.
- Candidate artifact `14589053470`: SHA-256 `6aa24e38879006378b1b0d4c183de501921525943ca70a524a189dee1b4e3216`.

The ZIP archives and logs are deliberately omitted from this compact bundle. Their original receipt entries remain unchanged; an entry in a receipt does not imply that its log or archive is included here. No stale polling snapshots or provisional candidate-only conclusions are included. To verify the retained files, run `sha256sum -c SHA256SUMS` from this directory.
