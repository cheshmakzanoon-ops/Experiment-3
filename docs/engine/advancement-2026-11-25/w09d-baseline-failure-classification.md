# Wave 9, agent 52: original-baseline failure classification

## Finding and scope

All four investigated unit assertions fail identically on the actual original source, `350119e8ec0606e8c5de5b3ab80df41104025679`, and the frozen candidate, `774e62fafdfd9ecd84001a2fcdb3b9f6ee973b86`. These four failures are demonstrated baseline issues. The result does not establish that all other repository failures are pre-existing, that the whole unit suite passes, or that the candidate passes native browser validation.

The broader browser report inspected here belongs to the earlier engine checkpoint `6a1c76fae3736e4d814ab6d0a354f6837320731c`. Its 20 browser jobs were eventually cancelled, but the retained excerpts contain **37 individual failed cases before cancellation**. Some are actual value assertions; others are readiness, input, visibility or evaluation deadlines. Their causes cannot be inferred from the cancelled job conclusion. No exact-original native browser comparison was performed by this audit.

This assignment changes only this report and its new evidence directory. No production source, tests, thresholds, dictionaries, calibration expectations, models, characters or environment content were edited. Evidence is in [`evidence/w09d-baseline-failures/`](evidence/w09d-baseline-failures/).

## Source identities

| Evidence                                                                                                  | Actual tested source                                                                                                                                | Meaning                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| New local baseline run                                                                                    | `350119e8ec0606e8c5de5b3ab80df41104025679`; tree `2224939844137abcd06d1aed0d9618f74e05dc18`                                                         | Exact original source, four selected unit assertions                                                                                            |
| New local candidate run                                                                                   | `774e62fafdfd9ecd84001a2fcdb3b9f6ee973b86`; tree `5f466294eca0b188db58375a1caf4cd76088527b`                                                         | Frozen candidate, the same four selected unit assertions                                                                                        |
| Broad CI run [`45579529296`](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45579529296) | `6a1c76fae3736e4d814ab6d0a354f6837320731c`                                                                                                          | Earlier candidate, completed with conclusion `cancelled`; retained report read from immutable commit `26efaeefdf5a39b1d28cec4f8fb6bca1c97bf7e1` |
| CI report retained inside original baseline                                                               | Run [`45546801825`](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45546801825), source `811ac2bc92f4494b1ec99d1fc4201101ccf34c66` | A report about an earlier source, not execution of original `350119e8`; cancelled; relevant retained browser logs unavailable                   |
| Earlier complete browser history                                                                          | Run [`44617126580`](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44617126580), source `ffd22598335dfa2a074ebd466e1d53830bb8bb41` | Verified ancestor of original `350119e8`, 1,022 commits earlier; historical comparison only                                                     |

Run identities were independently read through the GitHub API. The comparison API reports original `350119e8` ahead of `ffd2259` by 1,022 commits, behind by zero, with `ffd2259` as merge base. This establishes historical ancestry, not identical source behavior. The selected metadata and comparison URL are retained in [`remote-history-receipt.json`](evidence/w09d-baseline-failures/remote-history-receipt.json).

The checked-in `ci-reports` directory changes when report bots publish. This audit reads pinned Git blobs and retains copies of the two relevant reports so a later bot update cannot silently change its evidence.

## Targeted unit reproduction

### Method

The original worktree was `/dev/shm/aeebac160835-engine-baseline`; the candidate worktree was `/tmp/aeebac160835-engine/Experiment-3`. Both used the same installed locked dependencies, Node `v24.22.3` and Vitest `3.2.4`. The baseline's sparse checkout was hydrated with the exact original versions of required report/script inputs before execution; a missing sparse-checkout file was not classified as a product defect.

The assertions ran sequentially, once on each source, using the direct Vitest binary, a 768 MiB V8 heap, one thread worker, zero retries and no npm lifecycle command. The exact argument arrays and working directories are preserved in [`unit-comparison.json`](evidence/w09d-baseline-failures/unit-comparison.json). The command shape was:

