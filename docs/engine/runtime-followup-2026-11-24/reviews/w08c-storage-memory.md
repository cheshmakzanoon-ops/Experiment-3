# Worker 45 / w08c — storage review and measured CSV chunk ownership

## Result

Retain the narrow production change in `src/storage/telemetry-schema.ts`: completed 500-row groups become native `Blob` parts immediately instead of retained CSV strings. Only two runtime lines and one explanatory comment changed. The existing header, fields/order, `String(number)`, line endings, final MIME, shape/finite validation, worker transfer and cancellation behavior are preserved.

Independent recorder/replay/ghost/export lifecycle review found no additional demonstrated defect, so no other production files were edited. WAVE-05/06 and worker40's source/raw/native/manifest evidence were reviewed. No authored content, tuning, schema/channel/version, git index, commit or remote state was changed by this worker.

## Acceptance evidence

- Actual old source: `f4d41b0c00fa7b69f35ba1b1f48b67541e3749b6`; CSV is also byte-identical to task baseline `1c609bfa7006ee2c51a32a97f1fedd61c6c1bfcb`.
- Actual current working-tree dependencies were bundled and hash-checked; only `telemetry-schema.ts` differs among imported production sources. No rewritten function or guessed baseline.
- Old schema Git blob `436ceef36e345d39981b9ba920abea441929e647`, SHA-256 `3eaeeeaf3d870ced27977df037b848dc2ddee1f2bdd77cf6c80cc3fdc625223a`.
- Measured current schema Git blob `3d3636a3d8e69c5dd9498300c519642e33598034`, SHA-256 `ed5e98ae1cc8728ed8b5ad8209ab594351cc613c7b5708c35b0b9d86da342894`.
- Input: real default 54,000-row recorder; ring and independent snapshot each 49,248,000 bytes; unchanged worker40 deterministic suffix starting at row 243. No 216,000-row allocation.
- **18/18 default-size exports compare every output byte exactly**, comprising ten uninstrumented Node exports, two separately observed Node exports and six actual browser worker exports.
- Exact CSV: **115,038,761 bytes**, SHA-256 `cfc38f4dd65c878d824866c817e65511b1287161c525e3c8cafaed9bf7ad0d9b` in all Node exports; zero differing bytes throughout.
- Every native sender detaches its snapshot, live recording adds 120 rows, continued chronology has zero differing values, one worker terminates per job and there are no page errors.

### Node, kept separate from browser

Five sequential fresh-process pairs, alternated order, three 600-row warmups, explicit GC outside timers, 768 MiB old-space limit. Every full CSV sample includes actual formatting/native Blob construction and excludes exact verification.

| Metric | Baseline | Current |
| --- | --- | --- |
| Median encode | 2,210.919 ms | 1,801.424 ms |
| Encode full range | 2,095.364–2,652.048 ms | 1,694.839–1,886.763 ms |
| Median process maxRSS read immediately after export, before verification | 628.602 MiB | 370.602 MiB |
| Same maxRSS full range | 627.922–629.535 MiB | 368.082–471.395 MiB |

Median high-water RSS is 258 MiB / 41.0% lower. These are process high-water observations including startup/fixture/warmups, not exact peak live memory. Both high candidate RSS samples remain in the raw evidence. All five candidate latency samples were faster than their paired baseline. Independent medians differ by 18.5%; paired current/baseline latency median is 0.843253 (different statistic).

Separate constructor-observer runs retain scalar observations only, do not retain parts and never GC inside export. At final assembly, baseline has 109 strings totaling 115,038,761 code units; current has one 2,859-code-unit header plus 108 data Blobs containing 115,035,902 bytes. Final pre-constructor `heapUsed` is 198,424,608 → 32,048,448 bytes. Largest discrete sampled `heapUsed` is 198,424,608 → 79,855,664 bytes. These are sampled Node heap observations, not exact peaks or browser memory.

After GC with ring/input/output retained, `arrayBuffers` is the same 214,949,478 bytes in both. After output release it is the same 99,910,717 bytes: the output payload still costs 115,038,761 bytes. This is earlier string reclamation, not constant-memory streaming. RSS/heap/external/arrayBuffers categories are never added.

### Native browser

Three cold-worker pairs in fresh contexts/pages of Chromium 140.0.7339.186. Actual production exporter/worker, native Blob composition and native transfer; only Vite worker construction is adapted. Browser peak memory **not measured**.

| Pair | Baseline completion | Current completion |
| --- | ---: | ---: |
| 0 | 1,676.0 ms | 1,534.8 ms |
| 1 | 1,976.4 ms | 1,656.7 ms |
| 2 | 1,670.4 ms | 1,561.0 ms |
| Median | 1,676.0 ms | 1,561.0 ms |

