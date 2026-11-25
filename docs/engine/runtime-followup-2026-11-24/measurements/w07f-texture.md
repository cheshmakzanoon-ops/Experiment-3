# Wave 7: texture registration measurement

Worker42 measured the actual committed baseline and current texture-budget modules. The operation checks and source-lifecycle checks passed. Registration CPU time improved in all 36 measured pairs on this controlled Node fixture. No production source, authored content, assets, material definitions or tuning changed in this assignment.

Full counters, every warmup and measured duration, source hashes, dependency hashes and reused native observations are in [w07f-texture.json](w07f-texture.json).

## Measured operation counts

Each case registers 1,024 distinct Three.js wrappers. Each wrapper appears in both `map` and `alphaMap` slots of real materials. Authored fixture images are 1,024 × 512 scalar canvas doubles; the configured limit is 128 and anisotropy is 2. Imported fixtures use opted-in immutable, canvas-backed `Texture` objects with `flipY=false`.

| Case | Canvas draws, baseline → current | Wrapper version increments, baseline → current | Budget sources / canvas copies, both versions |
| --- | ---: | ---: | ---: |
| Generated, one shared group | 1,024 → 1 | 524,800 → 1,024 | 1 / 1 |
| Imported, one shared source | 1 → 1 | 524,800 → 1,024 | 1 / 1 |
| Mixed, six groups | 642 → 6 | 94,720 → 1,024 | 6 / 6 |

The imported baseline already drew its immutable image once. Its saving is repeated wrapper-update and registration work. Generated clear calls fall from 1,023 to zero; mixed clear calls fall from 636 to zero. Context-request counts equal the draw counts shown above. The old wrapper-update total is the sum of `n × (n + 1) / 2` over groups; current registration updates each wrapper once. Every wrapper delta and every owned source version was checked, independently of timing.

The mixed case has four authored sources: generated A has groups of 256 ordinary wrappers, 128 scale-2 wrappers and 128 CPU-readback wrappers; generated B has 128 ordinary wrappers; imported A and B each have 192 wrappers. The scale-2 copy is 256 × 128; all other copies are 128 × 64. The CPU-readback group requests `{ willReadFrequently: true }` when its copy context is created.

Both implementations already share source storage. The number of budget copies is unchanged; this report makes no GPU-allocation reduction claim.

### Initial disposal-event tradeoff

| Case | Baseline events | Current events |
| --- | ---: | ---: |
| Generated shared | 1,025 | 2,048 |
| Imported shared | 1,025 | 2,048 |
| Mixed six groups | 1,030 | 2,048 |

These are observed `Texture.dispose()` event dispatches during the initially resized registration. Baseline emits `N + groupCount`: each wrapper changes source, and the first wrapper in each group also receives the initial resize release. Current batching acquires all wrappers before resizing and emits `2N`. Logical disposal events do not count GPU objects allocated or deleted. Both versions emit zero draws, updates or disposal events when the same root is registered again. Final budget disposal restores every source and emits one event per wrapper; repeated disposal is idle.

## Paired CPU timing

Only `TextureBudget.register(root)` is timed. The canvas double propagates a scalar paint marker and performs no rasterization, pixel copying or GPU work. Instrumented counting runs in separate proof processes. Timed processes use an uninstrumented double and the real Three.js classes and engine traversal.

Each case has separate fresh baseline and current processes. Six alternating warmup pairs execute 96 fresh registrations per implementation before twelve alternating measured pairs execute another 192. Only one child executes a sample at a time. Fixture creation, budget setup, explicit GC before each sample, correctness checks, disposal, IPC and serialization are outside the registration intervals. No steady-state/JIT acceptance criterion is imposed.

The table reports the median of twelve sample means; each sample contains sixteen individually timed registrations. Parentheses give the full range of sample means. All elapsed times are milliseconds per registration.

| Case | Baseline median (range) | Current median (range) | Median paired change | Current faster pairs |
| --- | ---: | ---: | ---: | ---: |
| Generated shared | 5.178205 (4.631243–5.521196) | 2.168810 (1.872212–3.409115) | −58.19% | 12/12 |
| Imported shared | 7.722778 (7.373446–10.444107) | 1.873924 (1.550761–2.676056) | −76.34% | 12/12 |
| Mixed six groups | 4.107166 (3.684429–4.362904) | 2.557878 (2.309980–2.953877) | −36.31% | 12/12 |