```text
node --max-old-space-size=768 node_modules/vitest/vitest.mjs run
  tests/apx01-livery.test.ts
  tests/vehicle-catalogue.test.ts
  tests/vehicle-catalogue-growth.test.ts
  tests/i18n.test.ts
  --testNamePattern <alternation of the four exact assertion names, with terminal $>
  --pool=threads --maxWorkers=1 --minWorkers=1
  --allowOnly=false --retry=0
  --reporter=default --reporter=json --outputFile <side>.vitest.json
```

Each run executed **four assertions across four files**, with **four failures and zero passes**. The other 48 cases were intentionally excluded by the explicit name filter; they were not disabled or evaluated. In particular, the unrelated expensive vehicle-driving simulations in these files did not run. Vitest's JSON suite totals count nested `describe` suites; the human logs correctly report four files.

Before and after each run, the runner recorded the same HEAD, tree and input hashes. It captured 1,099 original and 1,100 candidate inputs: all source files ending in `.ts`, `.js`, `.mjs`, `.json`, `.glsl` or `.wgsl`, the four selected tests, configuration and package/lock files, the required scripts and reports, and five actual compressed GLB inputs used by the livery test. Every recorded input hash was subsequently checked against the file's blob in its pinned Git commit. All checks matched. The 21 explicitly selected test/configuration/script/report/asset files are byte-identical across both sources. This inventory is evidence of the executed inputs; it is not a substitute for the separate whole-repository protected-content audit.

Complete inventories and Git blob IDs are in [`baseline.inputs.json`](evidence/w09d-baseline-failures/baseline.inputs.json) and [`current.inputs.json`](evidence/w09d-baseline-failures/current.inputs.json). Both process exits were `1`, as expected for the observed failed assertions. Elapsed times, approximately 8.16 and 8.52 seconds, are diagnostic receipts and are not engine performance benchmarks.

### Exact outcomes

| File and assertion                                                                                                        | Assertion location | Actual original and candidate result                                                         | Classification                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `tests/apx01-livery.test.ts` — `is the player's alone, follows a livery edit, and leaves the wings' alloy role in carbon` | `215:91`           | `expected 'turned-alloy' not to be 'turned-alloy'`                                           | Same material-role assertion fails on the original baseline                                                          |
| `tests/vehicle-catalogue.test.ts` — `records every machine inside its design bands at both timesteps`                     | `109:83`           | `gpr1 calibration is stale: run npm run test:vehicles: expected 'eca1c71a' to be '5f121c00'` | Original calibration report stores `eca1c71a`; the actual registered definition hashes to `5f121c00` in both sources |
| `tests/vehicle-catalogue-growth.test.ts` — `keeps every machine that existed before the growth bit-identical`             | `85:58`            | `gpr1 changed: expected '5f121c00' to be 'eca1c71a'`                                         | Original frozen-hash assertion expects `eca1c71a`; actual definition is `5f121c00` in both sources                   |
| `tests/i18n.test.ts` — `passes for all seven dictionaries`                                                                | `207:48`           | Expected no non-warning problems; received the same 14 missing-key records                   | Identical original dictionary/catalogue mismatch                                                                     |

The two hash failures are complementary checks of the same existing disagreement. The calibration test compares the report's stored hash to the current definition, while the growth test compares that definition to its frozen hash. This audit did not regenerate calibration, alter definitions or replace either expectation.

The dictionary gate reports both of these missing keys in every one of `de`, `fr`, `es`, `pt-BR`, `it`, `pl` and `tr`:

- `Rear brake (GP motorcycle)`
- `GP rear brake button (−1 unbound)`

All 14 records have `kind: "keys"` and `warning: false`. The records match exactly between the two sources and are preserved in full in the comparison JSON and both human logs. All four failure messages also match exactly after replacing the differing worktree-root prefixes. Reproducing an early failed assertion does not establish the outcome of later assertions in the same case.

The unabridged evidence is [`baseline.raw.log`](evidence/w09d-baseline-failures/baseline.raw.log), [`current.raw.log`](evidence/w09d-baseline-failures/current.raw.log), [`baseline.vitest.json`](evidence/w09d-baseline-failures/baseline.vitest.json) and [`current.vitest.json`](evidence/w09d-baseline-failures/current.vitest.json).

