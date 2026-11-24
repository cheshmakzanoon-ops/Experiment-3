# Engine development: independent scope audit

## Finding and boundary

**No out-of-scope model, character, authored environment, material-definition, or vehicle-tuning edits were found in the reviewed changes.** This report combines agent 51's original source/content inspection and agent 60's final publication audit. The final production boundary is `b282f121b5766df26466d413d2c685b2f826799d`. Runtime code that loads, uses, schedules, or releases existing resources has changed; the resources and their authored definitions have not.

The baseline is `a0ae513e7982f0b4719296519752e0ae5f1983f8`. Agent 51's first audit covered committed work through `9dc4811ff986e9b410bdcfb5f631db19130ce95f` and the six then-pending wave-8 source files listed below. Agent 60's final refresh extends the protected-object and runtime-scope checks through all ten waves at `b282f121b5766df26466d413d2c685b2f826799d`, tree `1472d9c28a270af720507d90f490d52ff5ca1fbb`. All six original checkpoint blobs remain exact matches at that final boundary. This report does not pre-approve later production changes.

| Then-pending source file at agent 51's initial checkpoint | Git blob ID retained at final publication |
| --- | --- |
| `src/net/client.ts` | `7e728a2c8a5f4cad785be9a29cf86be5649609c9` |
| `src/net/event-loop.ts` | `4d14913956f6094e55bfc205005d7e99d8add99b` |
| `src/net/guards.ts` | `9278d741b6bab511b3093e2a0fa72fab1a16fb7d` |
| `src/net/input.ts` | `8d19f61a1c5123e1703d690cbe5c5e847dca7bad` |
| `src/net/transport.ts` | `f5e9e8f491077651619479bd0dbf08fc38281f86` |
| `src/simulation/open-world/route-path.ts` | `6cd11b85ecfcb7bad14ae5867cd2b9426e789c82` |

Agent 51's baseline-to-worktree diff contained 53 changed or added production source files. The final published production boundary contains 54 such paths; the additional path is networking lifecycle code in `src/net/server.ts`. Other changes are tests, engineering documentation, measurement tooling and existing CI-generated reports, with no model or authored-environment additions.

## Final publication refresh — agent 60

**Scope audit passed for the final production commit.** Agent 60 independently retrieved the complete Git trees for the original baseline and the final published source through the repository API. Both recursive responses reported `truncated: false`.

| Boundary | Git object |
| --- | --- |
| Original engine commit | [`a0ae513e7982f0b4719296519752e0ae5f1983f8`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/a0ae513e7982f0b4719296519752e0ae5f1983f8) |
| Original tree | `3e5dd0888f193dbde62f6ce5cdebdd1c2ee9847c` |
| Final production commit | [`b282f121b5766df26466d413d2c685b2f826799d`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/b282f121b5766df26466d413d2c685b2f826799d) |
| Final production tree | `1472d9c28a270af720507d90f490d52ff5ca1fbb` |

The baseline contains 9,545 blob paths and the final production tree 9,640. Their union contains 174 added, removed or changed paths, including 54 production-source files and 60 unit-test suite files. These totals include automated report changes and are specifically bounded to the final production commit; subsequent evidence-only commits can add reports without changing the tested engine.

Every protected group in the tables below retains exactly the baseline path inventory, file modes and blob IDs. All eleven sorted-manifest SHA-256 values were independently regenerated from the final tree and match the original audit. This includes all 2,996 asset-extension files, all 231 public files, all 44 public models, source JSON/assets, vehicle catalogue, selected protocol/default definitions and dependency/build configuration.

This final refresh verifies published Git objects. It does not claim another physical-filesystem rehash: the physical-file counts below remain agent 51's original checks. Agent 60's executor was unavailable, so this auditor used repository API contents and independent JavaScript comparisons rather than a local checkout or test process.

### Final runtime changes inspected

Only four production files differ between wave 9 and the final production commit:

