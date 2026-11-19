# Compact mixed3303 diagnostic supplement

**Disposition: unresolved diagnostic; no accepted physics change.** The original mixed3303 pace assertions still fail. The included production patch is solely the frozen, unaccepted throttle candidate required to reconstruct this evidence. It is not an integration recommendation.

This supplement preserves the full package's native proof inputs, receipts, source hashes, scripts, results and timing tables while omitting its large full-race trace. No physics change, new simulation or native test was performed while preparing the supplement.

## Findings preserved

The original full observer exactly reproduced GP **91.4372396579149 s** and SBK **90.3703801553851 s**: GP advantage **−1.0668595025297947 s**, versus the unchanged required advantage greater than 0.15 s. All six riders finished two laps with no crashes. The observer exit 0 denotes successful reproduction and source stability, not race acceptance.

Native sector deltas, GP minus SBK, are **+0.3214126281671952**, **−0.3045298354522714** and **+1.049976709814871 s**. The measured net loss is concentrated in sector three.

A separately authorized partial replay stopped at race time **146.10753271592452 s**, with the race unfinished. All seven recorded planner calls matched the full observer exactly. Offline native replay reproduced all **96** captured approach profiles and their runway outputs. Holding a profile/count/grip/path fixed, the observed speed change **80.80081641717129 → 81.14925971746447 m/s** changes its runway from **Infinity → 108 m**. The geometric cap maps these to **672 → 108 m**. This establishes a local speed-dependent discontinuity; it does not establish a safe corrective algorithm or a passing race result. This isolated event is in sector two, and the sector-three own-plan contribution remains unresolved.

## File map and receipt meaning

| File | Purpose |
|---|---|
| `full-observer-report.md` | Unmodified historical report of the full observer |
| `profile-proof.md` | Unmodified historical report of the native profile proof |
| `observer.json` | Original full-observer guard receipt, exit 0 |
| `profile-observer.json` | Original partial-capture guard receipt, exit 0 |
| `profile-offline.json` | Original offline-native-replay guard receipt, exit 0 |
| Corresponding `.log.gz` files | Original command output, lossless |
| `source-manifest.json.gz` | Complete original 7,459-input manifest; identical across the three guards |
| `source-whitelist.json.gz` | All 931 production-file hashes, original test hashes and focused fixture hash |
| `native-laps.csv` | Native lap/sector timings |
| `lap2-100m-bins.csv` | Residence/control table derived from native substep aggregates |
| `planner-transition-window.json` | Exact recorded transition calls and nearby selected control/load samples |
| `profile-window.json.gz` | All 96 exact native profile input/result records; no profile-field projection |
| `offline-replay.json`, `native-runway-loop.txt` | Exact native replay results and verbatim selector fragment |
| `compact-analysis-inputs.json.gz` | Checked lossless projection for table and sampled-statistic verification |
| `projection-verification.json` | Full-original comparison results and projected field specification |
| `compact-data-verification.json` | Stored-data re-verification result; no game imports or race |
| `supplement-provenance.json` | Copy provenance, omissions, original sizes and hashes |
| `original-package-SHA256SUMS`, `original-copy-provenance.json` | Unmodified manifests of the external full package |
| `SHA256SUMS` | Manifest for this compact supplement |

The historical reports' statements that the full trace is “included” describe the original package, not this supplement. Historical receipt paths are preserved exactly. For the partial/native reports, the compact names are `profile-observer.json` and `profile-offline.json`, as mapped above.

## Explicit omissions and reproducibility limits

The original package remains unchanged at `/workspace/scratch/0ab62d15db18/gp-throttle-mixed3303-package` (26 files, 14,459,473 bytes). Its manifest SHA-256 is `ddd04a0b9dbcc9c3342d85d2c27b2d00ab64b89fa779bc43ef3312a06ab650c3`.

The omitted `trace.json.gz` is **13,416,688 compressed bytes**, restoring **72,288,296 bytes** with SHA-256 `752d7c5d3797bdb091fc17c20edf2a3d2758756c0d2f643e5e660073c29976f2`. Its compressed hash is recorded in `supplement-provenance.json`.

The projection retains all **42 complete native timing events**, all **480 complete original substep aggregate records**, and the exact consumed fields from **2,750 GP lap-2 samples** needed to verify the phase-difference and throttle-reconstruction statistics. It was serialized, compressed, restored and compared against the full original with **64,341 strict leaf comparisons**, including IEEE-754 binary64 comparison for floats. No consumed value was rounded, resampled or inferred. Source sample indices explicitly map projected samples back to the original.

The residence-bin tables can be recomputed exactly from the retained original aggregate records. **This is not independent reintegration of the physical substeps.** Individual 240 Hz state inputs were never retained, even in the full original; the observer accumulated those metrics online. The omitted full trace also contained the other 10 Hz physical samples and all 6,283 planning records. Only selected transition calls and reported event results are retained here, so arbitrary full-race state analysis requires regeneration of the full observer trace.

