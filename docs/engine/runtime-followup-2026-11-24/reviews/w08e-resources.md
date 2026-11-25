# Worker47 / W08E — adversarial resource ownership review

Complete. **COMPUTE and BROWSER were explicitly released.** Root owns staging, commits, publication and the shared ledger; this worker performed no Git mutations. Production source is frozen in the four files below. No authored model, character, environment, geometry/material/light/texture definition, asset, quality setting or tuning was changed.

## Changes and reproduced defects

Working source started at published `6314ba3ec7d54a0ba1e79a59b8db8f03117e4520`. The original task baseline is `1c609bfa7006ee2c51a32a97f1fedd61c6c1bfcb`.

| File | Narrow change |
| --- | --- |
| `src/rendering/texture-budget.ts` | Unregister removes a generated wrapper from every budget ownership index before invoking its disposal listeners; a `finally` restores its original Source. The whole root continues releasing other imported/generated/detail wrappers and rethrows the first failure, including `undefined`. |
| `src/rendering/imported-texture-budget.ts` | Unregister removes its wrapper from the asset set and source indices before callbacks, then restores the original Source and foliage mipmap ownership in `finally`. Live shared siblings stay registered. |
| `src/rendering/assets/texture-source-ownership.ts` | Exclusive decoded bitmap cleanup proceeds after a texture-disposal callback failure. Cache-owned source/image aliases remain borrowed. The first thrown value wins if later image cleanup also fails. |
| `src/rendering/renderer.ts` | Only `releasePlanting` changed. It attempts the existing planting owner after budget unregister reports an error and preserves the first failure if that owner also throws. |
| `tests/engine-resource-adversarial.test.ts` | Ten real-Three event cases cover throwing removal with live shared siblings, reentrant whole-budget disposal during removal, partial registration failure followed by explicit close/reuse, exclusive versus shared bitmap cleanup, and the actual renderer planting-release callsite. |

The previous generated unregister invoked `Texture.dispose()` before deleting its live asset entry. Imported unregister removed `registered` first but retained its asset membership until after disposal. Therefore either path could encounter a listener that closed the containing budget and dispose the same wrapper twice. A listener that threw instead prevented original-source restoration, left stale live ownership, and stopped the remaining root cleanup.

Tests attach listeners through real Three `addEventListener('dispose', ...)` and use actual `Texture`, `CanvasTexture`, `Source`, mesh/material and `EventDispatcher` behavior. Synthetic canvas contexts and bitmap close spies isolate CPU ownership; these tests do not pretend to allocate WebGL resources. There is no recursive registration fixture.

The first focused run reproduced **7 failures / 3 passes** on the published pre-fix source. A read-only Vite source overlay loaded six exact modules using `git show` from the original task baseline: both budget modules, their foliage helper, source-ownership helper, renderer, and planting ownership helper. Its selected eight cases reproduced **the same 7 failures / 1 pass**. These are inherited lifecycle defects, not regressions first introduced by the new batching change. Other dependencies remained the installed/current test environment; this was not a full historical checkout.

After fixing only the two budgets, a second run passed seven cases but still failed the three helper/caller cases. In particular, map sources were now restored but `releasePlanting` still never reached the tier owner. This intermediate run establishes that the renderer change adds a useful independent release, rather than merely masking the budget failure.

The final ten cases pass. They establish that:

- A failed unregister restores original sources and foliage ownership, retires removed generated/imported/detail wrappers, continues the remaining root, and preserves an `undefined` first failure before a later `Error`.
- A retained shared sibling remains on its same budget Source and image immediately after removal, continues accepting later quality changes, and restores its original source when finally disposed.
- A removal listener that closes the containing budget does not revisit the wrapper whose removal is already in progress.
- Both budgets already supported an interrupted acquisition followed by explicit `dispose()` and fresh registration; those two control cases passed before and after. Automatic rollback or a retry without explicit close is not claimed.
- An exclusive bitmap is closed once even when its texture callback throws. Marked shared pixels survive, including an alias with a separate Three Source.
- The real `RacingRenderer.releasePlanting` now invokes the existing tier owner after budget failure. The successful tier-owner case releases geometry/material/texture and clears/detaches the tier. The later-owner-failure case proves the attempt and preservation of the first failure, not a complete drain of that owner's internals.

