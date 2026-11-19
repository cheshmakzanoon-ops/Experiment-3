# Admission-only supplemental evidence

## REJECTED: 2 of 3 original controls pass

The preserved candidate contains the history correction plus only the existing 220 m passing-admission reserve. It passes the two sampled zero-fall cases but **fails the original mixed-race pace gate**. This package does not accept the candidate and does not weaken, skip or reinterpret any assertion.

| Original control | Result | Actual guarded exit | Observation |
| --- | --- | --- | --- |
| Montejaral, seed 5111 | PASS, prior run | 0 | Race finished with zero falls; not repeated |
| Vellamar, seed 5222 | PASS, new run | 0 | Race finished with zero falls |
| Mixed Vellamar, seed 3303 | FAIL, new run | 1 | GP best 91.33198363 s; SBK best 89.71691286 s; GP 1.61507077 s slower |

The seed 3303 test passed its earlier race-finished, bounded-incident, no-retirement, every-rider-finished, completed-lap and stopped-rider assertions. It failed the first pace assertion (`gp < sbk`); the final `sbk - gp > 0.15` assertion was not reached.

Both new runs preserved every guarded input and production-source digest. All six critical source/test hashes recorded by the prior Montejaral receipt match the new controls exactly. No current-path handoff, selected-path, relative-intent, extended-profile or wet-path changes were imported into this candidate. The prior patch and receipt establish that `src/simulation/traffic.ts` is the only difference from the preserved history source.

The candidate remains at `/workspace/scratch/0ab62d15db18/gp-history-admission-only-control`. Original receipts and logs here are byte-identical copies; absolute paths inside them retain their historical meaning. `index.json` records each copied file's origin and hash, exact source attribution, and the matching prior-control identity. `SHA256SUMS` covers all package files except itself.

```sh
sha256sum -c SHA256SUMS
```

No new race or source mutation occurred while staging this supplement. The existing `continuation-native-evidence` package remains unchanged. This supplement completes the source-scope comparison and preserves the failed pace result as a rejection.