| File | Final change reviewed | Final Git blob |
| --- | --- | --- |
| `src/main.ts` | `GameApp.dispose` revokes ownership before callbacks, attempts independent cleanup, stops the owned haptic device, disposes UI audio, and observes asynchronous replay cleanup rejection | `65ffeafc1c674b84dc75d9298c3c17dcdc1f1f49` |
| `src/session/free-roam.ts` | `FestivalSession.dispose` detaches owned children before callbacks and attempts all worker/session cleanup after a failure | `39cc4723ca05409ef09375860cb7e92deb7861cb` |
| `src/rendering/open-world/festival-renderer.ts` | `FestivalRenderer.dispose` detaches optional children, clears ownership arrays, and attempts all existing resource cleanup before rethrowing the first failure | `ad136d06d11bc7e6f9c09f909c9777e72a413dc0` |
| `src/net/server.ts` | Terminal phase/observer guards, independent connection/timer cleanup, and rejection/closure of transports offered to an already ended server | `83a04e11c1b2578b8938b41f77436ad0db4731c9` |

Agent 60 read the complete wave-9/final versions of those files. A read-only TypeScript AST extraction by agent 59 identified the exact three `dispose` method ranges. Agent 60 then removed only those ranges from the independently fetched file contents and compared the entire remainders. All three complete remainders were identical, with matching independently calculated SHA-256 values:

| Class | Other class members preserved | SHA-256 of complete file with only `dispose` removed |
| --- | ---: | --- |
| `GameApp` | 197 | `35b0b8fe1fd544cb6290efaa7a00c5fa9cacb70922b670aa160c7e143ad4c95d` |
| `FestivalSession` | 51 | `e981790660c4345cfb500b7b9fa64797d7f2ea8668c8aa9f463bfd14850fca83` |
| `FestivalRenderer` | 108 | `4243072061061d7f21bf86262ed77c4896114805efb628a41f7fe4d03b00e1f4` |

The AST parse had no diagnostics and found one named class and one `dispose` method in each version. The protected remainder includes constructors, scene construction, material values, model/vegetation selection, placement, update/draw methods and all other text outside the method. Resource disposal intentionally changes terminal behavior; it does not edit authored resource definitions. The server changes operate on transport, phase and callback ownership, without editing simulation dynamics, message schemas, vehicle specifications or art.

### Evidence-source continuity

All nine recorded source files behind the actual-module operation-count comparison retain their measured wave-7 blob IDs. All four route-measurement source files retain their measured wave-8 blob IDs. Every one of the 189 `src/core/` and `src/simulation/` files used by the same-tick determinism receipt retains its wave-8 mode and blob ID, with no additions or removals. These checks carry forward the recorded input identity; they do not claim another benchmark or simulation execution.

The final [regression inventory](ENGINE_REGRESSION_INVENTORY_2026-11-24.md) preserves the original frozen working-tree test boundary, then records agent 58's independent mapping of all 1,074 production inputs, 851 test inputs and four configuration inputs to the published final tree. Agent 60 independently confirmed those path counts, the exact 60-suite selection, the receipt's case/attempt accounting, and the SHA-256 content hashes of all four final production files against that frozen receipt. The [completion audit](ENGINE_COMPLETION_AUDIT_2026-11-24.md) separates those results from native-browser and broader CI evidence.

## Content-integrity checks

Agent 51 compared baseline and current Git tree objects, inspected the working-tree diff, checked the protected public/source-asset index entries, and recomputed Git blob hashes from every physically present file in the groups below. Agent 60 independently rechecked the complete published path/mode/blob inventories at the final production commit and regenerated every manifest digest. Each group matched the baseline exactly at both checkpoints. Physical rehash counts are the original agent-51 counts. Groups overlap; their counts must not be added together.

| Protected content group | Tracked files, also unchanged at final publication | Originally physically rehashed by agent 51 | Result |
| --- | ---: | ---: | --- |
| Complete `public/` directory | 231 | 231 | Identical |
| `public/models/`, included in the row above | 44 | 44 | Identical |
| Asset-extension files across the full repository | 2,996 | 279 | Identical Git objects; present files also identical |
| All JSON and asset-extension files under `src/` | 58 | 58 | Identical |
| Rendering sources outside the 13 reviewed runtime files | 695 | 695 | Identical |
| Simulation sources outside the seven reviewed runtime files | 167 | 167 | Identical |
| `src/simulation/vehicle-catalogue/` | 16 | 16 | Identical |
| Open-world simulation modules outside route search and tile-cache runtime changes | 33 | 33 | Identical |
| Package manifest, dependency lock, Vite configuration, TypeScript configuration | 4 | 4 | Identical |
| Selected protocol, telemetry-schema, and session-identity definitions | 6 | 6 | Identical |
| Input calibration, simulation defaults, graphics options, performance policy | 4 | 4 | Identical |