## Validation

All commands were run in `/tmp/engine-c71f32882729/repo`, directly through installed executables. No npm pretest/prebuild/dev hook ran.

### Before / baseline / intermediate

```sh
NODE_OPTIONS=--max-old-space-size=512 node node_modules/vitest/vitest.mjs run tests/engine-resource-adversarial.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --allowOnly=false --retry=0
```

Before: 7 failed / 3 passed, 6.83 s. Raw log: `/tmp/engine-c71f32882729/w08e-before.log`.

Same command after budget-only changes: 3 failed / 7 passed, 6.58 s. Raw log: `/tmp/engine-c71f32882729/w08e-budget-only.log`.

Actual baseline source selection was configured in `/tmp/engine-c71f32882729/w08e-baseline.vitest.mts`:

```sh
NODE_OPTIONS=--max-old-space-size=512 node node_modules/vitest/vitest.mjs run tests/engine-resource-adversarial.test.ts --config /tmp/engine-c71f32882729/w08e-baseline.vitest.mts --pool=threads --maxWorkers=1 --minWorkers=1 --allowOnly=false --retry=0 -t 'removes a throwing|does not release the same|finishes decoded-image|releases a planting'
```

Baseline result: 7 failed / 1 passed / 2 unselected, 6.57 s. Raw log: `/tmp/engine-c71f32882729/w08e-baseline.log`. The two partial-registration controls were deliberately excluded because the old standalone imported API accepted one texture rather than an iterable. After testing, the planting test title was clarified to **“attempts planting release”**; use `|attempts planting release` instead of `|releases a planting` to repeat that selected baseline command against the final file. This was only a test-title edit; all assertions are unchanged. The pending consolidated gate will test the final file bytes.

### Final focused gate

```sh
NODE_OPTIONS=--max-old-space-size=512 node node_modules/vitest/vitest.mjs run tests/engine-resource-adversarial.test.ts tests/engine-texture-budget-registration.test.ts tests/texture-budget-source-refresh.test.ts tests/canvas-texture-budget.test.ts tests/engine-renderer-texture-composition.test.ts tests/engine-renderer-exclusive-release.test.ts tests/texture-source-ownership.test.ts tests/vegetation-quality-transition.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --allowOnly=false --retry=0
```

**67/67 passed across 8 files, 51.23 s.** The 22-case vegetation transition file exercises the real renderer settings paths and was explicitly recommended to worker49's consolidated gate. Raw output: `/tmp/engine-c71f32882729/w08e-focused.log`.

```sh
NODE_OPTIONS=--max-old-space-size=4096 node node_modules/typescript/bin/tsc --noEmit
NODE_OPTIONS=--max-old-space-size=512 node node_modules/eslint/bin/eslint.js src/rendering/texture-budget.ts src/rendering/imported-texture-budget.ts src/rendering/assets/texture-source-ownership.ts src/rendering/renderer.ts tests/engine-resource-adversarial.test.ts
node node_modules/prettier/bin/prettier.cjs --check src/rendering/texture-budget.ts src/rendering/imported-texture-budget.ts src/rendering/assets/texture-source-ownership.ts tests/engine-resource-adversarial.test.ts
git diff --check
```

All exited 0. TypeScript and scoped ESLint logs are `/tmp/engine-c71f32882729/w08e-typescript.log` and `w08e-eslint.log` (empty on success). Prettier reported all matched files compliant. The renderer was not reformatted wholesale; its only diff is the lifecycle method shown above.

### Native WebGL refresh

Because generic release ordering changed, reran the existing four native-resource cases against the modified source, without modifying those fixtures:

```sh
PLAYWRIGHT_BROWSERS_PATH=/tmp/engine-c71f32882729/browsers NODE_OPTIONS=--max-old-space-size=512 node node_modules/@playwright/test/cli.js test e2e/engine-native-resources.spec.ts --config /tmp/engine-c71f32882729/w08e-native.config.mts --workers=1 --retries=0
```

The scratch config imports the existing `native.config.mts` and only gives this run distinct output/report destinations. **4/4 passed, 4.9 s, zero retries, skipped cases or flaky cases.** Native backend: `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)`.