Individual measured registration ranges were baseline/current: generated 3.340594–24.787193 / 1.074003–11.390362 ms; imported 5.692212–30.658137 / 1.031560–6.430197 ms; mixed 1.855212–21.026062 / 1.114673–9.730822 ms. No outlier was discarded. Both execution-order groups have negative median paired changes in all three cases. The JSON retains their separate distributions and all warmups.

These are one-host Node registration measurements. Native canvas cost, GPU time, browser latency, whole-game frame time/FPS, physical-hardware performance and GC/allocation-rate changes were not measured. Runtime pauses inside registration remain included; CPU affinity, frequency and JIT tier are uncontrolled.

## Source and lifecycle semantics

Both actual implementations passed checks for unchanged authored sources and unregistered external clones, distinct resolution/readback groups, filtering, repeated registration, full-resolution restoration, unregistering, rejoining a live group, disposal and budget reuse.

After repainting the original generated canvas, two late clones join the existing ordinary group and reuse its source and copy. Their registration draws twice in baseline and once in current; the whole late fixture has nine versus six version increments. Other resolution/readback copies keep their previous paint until explicit `refresh`. That refresh repaints all three generated groups once, invalidates all six affected wrappers once, leaves unrelated/imported sources untouched and emits no disposal event. A later size change releases all nine live wrappers while their previous widths are still visible, then retains source identities through replacement. These checks observe scalar paint propagation and ownership, not native pixels.

## Reused native evidence

The [Wave 6 native artifact](../validation/w06d-metrics.json), retained at commit `0f7fecfda61ea7e669f04eebd138c52543144421`, was reused after checking all three candidate module hashes. The browser suite was not rerun, and baseline native pixels were not directly compared in this assignment.

The retained ANGLE/SwiftShader case registers 1,025 wrappers across three groups, performs three native canvas draws and 1,025 version increments, and uploads three shared GPU textures. Native canvas and GPU outputs differ from independent references in zero bytes. Late repaint produces the exact yellow pixel `[255, 255, 0, 255]`; full-quality restoration returns the authored images; cleanup returns textures, geometries and programs to zero with no GL error or context loss. Separate generated/imported listener-failure cases restore every source and foliage setting, retain a first thrown `undefined`, and release all scene textures.

## Provenance and reproduction

- Baseline: `1c609bfa7006ee2c51a32a97f1fedd61c6c1bfcb`.
- Candidate engine: `f4d41b0c00fa7b69f35ba1b1f48b67541e3749b6`.
- Measurement: 2026-11-25, 03:28:23–03:28:38 UTC; Node 24.22.3, V8 13.6.233.17-node.63, esbuild 0.25.12, Three.js 0.180.0; Linux 6.18.57/x64; AMD EPYC 9V74 host, nine exposed logical CPUs; 384 MiB old-space cap per child.
- Both implementations and their complete texture-budget dependencies come from `git show`, with no reconstructed baseline. Current target files equal the native-evidence commit byte for byte. `foliage-mipmaps.ts` is unchanged between baseline and current.

| Module | Baseline Git blob | Current and native-evidence Git blob |
| --- | --- | --- |
| `texture-budget.ts` | `a5a7c025830257253a45375008aa611ff6caee87` | `35f76548eb3d78471c62ab67f6bd48e46251454c` |
| `imported-texture-budget.ts` | `f15934fbd975e965fd2a20a4ced5bb26d83eae42` | `38ab7945c09891b251e43aedc558e72a8c76ee40` |
| `foliage-mipmaps.ts` | `d2a24c06c17ea40acfdd598bb723e4da1bfa86dd` | `d2a24c06c17ea40acfdd598bb723e4da1bfa86dd` |

Run from the repository root while other benchmarks, builds and browser suites are idle:

```sh
node --max-old-space-size=384 scripts/bench/engine-followup-texture.mjs \
  --baseline 1c609bfa7006ee2c51a32a97f1fedd61c6c1bfcb \
  --candidate f4d41b0c00fa7b69f35ba1b1f48b67541e3749b6 \
  --evidence-commit 0f7fecfda61ea7e669f04eebd138c52543144421 \
  --output docs/engine/runtime-followup-2026-11-24/measurements/w07f-texture.json
```

Final scripts were formatted, syntax-checked and focused-linted before the single full measurement. Their recorded SHA-256 values still match the delivered files. No npm install, pretest/prebuild hook, production-source edit, staging or commit was performed.