## Broader CI: cancellation and failures are separate facts

Run `45579529296` started on 2026-11-25 at 08:48:28 UTC and ended at 09:25:37 UTC with conclusion `cancelled`. Its retained summary reports unit partitions 1 and 3 failed; partitions 2 and 4, validation, scenarios, off-road scenarios and wet presentation succeeded. All 16 ordinary browser and four owner-QA jobs have cancelled conclusions.

The browser logs retained by the report are an error digest containing the first 120 matching lines plus the last 250 log lines, not complete job logs. They retain 37 individual failure summaries. Nineteen logs contain an explicit cancellation marker; browser 9's excerpt does not, although the job's reported conclusion is cancelled. An absent failure in one truncated excerpt is not proof that the job passed or that a case did not execute.

The workflow's `cancel-in-progress: true` concurrency setting can cancel superseded runs. That configuration alone does not explain a failed assertion already emitted before cancellation. A timeout identifies the boundary that did not complete; it does not establish graphics, infrastructure, application or test cause.

[`broad-ci-classification.json`](evidence/w09d-baseline-failures/broad-ci-classification.json) preserves every retained case summary, source-log hash, exact recorded job header and available contextual failure block. It marks unresolved cases explicitly. One stream-order issue was corrected in the derived summary: owner-QA 1 emits the programme failure's `Error` before its terminal cross, so attribution follows its explicit `[browser-failure]` test marker rather than the preceding case's cross. The underlying retained log was not modified.

### Engine-relevant cases requiring separate judgment

| Case in the earlier `6a1c76f` run                                                                                                                                | Exact observed boundary                                                                                                                       | Historical evidence                                                                                                                                | Classification                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `e2e/49-festival-menu-access.spec.ts:400` — `festival map: filters, event selection and keyboard focus survive redraws`; browser 3, job `139087692659`           | At `475:5`, expected `{ paused: false, throttle: 1 }`, received `{ paused: false, throttle: 0 }`                                              | Same named case passed in verified ancestor `ffd2259`, browser 5                                                                                   | Real input-state assertion; exact-original browser comparison absent; unresolved                        |
| `e2e/49-festival-menu-access.spec.ts:479` — `festival photo: keyboard return cannot activate the race card behind the controls`; browser 14                      | At `498:92`, second `PHOTO MODE` click waits on `#festMenu` and exceeds 15 seconds                                                            | No matching exact-original execution established in this audit                                                                                     | Locator/input deadline after one photo return; unresolved                                               |
| `e2e/08-reference-implementation.spec.ts:148` — `reference continuation: explicit programme replacement, live chevrons and no replay awards`; owner-QA 1         | At `160:3`, expected diagnostics state `driving`, received `loading` after a 90-second poll                                                   | Exact same readiness assertion and values failed on verified ancestor `ffd2259`                                                                    | Historically observed same assertion; exact-original reproduction and common root cause remain unproven |
| `e2e/02-wheel-fidelity.spec.ts:7` — `actual wheel geometry follows recorded alignment without deforming rigid parts at any LOD`; browser 2                       | `page.evaluate: Error: Expected four visible reduced wheel pivots`                                                                            | Case passed on verified ancestor `ffd2259`, browser 10                                                                                             | Actual evaluation error; unresolved                                                                     |
| `e2e/34-race-view-continuity.spec.ts:8` — `current-camera car detail and active wheel poses survive immediate cuts and long-lens review`; browser 4              | `page.evaluate: Error: Expected four visible reduced wheel pivots`                                                                            | Case passed on verified ancestor `ffd2259`, browser 9                                                                                              | Actual evaluation error; unresolved                                                                     |
| `e2e/24-coupled-driver.spec.ts:9` — `27H.2 normal application: coupled driver survives both locks, countersteering, moving cameras and replay seeks`; owner-QA 4 | At `80:5`, expected signed presented wheel angle greater than `0.5`, received `-0.6108652381980153` when the 420-second test deadline expired | Ancestor `ffd2259` failed the same named case through `page.evaluate`/closed context during the earlier polling path, a different reported failure | Actual signed-pose predicate remains unresolved; matching test title is insufficient baseline proof     |