| Evidence | Refreshed result |
| --- | --- |
| Shared registration | 1,025 wrappers; 3 canvas draws; 1,025 wrapper version increments; 3 source groups and 3 actual WebGL texture allocations |
| Native pixels | Zero CPU-canvas byte differences and zero rendered byte differences for all three groups; hashes match independent references |
| Late repaint/restoration | Yellow `[255,255,0,255]` repaint retained; original full-size canvases and all original sources restored; zero texture/geometry/program counters after texture-fixture cleanup |
| Borrowed Festival renderer | Six cycles; active counts 5 textures / 6 geometries / 7 programs / 8 program references, returning to the same 1 / 2 / 4 / 4 retained probe+backend counts every cycle; green probe continues drawing; backend disposal count 0 |
| Exclusive circuit renderer | Both imported/generated throwing-listener cases preserve the first `undefined`, restore all four sources before the later owner, restore foliage mipmaps, release tracked output/sky/shadow/composer resources, and dispose the backend exactly once |
| Native errors | GL error 0 and no context loss in all cases |

Circuit retained geometry/program counters are the identified private Three VSM resources (1 geometry, 3 programs), as in w06d; the fixture identifies and separately releases those backend internals. No claim is made that all production renderer counters are zero after backend disposal.

Native raw evidence:

- `/tmp/engine-c71f32882729/w08e-native.log`
- `/tmp/engine-c71f32882729/w08e-native-report.json`
- `/tmp/engine-c71f32882729/w08e-native-metrics.json` — decoded JSON attachments, retained in full
- `/tmp/engine-c71f32882729/w08e-native.config.mts`

## Existing performance evidence and scope limits

Read w07f's count/semantic report and w06d's native report before editing. Registration, grouping, resampling, refresh, filtering and quality paths were not changed. Existing shared-group/late-repaint tests passed again. **Baseline already shares GPU storage. Initial registration disposal events still increase from `N + groups` to `2N` under the batched implementation. No GPU-allocation reduction, hardware speedup, FPS, GC or whole-engine performance gain is claimed.** W07f remains a scalar registration-CPU measurement, and this worker did not rerun its timing experiment.

The refreshed native run proves the existing scenarios still work with the changed source. It does not add native coverage for the new unregister fault cases or prove physical-GPU performance; those new faults use real Three CPU events with synthetic images.

Three EventDispatcher invokes listeners sequentially without catching listener exceptions. A listener installed before Three's own WebGL release listener can prevent that later listener from running for the same resource. Retiring budget bookkeeping and restoring sources does **not** repair such interrupted vendor GPU bookkeeping. Existing native faults are installed after upload, so Three's native release listener is ahead of the throwing listener.

Per root's strict scope decision, `BikeShells`, `disposeCircuitPlanting`, Festival implementation and vendor internals were not modified. The existing planting helper can still stop partway through its own resources after an internal callback throws; the renderer now guarantees its release is attempted and preserves the first error. BikeShells' uninstall callsite likewise retains its earlier callback-fault limitation. Source inspection also notes internally sequential Three LightShadow/EffectComposer/OutputPass cleanup; this work does not claim all of their internal fault combinations are drained. The passing native cases and unit tests should not be generalized beyond their explicit callback ordering.

## Final source fingerprints

| File | SHA-256 |
| --- | --- |
| `src/rendering/texture-budget.ts` | `0608ec25f11f35f008c2f27429235f8031ae097b5a2b799db737c2ccf45a97c5` |
| `src/rendering/imported-texture-budget.ts` | `abbbe4ed5b79171d37392bd83c875d23c8cdf26385cf684694af1a266ee67fb3` |
| `src/rendering/assets/texture-source-ownership.ts` | `99f29f752164d820ea47b87725857d1ad0854abd4ee1d494c4511c277dab3cbb` |
| `src/rendering/renderer.ts` | `98a7b744489f5ad5d60e224b71d649e7aed825f9ea8a9333c53f00e72d896fbf` |
| `tests/engine-resource-adversarial.test.ts` | `ff2ce98448e0d538cc3ba7d112878322a929c668862774b4a111b68af3ac8e7d` |

Root can publish the five source/test files and relevant evidence. Worker49 has the scope and the concrete adjacent gate recommendation. No further optional testing is requested.