All 96 native profile inputs/results remain complete, and the native replay scripts remain available. Full TrafficPlanner.evaluate state was not captured and was not fabricated. The selector proof uses the uniquely extracted, unchanged source loop, transparently documented by the native replay program.

## Verify this supplement without game execution

From the supplement directory:

```sh
sha256sum -c SHA256SUMS
python gp-throttle-compact-verify.py .
```

The Python verifier imports no game code. It reproduces both CSV files byte-for-byte, the native sector deltas, stored-aggregate totals/ranges, sampled phase statistics and zero throttle-reconstruction error. It also verifies that the profile payload matches the preserved native replay hash/results. It does not rerun the native proof.

## Exact source reconstruction

Recorded candidate HEAD: `a1e2e385251b94f7cc82e123440a0a4c72611d63`. Its baseline tree is `51077ee3c9103d7faf139b622aa806bf8652d1f6`. The published tree-equivalent baseline is `d8d87c73a8f3e921e865acdc02c61e84b8c877a7`; verify the tree before applying anything. The only changes from that tree are the included `candidate-production.patch` and `tests/gp-steering-throttle-ownership.test.ts`. The fixture's original provenance is retained.

Candidate `bike-ai.ts` SHA-256: `ffc70ab74e818298535eea6c48375df8cd3a5b30ba4ad776370a358eb3358c7d`.

Focused fixture SHA-256: `5c8da06bbc1fe3ae334f32a31924df0e35bd5a6d437704f7932e33f6be648469`.

The capture host used Node **v24.22.3**. The source declares Node >=22.12.0. Use the pinned lockfile's dependencies. These are reproduction instructions, not actions executed during compact packaging:

```sh
GP_REPO=/absolute/path/to/Experiment-3
GP_SOURCE=/absolute/path/to/new-isolated-replay-worktree
GP_EVIDENCE=/absolute/path/to/this-supplement
GP_OUTPUT=/absolute/path/to/external-replay-output

git -C "$GP_REPO" worktree add --detach "$GP_SOURCE" d8d87c73a8f3e921e865acdc02c61e84b8c877a7
test "$(git -C "$GP_SOURCE" rev-parse 'HEAD^{tree}')" = 51077ee3c9103d7faf139b622aa806bf8652d1f6
git -C "$GP_SOURCE" apply "$GP_EVIDENCE/candidate-production.patch"
cp "$GP_EVIDENCE/gp-steering-throttle-ownership.test.ts" "$GP_SOURCE/tests/gp-steering-throttle-ownership.test.ts"
npm --prefix "$GP_SOURCE" ci
mkdir -p "$GP_OUTPUT"
gzip -cd "$GP_EVIDENCE/source-whitelist.json.gz" > "$GP_OUTPUT/source-whitelist.json"
gzip -cd "$GP_EVIDENCE/profile-window.json.gz" > "$GP_OUTPUT/profile-window.json"
```

The complete original protected-input manifest is historical evidence. A new machine or dependency-directory layout may produce a different overall manifest; the native source/fixture whitelist must still match, and the guard must prove stability within each invocation. Keep new output outside the isolated source.

### Reproduce the native profile proof offline

This creates no Simulation and advances no race:

```sh
nice -n 10 node --no-warnings --experimental-transform-types "$GP_EVIDENCE/run-guarded-command.mjs" \
  "$GP_SOURCE" "$GP_OUTPUT/offline" timeout 30s \
  node --no-warnings --experimental-transform-types "$GP_EVIDENCE/gp-throttle-runway-profile-replay.mjs" \
  "$GP_SOURCE" "$GP_OUTPUT/profile-window.json" "$GP_OUTPUT/native-proof"
```

### Regenerate the omitted full observer trace

The original settings are DEFAULT_OPTIONS plus Vellamar, race mode, GP-motorcycle rules, two laps, five opponents, the six vehicles `['gpr1','sbk1000','gpr1','sbk1000','gpr1','sbk1000']`, seed **3303**, `autoPlayer=true`, outer step **1/120 s**, original maximum **400 simulated seconds**, and a **120 s** external wall deadline. The program contains the exact option construction and numeric comparison.

```sh
nice -n 10 node --no-warnings --experimental-transform-types "$GP_EVIDENCE/run-guarded-command.mjs" \
  "$GP_SOURCE" "$GP_OUTPUT/full-observer" timeout 120s \
  node --no-warnings --experimental-transform-types "$GP_EVIDENCE/gp-throttle-mixed3303-observe.mjs" \
  "$GP_SOURCE" "$GP_OUTPUT/trace.json" "$GP_OUTPUT/source-whitelist.json"
```

Exit 0 still means exact reproduction and stable source; the original pace gate remains failed. To regenerate the bounded profile capture, use `gp-throttle-runway-profile-observe.mjs` with source, external output JSON, whitelist JSON, and the retained `planner-transition-window.json`, in that order, under the same guard/120 s wall deadline. It stops at race time 146.10 s and explicitly does not evaluate full-race acceptance.