The repository uses sparse checkout. The 2,717 asset-extension files omitted from the working directory were checked by their tracked Git objects, not by claiming that missing local files were read. The asset-extension set was `.blend`, `.glb`, `.gltf`, `.gz`, `.obj`, `.fbx`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.ktx2`, `.hdr`, `.exr`, `.mp3`, `.ogg`, `.wav`, `.veg`, `.ttf`, `.woff`, `.woff2`, `.wasm`, `.svg`, and `.bin`.

The following aggregate hashes make the checked content sets explicit. Each SHA-256 digest covers sorted records of `mode + NUL + path + NUL + Git-blob-ID + newline`. Baseline, original-audit and final-publication digests were identical. Agent 60 independently regenerated all eleven values from the complete final Git tree.

| Content group | SHA-256 of content manifest |
| --- | --- |
| Complete `public/` | `b86dd5b10cc6dafd4e973e9ceadcf22acc6e3ef713ddd1c782599b48f2caf39f` |
| `public/models/` | `48024bf1dc61e16995eff4532148f456ab5eaa38fb86938437ae402a5e2b2b93` |
| Repository asset-extension files | `50a2bde344da7a928b0db67a0dd190ebb71b1d128550275e2340dde3be91297c` |
| Source JSON and asset-extension files | `53482b641bb910f3c386987a9fc44c9df4fdb8cc7bde5214e230612deac4e26d` |
| Unchanged rendering sources | `e8f409941ac0ad4fd10fec16df865e28570a7c0bc89369bbb43714b7b4f19b41` |
| Unchanged simulation sources | `8534f134a32e6ae0b2ce5a9fb4684489caaef48ac505a4969872439b63ec073d` |
| Vehicle catalogue | `2f9327d86f6b1c8e4150bde70fc30af9c53707f5c4209087058649180ef4a238` |
| Unchanged open-world simulation modules | `c14d9290fc2487654a8d84cb65f3da8b3c88ae0279a66e0d05f7adbed59131a0` |
| Package and build configuration | `84afba8ab00156ea90d0a90b45fd085dd18f7fd7abdaf13c09b602b979447d8e` |
| Selected protocol/schema definitions | `1e2128352ff767abeeaf1df813289f44e62ea8a0dc10bfd47c5bb4f1c7ab6652` |
| Selected defaults and policy | `e1975c0242b66f4fbaed80e2295d2f2c7609b9898ad84020ecd789371e482c14` |

For example, the Formula driver asset `src/rendering/apx01-driver.glb.gz` retained blob `86a29ef2e3f092c27b60e18cd2d3d143c42cdc99`, `human-kit.json` retained `ca5c0faf7a571306dde4bbf25a3b5bbe56629d61`, the dirt-bike model source retained `614c4ace6cb7a42feadb3599e8a0df6b19fe18ef`, and open-world region data retained `11b8c8d4e41f0bd64d23a44b845d12e7cb18bd83`.

## Mixed source files: runtime changes reviewed in context

Filename matching alone would be insufficient: some large runtime files refer to models and authored environments. Agent 51 reviewed their original diffs directly and used TypeScript syntax-tree extraction to compare named declarations and class members with the baseline. The following table records that initial inspection. The final refresh above separately covers the later three disposal-method changes and networking changes; it does not treat these filenames as unrestricted allowances.

| File or group | Inspected change | Content preserved |
| --- | --- | --- |
| `src/rendering/renderer.ts` | Cancellation checks in creation/preparation and resilient disposal of independently owned resources | Constructor, scene drawing, model-building methods, artistic parameters, camera behavior, and 213 existing named nodes were byte-identical. Only `create`, `waitForPreparedFrame`, `warmPitPresentation`, `prepare`, and `dispose` changed. |
| `src/rendering/open-world/festival-renderer.ts` | Deduplicated pending vegetation loads and disposal of late vegetation/detail results | Existing species selection, palettes, authored detail construction, world placement and rendering remained unchanged; 110 existing named nodes were byte-identical. |
| `src/rendering/open-world/terrain.ts` | Worker-listener ownership, cancellation, failed-send rollback and terminal failure handling | Tile geometry generation, material definition, resolution, tree density expressions and placement coordinates were unchanged. The `build` method remained byte-identical. |
| Environment, gain-map and texture loaders | Failure cleanup, cache-entry ownership, render-target/face/mipmap restoration | Asset selection, gain-map shader strings, texture sampling settings, scale, radiance equations and authored content were preserved. The PMREM path explicitly guards the existing Three r180 interface. |
| Mirrors and reflections | Idempotent disposal, restoration of borrowed bindings, attempt-all cleanup | Reflection capture, mirror updates, material values, target dimensions and existing quality choices were unchanged. |
| `texture-budget.ts` | Refresh every budget group sharing the same repainted source | Source assets, preset limits, scaling choices and material definitions were unchanged. Corrected refresh can update an existing runtime copy; it does not edit the authored source. |
| GPU frame/timer/pass-ledger infrastructure and preparation trace | Bounded query ownership, failure handling and cancellation | No meshes, shaders, environment definitions or quality presets were edited. |
| `src/simulation/vehicles.ts` | Added a private ID-to-index map and replaced a repeated `indexOf` lookup | All vehicle definitions, IDs, catalogue order, fallback vehicle and tuning remained unchanged. The only changed existing named declaration was `vehicleIndex`; 18 others were byte-identical. |
| `src/simulation/world.ts` | Scatter race rank once during snapshot serialization | Simulation stepping, setup and dynamics were unchanged. The only changed existing class method was `writeFrame`; field layout was preserved. |
| BVH, collision solver and oriented boxes | Deferred final contact detail work, conservative broadphase rejection and cached swept-query bounds | No model vertices, vehicle dimensions or authored geometry were edited. Contact-calculation changes still require behavioral equivalence testing; static scope review alone cannot establish it. |
| `src/simulation/open-world/terrain-tiles.ts` | Bounded pending cache work and corrected LRU/request lifecycle | Height generation, normal sampling, carving, road definitions and authored terrain content were unchanged. |
| `src/simulation/open-world/route-path.ts` | Replaced the directed-state linear selection scan with a decrease-key queue | `RoutePath`, geometry sampling, route assembly, road/region data and U-turn cost were unchanged. Only the existing `shortest` function changed; the queue class was added. Relaxation tolerance and state-index tie order were retained in the inspected code. |

The exact rendering exception list is: `assets/environment-loader.ts`, `assets/gain-map.ts`, `assets/texture-loader.ts`, `gpu-frame-gate.ts`, `gpu-timer.ts`, `mirrors.ts`, `open-world/festival-renderer.ts`, `open-world/terrain.ts`, `preparation.ts`, `reflections.ts`, `renderer.ts`, `texture-budget.ts`, and `ultra/pass-ledger.ts`, relative to `src/rendering/`.

The exact simulation exception list is: `bvh.ts`, `collision.ts`, `obb.ts`, `open-world/route-path.ts`, `open-world/terrain-tiles.ts`, `vehicles.ts`, and `world.ts`, relative to `src/simulation/`. These explicit exceptions were reviewed; their presence is not an automatic allowance for future changes anywhere in those files.

Production `shadow-proxies.ts`, character/rider/crew construction and animation sources, material libraries, vehicle-body sources, livery definitions, circuit content, vegetation definitions and authored scene kits remained unchanged. Updates to shadow-proxy tests did not change the production proxy implementation or any artistic budget.

## Protocols, dependencies and defaults

`package.json`, `package-lock.json`, `vite.config.ts`, and `tsconfig.json` were identical to the baseline. No dependency upgrade or authoring-script modification was part of the reviewed engine diff. The new performance benchmark script is measurement tooling.

The six checked protocol/schema files were `src/simulation/protocol.ts`, `src/workers/open-world-protocol.ts`, `src/workers/diagnostics.ts`, `src/net/constants.ts`, `src/storage/telemetry-schema.ts`, and `src/core/session-identity.ts`. Existing codec encoders and input packet read/write functions were also byte-identical under syntax-tree extraction. `messages.ts` retained its existing message interfaces/types. The decoder intentionally became stricter about malformed nested controls and the required reliable channel; claiming that all invalid-input behavior stayed unchanged would be incorrect.

The four checked defaults/policy files were `src/input/calibration.ts`, `src/simulation/config.ts`, `src/rendering/options.ts`, and `src/core/performance.ts`. `DEFAULT_BINDINGS` itself was unchanged; legacy saved-binding migration changed to allocate the clutch through the existing conflict-avoidance path. Audio cue definitions and synthesis parameters were retained while audio ownership, stopping, late completion and cleanup changed. No claim of identical runtime scheduling or identical invalid-input behavior is implied: those are explicit areas of engine improvement.

## Reproducing the scope check

Run from the repository root. These commands are read-only and do not invoke model-generation or package lifecycle hooks.

```sh
git diff --name-status a0ae513e7982f0b4719296519752e0ae5f1983f8 --
git ls-files --others --exclude-standard
git diff --exit-code a0ae513e7982f0b4719296519752e0ae5f1983f8 -- public package.json package-lock.json vite.config.ts tsconfig.json src/simulation/vehicle-catalogue src/simulation/protocol.ts src/workers/open-world-protocol.ts src/workers/diagnostics.ts src/net/constants.ts src/storage/telemetry-schema.ts src/core/session-identity.ts
git diff --unified=5 a0ae513e7982f0b4719296519752e0ae5f1983f8 -- src/rendering src/simulation src/main.ts src/input src/audio src/net
```

For direct content verification independent of timestamps, the following example checks all tracked public assets against baseline blob IDs. Files that are present are hashed from disk; absent sparse-checkout files use their current tracked object. It also regenerates the complete-public manifest digest above.

```python
from pathlib import Path
import hashlib
import subprocess