These are failures observed at source `6a1c76f`. They are not represented as newly executed results for `774e62fa`. The remaining retained cases include authored-startup readiness, visibility, input and scene-evaluation deadlines. Their exact-original origins remain unclassified. Ordinary browser shards in this run used Mesa/llvmpipe; the inspected owner-QA 1 log declares `APEX_BROWSER_BACKEND: swiftshader`. A single backend explanation cannot be assigned to every failure.

### Festival map source review

The Festival map title mentions keyboard focus, but the observed failure is the final **driving throttle** check. The earlier focus assertions in that case completed before it. The sequence closes the map, closes the pause menu with a second Escape, holds `w`, then calls the fixture's `frame()` once. The expected throttle is one; the returned throttle is zero while `paused` is false.

`e2e/fixtures/festival-menu-access.ts` constructs the real `InputController`, `FestivalControls` and `FestivalHud`. It supplies event/status data and manually drives the frame method; it does not instantiate a renderer, worker or running simulation. The frame method polls pause actions while driving input is disabled, otherwise calls `input.update(1 / 60)`, updates the HUD, synchronizes controls, and returns the state. `FestivalControls`' driving hook calls `input.setEnabled(on)`.

The spec, fixture, owner-build defines, Festival controls, Festival HUD, relevant CSS, bindings, input calibration, button actions, input queue, default settings, math and simulation configuration all compare byte-identically between original and candidate. The complete diff of `src/input/controller.ts` adds only:

```ts
suspendForPage() {
  this.buttons.reset();
  this.setEnabled(false);
}
```

The fixture does not call this new method. The existing `setEnabled`, keyboard handling, reset and update implementations are unchanged. This source inspection identifies no direct causal path from that addition to the failed map throttle assertion. It is not equivalent to a native execution and does not prove all transitive behavior equivalent. The named file hashes and full controller diff are in [`festival-source-review.json`](evidence/w09d-baseline-failures/festival-source-review.json).

Because the fixture isolates DOM and input ownership without a rendered scene, this case and the photo return case are useful priorities for a permitted native comparison of original and candidate. A future comparison should preserve their existing assertions, timeouts and input sequence. The signed driver-pose and wheel-visibility assertions also remain relevant to changed scheduling/presentation paths; no model or character modification is warranted by the available evidence.

### Why the retained baseline report does not settle browser status

The report committed in original `350119e8` refers to source `811ac2bc92`, not `350119e8`. Its browser 3 and 4 log files say `logs unavailable (expired or not accessible)`. The original run's cancelled status and unavailable logs therefore provide no case-level proof for the Festival or wheel outcomes. Exact copies are retained beside [`original-retained-build-and-validation.md`](evidence/w09d-baseline-failures/original-retained-build-and-validation.md).

The older `ffd2259` evidence has a verified run identity, verified ancestry and retained compressed full logs. The selected terminal lines and actual error contexts, together with compressed and decompressed log hashes, are retained in [`historical-browser-cases.json`](evidence/w09d-baseline-failures/historical-browser-cases.json). Its programme failure is useful historical evidence; its Festival and wheel passes limit any blanket claim that all current browser failures were already present.

## Validation boundaries and handoff

The new evidence supports these conclusions:

1. The four selected unit failures are reproduced on the actual original baseline, with identical candidate outcomes and verified source/data identities.
2. No protected content, calibration hash, dictionary entry or test expectation was changed to obtain those classifications.
3. The retained broader CI report is cancelled and contains genuine earlier failed cases. It cannot be reported as green, wholly caused by cancellation or wholly pre-existing.
4. Historical browser results are tied to their real source commits. They do not replace a native comparison on original `350119e8` and candidate `774e62fa`.
5. Type checking, focused engine CI, native candidate validation and whole-repository conservation checks belong to their separate receipts. This report does not inherit their results or convert an unexecuted check into a pass.

The evidence directory's [`SHA256SUMS`](evidence/w09d-baseline-failures/SHA256SUMS) covers its retained logs, machine results, identities and derived summaries. Source validation used read-only Git operations. The two selected unit runs are the only tests executed by this assignment.
