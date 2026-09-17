# Recovery checkpoint — 2026-09-17

## Source of truth

The last verified application commit before this recovery is `90c55d22154b21c7c0fdbddc7fa0e402cc3a8398`. The subsequent development pass was not committed. On resuming, its `/mnt/data/apex-work` directory contained seven JSON reports but no application source, tests, patches, or source archive. Searching the available conversation and Library files did not recover that source.

**The features described in that uncommitted pass must not be treated as shipped, recovered, or reproducibly tested.** They must be reconstructed on top of the verified repository, tested again, and published in real commits. This checkpoint does not change game behavior.

## Surviving reports

These are historical evidence descriptions, not acceptance certificates for the current repository. SHA-256 values identify the exact surviving attachments. Their associated source revision is unavailable.

| Historical report | SHA-256 | Interpretation |
|---|---|---|
| acceptance-10cars-100laps-clear.json | f345e2a8dab06305c62415a2d4bacd0537c11629c6c48779f7e331f6feef829f | FAIL: all ten cars reached 100 laps, but collision/damage robustness failed. |
| acceptance-10cars-50laps-clear.json | 69de67492f97b9eb6efa4f14ac43e553a1589b7a25e3db0c6ac5f50b4ed90e0e | Historical PASS for seed 4417; cannot be reproduced without the missing source. |
| browser-components.json | 0faf7519b0202e196f96597ae701b81bc8a50aba9eb925e0eb3026253380c57e | Component-only report; explicitly not a WebGL/full-game test. |
| dynamics-benchmarks.json | 3126a0867e9c6c2ad5ea3faafdaa2cf7d2b676b9706ca1d5cf9b4e2b36160f8c | Historical dynamics measurements. |
| merge-traffic.json | f9b3562f68ed35d4bf44e50dca6ed69749d37e93c7721267f3a42e36118815a7 | Historical focused pit-merge results; not a rerun of the 100-lap gate. |
| performance-cpu.json | 1b04a68ff541f6ddba6185483caf3127e3ff4c21189b6f9f122d831b6b7623e5 | CPU-only historical measurements; not target-device GPU performance. |
| race-integration.json | 2881722c5cddd5a94a7687443648d4d677a99150d99888e5e5040aa374d69992 | Historical headless race report; not the complete audiovisual acceptance scenario. |

## Publication discipline

Changes are published incrementally to `main` with fast-forward updates. Source, executable regression tests, and current validation evidence must be committed together. No orphan Git tree, local filesystem path, unexecuted test, or screenshot-only result constitutes a completed handoff. Keep this recovery record so earlier claims are not mistaken for verified delivery.