baseline = 'a0ae513e7982f0b4719296519752e0ae5f1983f8'

def tree(revision):
    files = {}
    raw = subprocess.check_output(['git', 'ls-tree', '-r', '-z', revision, '--', 'public'])
    for entry in raw.split(b'\0'):
        if not entry:
            continue
        metadata, path = entry.split(b'\t', 1)
        mode, kind, blob = metadata.decode().split()
        if kind == 'blob':
            files[path.decode()] = (mode, blob)
    return files

before, current = tree(baseline), tree('HEAD')
assert before.keys() == current.keys(), 'public file inventory changed'
manifest = hashlib.sha256()
for name in sorted(before):
    mode, blob = current[name]
    path = Path(name)
    if path.exists():
        digest = hashlib.sha1(f'blob {path.stat().st_size}\0'.encode())
        with path.open('rb') as stream:
            while chunk := stream.read(1024 * 1024):
                digest.update(chunk)
        blob = digest.hexdigest()
    assert (mode, blob) == before[name], name
    manifest.update(f'{mode}\0{name}\0{blob}\n'.encode())
print(len(before), manifest.hexdigest())
```

The expected output at this checkpoint is `231 b86dd5b10cc6dafd4e973e9ceadcf22acc6e3ef713ddd1c782599b48f2caf39f`. Inspect index and untracked changes alongside this example, especially when reproducing during concurrent development.

## Limits of this audit

This audit establishes the reviewed change scope and exact protected-content identity. It does not measure frame rate, establish physical GPU/audio/controller behavior, verify every lifecycle change, or replace deterministic simulation and browser tests. Those results belong in the development and performance reports. It also does not claim that all CI jobs passed or treat existing catalogue/livery test failures as permission to alter assets or vehicle tuning.

Agent 51 wrote the original scope document. Agent 60 refreshed this document and prepared the companion completion audit. Neither audit assignment modified production code, test implementations, assets, models, dependencies or remote branch references. The final report handoff contains documentation objects only; the coordinating agent owns publication.
