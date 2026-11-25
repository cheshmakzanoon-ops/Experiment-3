# Assignment 42 — inherited CI failure comparison

## Result

The same four unchanged test files were executed on the current motocross working tree and the coordinator's original `b527a7e01ea247f0233a2ec4f2850639bafbd887` baseline checkout. **Both executions produced 48 passing and four failing tests out of 52, with no skipped tests.** Each failed assertion, its test position and its stack matched after normalizing only the two checkout prefixes and the shared `node_modules` path. The full fourteen-entry dictionary failure diff also matched exactly.

These four failures predate this task's engine changes. Their reproduction does **not** establish a green whole-repository CI run: the four selected files still fail, and this assignment did not run the complete global unit or browser suites.

No production source, test, model, asset, environment, specification, calibration data or translation was edited. This report is the only authored repository file. Temporary execution and comparison receipts are outside the repository under `/workspace/scratch/e91efca799c8/validation/baseline-ci-a42/`. No Git operation, npm lifecycle hook or model generation was performed.

## Matching results

| Unchanged test file | Current pass / fail | Baseline pass / fail | Reproduced failure |
| --- | ---: | ---: | --- |
| `tests/apx01-livery.test.ts` | 3 / 1 | 3 / 1 | The player wing materials include the `turned-alloy` manufacturing finish where the existing test expects its absence. |
| `tests/i18n.test.ts` | 27 / 1 | 27 / 1 | Fourteen missing translation entries: two GP rear-brake keys in each of seven dictionaries. |
| `tests/vehicle-catalogue-growth.test.ts` | 12 / 1 | 12 / 1 | GP-R1's current content hash is `5f121c00`; the frozen expectation is `eca1c71a`. |
| `tests/vehicle-catalogue.test.ts` | 6 / 1 | 6 / 1 | GP-R1's stored calibration hash is `eca1c71a`; the current vehicle definition hashes to `5f121c00`. |
| **Total** | **48 / 4** | **48 / 4** | **Same four failures in both runs.** |

The dictionary keys are `Rear brake (GP motorcycle)` and `GP rear brake button (−1 unbound)`. Both are missing in `de`, `fr`, `es`, `pt-BR`, `it`, `pl` and `tr`. The gate reports them as non-warning `keys` problems. No new motocross string appears in this failure list.

The two GP hash failures expose the same inherited mismatch from opposite sides: one checks the frozen catalogue expectation, while the other checks the saved calibration receipt. The simulation identity's intentional version change to v40 does not explain them. The `contentHash`, `canonical` and `vehicleHash` function bodies are byte-identical between the tested checkouts, as are the relevant vehicle definitions and the calibration JSON.

The existing CI receipts in `ci-reports/logs/build-and-validation/unit-tests-1.log` and `unit-tests-3.log` list these same four failure signatures. The attribution here rests on fresh execution against the original baseline, rather than solely on those historical logs.

## Protected-input and source provenance

Before and after each run, the receipt runner hashed the four tests and 335 related files: package/lock/config inputs, dictionary and catalogue modules, calibration inputs, relevant car-rendering code, all source GLBs, all public assets, and the keyed translation data sources. **All 339 selected files are byte-identical across the two checkouts and unchanged through both commands.** Their shared SHA-256 manifest digest is:

`eddf8a8c768dd71f4a70daefa48f1e5a3b57449f383cff75fadd5ca084a2384d`

The digest is calculated from sorted `path + NUL + file SHA-256 + newline` entries. Exact path membership and per-file hashes are retained in both `*.before.json` and `*.after.json`; this selected input set is not represented as the complete dependency closure of every test.

| Test input | Identical SHA-256 in both checkouts |
| --- | --- |
| `tests/apx01-livery.test.ts` | `a898931af8fe43e031636b8d25dca2cc4dc1fb3cf935cf29a0cc27009c41dd8d` |
| `tests/i18n.test.ts` | `bf84722bc1c023bf74a7d942ae99078601dc1d6ca10e3f6526c174f6495ee515` |
| `tests/vehicle-catalogue-growth.test.ts` | `562fa26e2fb1009a32ffb00b7e572046152058afc9e8d63ef72db997c222e332` |
| `tests/vehicle-catalogue.test.ts` | `1c20f21d3cc14d19e6f64003da5afe3fe46548aa141a346001b1f4d2943657c8` |

The separate SHA-256 of the unchanged content/canonical/vehicle hash function block is `61361fc4404bd4e60d70b67e54332d6cb8d919acde422733e3759f49e6fb948d`. Full `src/` manifests were also captured: neither current nor baseline source changed during its run. The current adapter at this checkpoint remains `e04318b7…`; later A40 repairs require their own source attribution and do not retrospectively change this receipt.

## Commands and timing

Node was v24.22.3. From each checkout root, the same direct test invocation was used, changing only the absolute JSON report destination:

```sh
node_modules/.bin/vitest run \
  tests/apx01-livery.test.ts \
  tests/i18n.test.ts \
  tests/vehicle-catalogue-growth.test.ts \
  tests/vehicle-catalogue.test.ts \
  --reporter=default --reporter=json \
  --outputFile=/absolute/receipt-directory/current.vitest.json
```

For the baseline command, use `baseline.vitest.json` as the output filename. No `npm test`, `pretest`, `prebuild`, model generation or calibration regeneration command ran.

| Execution | UTC interval on 2026-11-25 | Wall time | Vitest exit |
| --- | --- | ---: | ---: |
| Current working tree | 19:01:49.179–19:02:09.928 | 20.749 s | 1 |
| Original baseline checkout | 19:01:49.477–19:02:09.840 | 20.363 s | 1 |

The commands ran concurrently on the shared host. These timings are execution receipts, not a performance comparison. The Python receipt wrapper records the subprocess's exit code; its own successful receipt-writing exit must not be mistaken for a passing test gate.

The receipt folder contains `run.py`, both full console logs and Vitest JSON reports, before/after input manifests, command/timing records, and `comparison.json`. The comparison normalizes ANSI coloring and checkout/node-module locations while preserving assertion wording and stack positions. Its normalized failure comparison and its full dictionary-diff comparison are both equal.

## Disposition

No assertion was weakened or failure suppressed. The player-car material expectation, GP catalogue/calibration mismatch, and GP UI translations require separate work in their respective ownership areas. They should remain visible as inherited global gate failures when reporting this motocross-engine delivery. They do not justify editing protected models or specifications inside this task.

This assignment found no newly introduced failure in its 52-case selection. It makes no claim about unselected global tests or about the separately investigated motocross AI-grid regression.
