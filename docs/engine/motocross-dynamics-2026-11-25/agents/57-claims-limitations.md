# Assignment 57 — final claims and limitations audit

## Result and ownership

**The independently recomputed final numerical/gameplay counts agree with the handoff. No additional production correction is justified by this audit.** Final native-browser acceptance remains pending; it cannot be declared green from the earlier A37 build or partial A50 captures. The retained spring-work, travel-clamp, sampled-contact, geometry and clock limitations are now collected in [LIMITATIONS.md](../LIMITATIONS.md), with concrete future acceptance requirements.

This assignment authored only that document and this report. It ran no test, simulation, browser, build or model-generation command, made no source/test/asset/specification change, and performed no Git index/ref mutation. No child agents were spawned. The coordinator owns publication and the eventual native-status reconciliation.

## Independent checks of the actual final receipts

The audit read the underlying JSON result files rather than accepting the reports' headline totals on authority. The computations were in-memory read-only Python inspection; they are not additional test executions.

| Raw evidence | Independently recomputed result |
| --- | --- |
| `validation/final-units-a49/vitest.json` outside the repository | Exactly 165 unique `testResults` paths, all passed; 1,836 assertion results, all passed. Filename grouping gives 128 motocross files/1,278 cases and 37 other files/558 cases. No other assertion statuses. |
| `validation/a52-final-races/attempt-02/grid/test-results/motocross-full-grid.json` | Eight distinct venue/weather/seed cases; 96 positive finish times, zero retired entrants, 192 classified rider-laps at two laps per case; nine crashes, maximum one per rider/case, maximum stop 14.60 s. Each bike supplies 48 entrant starts. The runner's `passed` is true and its failure list is empty. |
| `validation/a52-final-races/attempt-02/calibration/docs/offroad-calibration.json` | Twenty configurations: seventeen clean and three bottomed hold-speed outcomes; twenty rolling `ok` results; twelve window configurations produce 24 accepted short/long outcomes. The failure list is empty. |
| `test-results/a54-final-cadence/recordings.json` | Eight recordings and 736 retained frames. Refresh/probe/selector comparisons are 12,160 + 76,000 + 5,776 = 93,936 matrices; scalar comparisons 79,344; real rig poses 36,192; supplemental accepted shifts 48. All four reported maximum differences are exactly zero. |
| Both raw A42 Vitest JSON reports | Four files and 52 assertions each: 48 passed and four failed. Failed test names match, and the preserved normalized comparison reports matching failure messages/stacks. This is a selected baseline comparison, not a complete CI run. |
| Root static-gate receipts | Full TypeScript and full ESLint exit zero; the later full TypeScript and focused lint for the sole subsequent riding-test edit also exit zero. Each gate's receipt declares unchanged captured inputs. A53 independently reconciles their file manifests. |

The first two `validation/` paths are relative to `/workspace/scratch/e91efca799c8/`; the A42 evidence is under its `validation/baseline-ci-a42/` directory. Repository-local receipts use the `test-results/` prefix. Stable reproduction commands and the accepted source identities are linked by [A49](49-final-units.md), [A52](52-final-races.md), [A54](54-final-cadence.md) and [BUILD_PROVENANCE.md](../BUILD_PROVENANCE.md).

| Independently read raw file | SHA-256 |
| --- | --- |
| A49 `vitest.json` | `c54ffca868e2f153423f08247a4e5b886a2e21f24987b634a2705cdda5e41c73` |
| A52 full-grid JSON | `6c01d0ea8d27e04635f218be687b3c95cbd22e8e7bc12e703f8651fa31564cfa` |
| A52 calibration JSON | `962d469bfd818dbd2dd7fbc5b5e08df6a2bd463ecc614cf2e7892ea294bdd18a` |
| A54 recording results | `75b8e1c0ed9e7aaf8ae2b55dbfbfaa767a860b1d79db55a16ed9f3b5b8f44c69` |
| A42 current Vitest JSON | `d5dfb10d8828d2d4858b7c31deeb9e434ff66d14c392cba8b0620539d5b10ec2` |
| A42 baseline Vitest JSON | `fb45d539558763bc2cbfb9b0c8644cef54ca0f65312ef663a8181d02d29cad49` |

## Current source and interpretation review

All **59 publication inventory files** were independently rehashed: **18 runtime, 37 tests and four benchmarks**, with zero differences from the frozen inventory. `git diff --name-only -- src tests scripts` was empty. The candidate remains identified by tree `b7f379a7aaea0f807b5623b2c981190c6d1a3a17`; A53 owns the complete Git-blob/tree and artifact provenance proof. This assignment does not substitute a new whole-tree build claim for that proof.

Direct inspection of the final adapter confirmed the full gap-rate/stop lever, shortened compliant force arm, forward-only speed clipping, endpoint sign-bracket condition, 32 fixed bisections, one-sixth-stroke/0.3-radian criteria and sixteen-stage cap. The shared presentation gate still holds an older pose for non-increasing Float32 header time. The final motion reader includes A47's finite mudguard range validation, so the earlier A45 endpoint defect is not described as unresolved.

The claims review read the final handoff and architecture together with the detailed reports on spring geometry, integrated stops, refinement, actual-rig geometry, baseline CI, independent physics, protocol clocks and oracle migrations. Its material wording findings were sent to the coordinator and handoff owner:

- A sign-changing endpoint bracket does not establish the earliest crossing through arbitrary nonmonotonic terrain; an interior enter/exit feature with two positive endpoint gaps is not searched. This is a source-derived coverage limitation, not a newly executed tunnelling reproduction.
- A52 completes its races with nine allowed crashes, and calibration includes three permitted bottomed outcomes. The distance-ratio check excludes kickers, and standing-start seconds measure 60 metres rather than 0–60 km/h.
- A54's zero differences mean equal reconstruction at the sampled common times, not zero error against unrecorded physical events or verified GPU/display smoothness.
- Historical focused tests and local randomized diagnostics overlap final coverage and must not be added to A49's distinct total. A18's torque-only experiment and A32's measured residuals retain their original source/fixture attribution.
- Model protection concerns authored files and definitions. Animation transforms intentionally change; byte-identical models do not prove exact visible wheel/terrain contact.
- A43's then-pending integration and A45's pre-repair endpoint gap need their later dispositions. A48's reviewed test-contract migrations also mean that a blanket claim that every assertion/tolerance stayed unchanged would be inaccurate.

The handoff owner incorporated the first-contact wording and retained the separate final, historical and pending states. No source change or repeated validation was requested.

## Native-browser status at release of ownership

A50's completed final-build invocation failed after ten images; its earlier interrupted invocation is not a test result. The isolated diagnostic began at **20:21:59 UTC** on 2026-11-25 with matching source/build inputs and the original test, Low/SwiftShader backend, zero retries and unchanged cap. At this report's checkpoint it had opened the initial menu/settings and selected Low, then remained in APPLY & SAVE before venue entry. A50 reported GPU-process exits with code 9 around 20:22:36 and 20:23:09 UTC. There is no completed diagnostic result to certify here.

The observed host-memory drop, missing cgroup OOM counters and process exit codes do not establish a cause. A later global OOM counter without a pre-run baseline also cannot attribute this browser's exit. The coordinator removed only its reproducible baseline checkout to free disk while the diagnostic ran; no accepted source, built file, test or index content changed. The actual terminal outcome belongs to A50 and the coordinator's final reconciliation.

Ownership of both documents is released to the coordinator for that final status update. No A57 heavy processes were started or remain active. This report does not claim that main has been published or that all sixty assignments have finished; the publication/ledger assignments supply that evidence separately.
