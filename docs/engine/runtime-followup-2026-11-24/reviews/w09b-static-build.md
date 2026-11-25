# Worker50 / W09B — final static and production build gate

## COMPLETE — PASS at final checkpoint 9119c768

All five approved local checks passed on **2026-11-25 04:47:36–04:49:09 UTC**. **COMPUTE was explicitly released to root after inspecting all results.** No further gate, browser, benchmark, source edit, or dist change is pending from worker50. The full repository source freeze continues for worker51.

- HEAD: `9119c7683d821d145f15ed64a03ee3406595b58d`
- Tree: `3b704f846c3283c21e73f8f5c3febf670a773c63`
- Repository: `/tmp/engine-c71f32882729/repo`
- Raw evidence directory: `/tmp/engine-c71f32882729/w09b-work/`
- Main result: `w09b-static-build-manifest.json`, with `passed: true`

## Results

| Check | Result | Guarded elapsed time | Raw evidence |
| --- | --- | ---: | --- |
| ESLint over `src tests e2e scripts` | Exit 0; no lint diagnostics | 36.83 s | `w09b-lint.log` |
| Complete configured TypeScript project | Exit 0; no compiler diagnostics | 30.91 s | `w09b-typescript.log` |
| Direct full-product Vite build, including its existing IP guard | Exit 0; 1,096 modules transformed | 18.25 s | `w09b-build.log` |
| Existing bundle-budget script | Exit 0; **3.78 MiB gzip against unchanged 4 MiB budget** | 1.96 s | `w09b-bundle.log` |
| Explicit existing IP guard | Exit 0; **75 files scanned, 113 tolerated internal identifiers, zero problems** | 4.03 s | `w09b-ip.log` |

Times include each command's source-stability wrapper and are validation durations, not engine performance measurements. Vite itself reported 13.57 s. The bundle report contains eight initial chunks and twelve lazy chunks; the initial gzip byte counts sum to **3,959,700 bytes**. Lazy JavaScript is reported as 1.59 MiB gzip. The build has no source maps.

## Exact execution

The scratch runner `/tmp/engine-c71f32882729/w09b-static-build-gate.mjs` was invoked once for this gate:

```sh
NODE_OPTIONS=--max-old-space-size=4096 node --experimental-transform-types /tmp/engine-c71f32882729/w09b-static-build-gate.mjs 9119c7683d821d145f15ed64a03ee3406595b58d 3b704f846c3283c21e73f8f5c3febf670a773c63
```

It executed these commands serially, with a 4,096 MiB old-space limit and the installed Node executable in place of each `node`:

```sh
node --experimental-transform-types scripts/source-stability.ts -- node node_modules/eslint/bin/eslint.js src tests e2e scripts
node --experimental-transform-types scripts/source-stability.ts -- node node_modules/typescript/bin/tsc --noEmit
node --experimental-transform-types scripts/source-stability.ts -- node node_modules/vite/bin/vite.js build
node --experimental-transform-types scripts/source-stability.ts -- node scripts/bundle-budget.mjs --dist dist --json
node --experimental-transform-types scripts/source-stability.ts -- node scripts/ip-guard.mjs --dist dist --json
```

Full command arguments, timestamps, exit codes, signals, log hashes, and runtime identity are retained in the main manifest. `w09b-runner.log` preserves the runner's complete output. Every Git call used `GIT_NO_LAZY_FETCH=1` and `protocol.allow=never`; these restrictions also applied to Vite's inherited Git calls. No lazy fetch, historical binary diff, dependency install, npm lifecycle hook, player-model generator, or global formatter ran.

The product mode variables `MOTOBOUND_SUPPLIED_PLAYER`, `MOTOBOUND_REVIEW_TOOLS`, `MOTOBOUND_QA_BUILD`, `MOTOBOUND_DEMO`, and `APEX_SOURCEMAP` were all unset. No quality, timeout, lint, compiler, bundle, or IP threshold was changed.

## Source and dependency stability

All **3,396 guarded input paths** had identical before/after values. `changedSourcePaths` is empty. HEAD and tree remained the exact values above. The only Git-status entry before and after was the pre-existing untracked `browser-progress.json` receipt.

| Receipt | Before and after |
| --- | --- |
| Guarded source SHA-256 | `d3bb494f817402f0723bb35fcc9dadec875669032f8803e0f6eebc9ae7d2584a` |
| `package-lock.json` SHA-256 | `610c1768c440c202a4e37f62d22467d4cbbddc44a5962e82bb256dcfb8627edf` |
| Generated supplied-player LOD file | Absent before and after; no generator ran |

The full source maps are `w09b-source-before.json` and `w09b-source-after.json`. **This runner's aggregate algorithm** hashes, in `snapshotSource` insertion order, each UTF-8 path + NUL + guard value + LF. Other workers may use different aggregate formats; their hash strings must not be equated with this one. Exact production/tree identity and each runner's own before/after equality are the relevant evidence.

The unchanged source guard excludes the generated LOD file and root browser receipts; the runner separately checked the LOD file's presence/hash. Other guarded source, tests, scripts, configuration, documentation, and root inputs were unchanged. No missing sparse reference file required materialization during this run.

Runtime: Node `v24.22.3`, V8 `13.6.233.17-node.63`, Linux `6.18.57`, x64. Installed versions: ESLint `9.36.0`, TypeScript `5.9.3`, Vite `7.1.7`, Vitest `3.2.4`, Three `0.180.0`, Playwright `1.55.1`.

## Production output for worker51

`/tmp/engine-c71f32882729/repo/dist/BUILD_IDENTITY.json` contains:

```json
{
  "version": 1,
  "commit": "9119c7683d821d145f15ed64a03ee3406595b58d",
  "fingerprint": "c504fad0736d361bbeb79bf6ef4d64bafe2200329c064525c5dc60066729d7fe",
  "variant": "product",
  "edition": "full"
}
```

The output receipt `/tmp/engine-c71f32882729/w09b-work/w09b-dist-manifest.json` records every output path, size, and SHA-256: **266 files, 135,848,008 bytes**. The receipt file SHA-256 is `78d3adc808eda6f274157a8d7a51146e02cdf508d5454217b2c3a5684b9cea65`.

Worker51 has been sent the exact identity, receipt paths, and compute-release message. **Worker50 started no preview server**, including on port 4173. The production dist is ready for worker51 to use unchanged once root grants its lease.

## Retained warnings and limits

- Vite retains its existing warning that some minified chunks exceed 500 kB. The same warning is present in the earlier `/tmp/engine-c71f32882729/checkpoint4-build.log`; no warning threshold or chunk configuration was modified.
- Node prints its `Transform Types` experimental-feature notice for the source-stability wrapper. Those notices remain in the raw logs; no warning suppression was used.
- TypeScript passed under the project's existing `strict: true` configuration, including its existing `skipLibCheck: true`. This proves the configured application/test/script compilation; it does not claim checking every dependency declaration.
- The bundle budget and IP scan passed their existing engineering checks. The IP report retains its 113 tolerated internal identifiers; no broader legal clearance is implied.
- This worker ran no unit tests, native/browser cases, or benchmarks, and makes no FPS, physical-GPU, memory, or whole-engine performance claim. Those separate assignments are not counted again here.

All source/docs/scripts/config and Git publication remain root-owned. Worker50 changed only its external runner/handoff/evidence and the authorized generated production dist. No authored models, characters, environments, geometry/material/texture assets, or vehicle tuning were edited.
