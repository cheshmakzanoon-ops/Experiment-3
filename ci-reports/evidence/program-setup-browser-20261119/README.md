# Passive program-setup diagnostic: hosted evidence

Source `31a39636a3907ff5159640affdbeb2e2c9184c6f`, tree `6c9ef74ee4c52e502e1e4484037f72e453eec886`; [run 44634762506](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44634762506).

All 5 jobs are terminal. Original browser inventory: 16 cases, 15 passed, 1 failed, 0 skipped, 0 retries. Exact original case identities match the preceding b8 source.

## Original evidence

All five complete original job logs are retained losslessly with byte counts and SHA-256 receipts. All four browser archives match their GitHub sizes and artifact digests. Every original case/result and attachment descriptor is retained; compressed report details preserve the original result payloads. The build artifact descriptor is retained without downloading its large archive.

## High and passive native timing

High outcome: `unexpected`, 147608 ms whole-case duration. Readiness is identified by the original expected-paused poll, independently of shifted source lines; its deadline remains 90,000 ms.

The new observer retained 18 cumulative summaries and 16 detailed slow-call records, counting 37544 returned/throwing tracked calls and 30934.600000 ms of CPU call duration. 35 calls reached the 100 ms threshold; 0 native JavaScript exceptions were counted.

At the chase-to-pit transition, 37,330 setup calls account for 30.9344 seconds during the 42.2917-second chase stage. All 35 calls at or above 100 ms occur before that transition. The final pit summary adds only 214 tracked calls and 0.2 ms.

| Method | Calls | CPU total (ms) | Maximum call (ms) | Calls ≥100 ms |
| --- | ---: | ---: | ---: | ---: |
| uniformMatrix4fv | 4,389 | 11412.5 | 1944.2 | 14 |
| uniform4fv | 5,005 | 11292.3 | 1995.0 | 14 |
| activeTexture | 9,010 | 3766.2 | 2221.1 | 4 |
| uniform1f | 3,828 | 1560.0 | 1557.0 | 1 |
| bindTexture | 9,153 | 1538.8 | 1532.5 | 1 |
| uniform3f | 2,941 | 1354.5 | 1349.5 | 1 |

The retained 16 calls account for 14.631 seconds and exhaust the detail cap about 20.77 seconds into chase. The other 19 slow calls remain in method totals and maxima but have no individual retained identity. Retained calls include built-in model/shadow matrices, roughness, fog/cloud uniforms, GP shape/front arrays, activeTexture and bindTexture. This distributed call-boundary evidence does not establish that any one uniform value or byte count causes the delay.

See `high/program-setup-analysis.json` for original slow-call identity/stacks and method totals, `high/program-setup-timeline.json` for summary-to-summary counter deltas, and `high/native-analysis.json` for the original readiness, stage, native activity and shader/upload boundaries. The slow-call attachment and final summary are checked against the complete trace console records.

These returned-call measurements include wrapper/clock/driver overhead and cannot identify isolated GPU execution. Capped records can omit later identities. Recorded program/framebuffer/unit values are cached observations, not a full resource-ownership proof. The first pit-service fence can include the preceding entire chase submission.

## Source and reproduction

The published tree exactly equals the independently reviewed local diagnostic commit. Only the High observer setup/attachments and its new helper/conformance tests change; production source, workflow, original test workload, assertions and deadline remain intact. `protected-inputs.json` and `independent-review/receipt.json` preserve the proof.

Reproduce from the retained archives with the parameterized `analyze-high.py ARCHIVE HIGH_OUTPUT SOURCE RUN JOB`, then `analyze-program-setup.py HIGH_OUTPUT`, then `extract-program-setup.py ARCHIVE_DIRECTORY OUTPUT_DIRECTORY`. No application execution or remote mutation is performed by these extractors.