Every candidate sample faster; median paired current/baseline ratio 0.915752. No universal browser memory, maximum-capacity, physical hardware or FPS claim.

## Regression and lifecycle gates

New `tests/engine-telemetry-chunk-storage.test.ts` has 21 meaningful cases: empty/1/499/500/501/999/1000/1001 rows; exact Float32 spelling with signed zero/subnormal/maximum values; malformed shapes rejected before Blob work; nonfinite values at later group boundaries without partial publication; valid recovery; nonzero input offsets; output unaffected by source mutation/detachment and Blob cloning; bounded retained CSV strings at final assembly without private-loop/call-count assertions.

Baseline (before production edit): **20/21 pass, 1 expected retention failure** — 4,157,741 string code units retained for 1,001 rows versus 2,859 header bound. Full expected failure JSON retained.

Current: **87/87 pass across four files**, zero retries:

```sh
NODE_OPTIONS=--max-old-space-size=512 node node_modules/vitest/vitest.mjs run \
  tests/engine-telemetry-chunk-storage.test.ts \
  tests/telemetry-export.test.ts tests/telemetry-export-lifetime.test.ts \
  tests/recording.test.ts \
  --pool=threads --maxWorkers=1 --minWorkers=1 --allowOnly=false --retry=0 \
  --reporter=json \
  --outputFile=docs/engine/runtime-followup-2026-11-24/measurements/w08c-unit-current.json
```

Baseline used the same command with only the new test file and `w08c-unit-baseline.json`, while schema still had old source hash.

Native existing transfer/cancellation/replacement/invalid-shape/recovery gate: **2/2 pass**, zero retries:

```sh
PLAYWRIGHT_BROWSERS_PATH=/tmp/engine-c71f32882729/browsers \
NODE_OPTIONS=--max-old-space-size=512 \
node node_modules/@playwright/test/cli.js test \
  --config=/tmp/engine-c71f32882729/w08c-native.config.mts \
  e2e/engine-native-recording.spec.ts --grep 'native CSV'
```

The separate scratch config is retained at `/tmp/engine-c71f32882729/w08c-native.config.mts`; it uses the existing self-routed fixture, one worker, original 60-second timeout, zero retries, separate w08c output and JSON reports. The 600-row transfer preserves exact 1,268,138-byte output / SHA-256 `120e22a8e14c8efe4f2ff77b7e952f33abb8c8f33e209c09b0fcb3493bbe5298`; all five replacement/recovery workers terminate once.

Scoped ESLint exit 0 on production file, new test and two scripts. `git diff --check` exit 0. No whole-project compiler/build was run; root owns combined gates. No optional repeated benchmarks were performed.

## Files to publish

Production/test/scripts:

- `src/storage/telemetry-schema.ts`
- `tests/engine-telemetry-chunk-storage.test.ts`
- `scripts/bench/engine-followup-csv-memory.mjs`
- `scripts/bench/engine-followup-csv-memory.runner.mjs`

Evidence, all under `docs/engine/runtime-followup-2026-11-24/measurements/`:

- `w08c-csv-memory.md` (substantive report, limits, all pair samples and reproduction)
- `w08c-csv-memory-raw.json`
- `w08c-csv-memory-manifest.json`
- `w08c-csv-memory-timed-bundles.tar.gz` (six exact executed bundles, 300,444 bytes)
- `w08c-unit-baseline.json`
- `w08c-unit-current.json`
- `w08c-native-tests.json`

The new harness imports worker40's unchanged `engine-followup-telemetry.fixture.mjs` and `engine-followup-telemetry.browser.mjs`; publish those wave-7 files as already planned. Their exact hashes are recorded. All current imported production hashes and harness hashes were rechecked against measurement before creating the manifest/archive. No source/harness formatting after measurement. Worker40 raw, browser and manifest evidence hashes remain unchanged.

Reproduction from repo with existing dependencies (exclusive compute/browser lease required):

```sh
PLAYWRIGHT_BROWSERS_PATH=/tmp/engine-c71f32882729/browsers \
node --max-old-space-size=768 scripts/bench/engine-followup-csv-memory.mjs \
  --repo /tmp/engine-c71f32882729/repo --mode all \
  --output /tmp/csv-memory.json --work-dir /tmp/csv-memory-work
```

Scheduled measurement interval: `2026-11-25T03:45:39.749Z`–`03:47:08.984Z`. COMPUTE and BROWSER explicitly released to root after native/lint gates; worker46 was notified. All remaining work was report/hash/archive authorship. No git mutations.
