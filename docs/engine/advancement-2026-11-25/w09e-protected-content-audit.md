# Wave 9: protected-content audit

**Result: PASS for protected authored content and the reviewed engine-change boundary.** All **1,758 protected paths**, totaling **263,530,318 bytes**, have identical Git entries in the original baseline and final candidate. Independent streaming hashes of every corresponding working-tree file also match those entries. No protected path was added, deleted, renamed, modified, or replaced by a symlink.

The review covers every changed production hunk across **25 engine files**, including the generic renderers, track/weather calculations, audio and UI. Those edits change engine ownership, caching, lookup, presentation and lifecycle behavior. They do not change character models, environmental geometry, authored textures/materials/shaders, vehicle/handling definitions or track definitions. This result does **not** certify identical gameplay timing, every rendered pixel, full CI or native-browser acceptance; those are separate validation questions.

## Exact snapshots and evidence

| Item | Identity |
| --- | --- |
| Original baseline commit | `350119e8ec0606e8c5de5b3ab80df41104025679` |
| Baseline tree | `2224939844137abcd06d1aed0d9618f74e05dc18` |
| Final candidate commit | `774e62fafdfd9ecd84001a2fcdb3b9f6ee973b86` |
| Candidate tree | `5f466294eca0b188db58375a1caf4cd76088527b` |
| Previous reviewed candidate | `26efaeefdf5a39b1d28cec4f8fb6bca1c97bf7e1` |
| Baseline tracked paths | 9,920 |
| Candidate tracked paths | 10,249 |
| Baseline-to-candidate changed paths | 405 |

The refresh from `26efaeef` to `774e62fa` independently found **zero changed production or protected paths**. This report is pinned to `774e62fa`; later documentation-only publication can carry it forward by matching the same protected and runtime identities.

[Machine-readable evidence](evidence/protected-content-audit.json) contains all 1,758 per-path baseline/candidate modes, object types and full Git blob IDs; worktree byte counts, Git blob hashes and independent SHA-256 hashes; all 25 runtime reviews and their exact blobs; every changed path and its classification; parse-only source checks; renderer recipe checks; and captured worktree status.

The canonical protected manifest has the same SHA-256 for the baseline Git tree, candidate Git tree and independently streamed working tree:

```text
f90b832132cf3c7d8f05204897ffed535d03254523a198119f67f2f79dbe5491
```

The manifest serializes path-sorted entries containing `path`, `mode`, `type` and `blob`. Its encoding is UTF-8, sorted JSON object keys, compact comma/colon separators and one trailing LF. Content-byte SHA-256 hashes remain separate in each evidence record; the manifest digest is not an asset-content hash.

## Conservative protected manifest

The manifest deliberately includes more than model files. Whole-source identity protects procedural geometry, embedded shader source, materials, character rigs, vehicle parameters and track definitions even when their filenames do not resemble assets. It also protects existing authoring and helper scripts.

| Protected group | Paths | Classification |
| --- | ---: | --- |
| `src/`, excluding the exact 25 runtime files below | 1,092 | All remaining authored content and source; includes 705 unchanged rendering paths, 171 unchanged simulation paths and all four `src/shaders` paths |
| Existing `scripts/`, excluding `scripts/engine-advancement/` | 320 | Existing authoring/build/helper code |
| `public/` | 231 | All public data and artwork, including all 44 model-directory paths |
| `tools/` | 33 | Existing tools, including any content-processing definitions |
| `authoring/` | 22 | Authoring sources |
| `desktop/` | 21 | Existing desktop packaging/source |
| `screenshots/` | 13 | Existing captured images |
| `scratch-tmp/` | 11 | Existing tracked content in the scratch-named directory |
| `playable/` | 9 | Existing packaged/playable files |
| `assets/` | 2 | Existing authored assets |
| `lookdev-tmp/` | 2 | Existing tracked look-development content |
| `reference/` | 1 | Existing reference content |
| `3dmodels.md` | 1 | Existing model inventory |
| **Total** | **1,758** | **263,530,318 bytes, all exact** |

All model, geometry/manifest and shader suffix paths found in the complete trees lie inside this protected set. The supplementary suffix scan includes `.blend`, `.blend1`, `.glb`, `.glb.gz`, `.gltf`, `.fbx`, `.obj`, `.stl`, `.dae`, `.usdz`, `.mesh.json`, `.geometry.json`, `.manifest.json`, `.glsl`, `.vert`, `.frag`, `.hdr`, `.exr` and `.ktx2`. A separate changed-path scan also includes ordinary image and audio suffixes; it found no changes. The suffix scan supplements the broad directory/source rules rather than defining their coverage.

## Exclusions and full changed-path accounting

| Changed group | Paths | Why it is outside the whole-file protected manifest |
| --- | ---: | --- |
| Reviewed engine runtime | 25 | All hunks reviewed below; current worktree bytes also checked against the candidate |
| Unit tests and fixtures | 35 | Validation code and synthetic inputs |
| Browser tests and isolated fixtures | 16 | Validation code, including deliberately synthetic GPU shader/quad controls |
| `scripts/engine-advancement/` | 13 | Measurement and equivalence harnesses |
| Documentation and evidence | 282 | Prose, machine-readable evidence and validation records |
| Generated CI reports | 33 | CI receipts and logs |
| Engine validation workflow | 1 | `.github/workflows/engine-runtime-validation.yml` |
| **Total** | **405** | **No unclassified changed path** |

The changes comprise 333 additions, 68 modifications and four deletions. Rename detection found zero renames. The four deletions are CI logs: `scenarios.log`, `unit-tests-2.log`, `unit-tests-4.log` and `wet-presentation.log`, all below `ci-reports/logs/build-and-validation/`. None is a game asset. Other root files, dependency manifests, build configuration and existing authoring scripts are unchanged in the complete Git comparison.

The reviewed runtime files are excluded only from baseline whole-file equality, since engine edits necessarily change them. They are not excluded from review or from the candidate-versus-worktree byte checks.

## Every changed production file

| Production path | Engine purpose and protected-content boundary |
| --- | --- |
| `src/audio/engine-loudness.ts` | Caches the existing sine basis and reuses exact filter/cosine coefficients. Sound profiles, harmonic definitions, filter constants and synthesis recipes are retained. |
| `src/audio/ui-sounds.ts` | Suspends the UI audio graph through existing release logic. Cue definitions are retained. |
| `src/core/flashback.ts` | Shares the existing supported-mode predicate and permits a null journal. Applied controls and eligible modes are retained. |
| `src/core/ghost-lap.ts` | Adds first-forward-crossing lookup for nonmonotonic lap distances and corrects tiny exact endpoints. It does not edit recorded poses or model data. |
| `src/input/controller.ts` | Requires fresh button edges after retained-page suspension. No controller mapping values change. |
| `src/main.ts` | Fences asynchronous start/settings operations and owns retained-page RAF, input and audio transitions. New loading-status text belongs to runtime UI; no scene recipe or vehicle-definition changes occur. |
| `src/net/client.ts` | Separates remote presentation time and records packet bytes before transfer can detach the buffer. No content or handling values change. |
| `src/net/codec.ts` | Sizes input writers and assembles owned snapshots from prepared car bytes. The change concerns serialization and allocation. |
| `src/net/interpolation.ts` | Bounds remote presentation-clock correction independently of simulation inputs. The `0.25` correction budget is playback scheduling, not vehicle tuning. |
| `src/net/server.ts` | Shares snapshot preparation from twelve ready recipients while retaining independent outbound packet ownership. No car-state definition is retuned. |
| `src/net/snapshot.ts` | Names existing wire sizes and extracts the existing header writer. State fields and quantization constants are retained. |
| `src/rendering/attribute-ranges.ts` | Normalizes dirty-buffer ranges with a sixteen-entry cap. It does not author or change vertex-coordinate values. |
| `src/rendering/open-world/festival-renderer.ts` | Adds context-shared GPU ownership, preparation timeout/failure fencing and draw admission. Scene-constructor and primitive-recipe identity is established separately below. |
| `src/rendering/renderer.ts` | Acquires/releases shared GPU ownership. Scene-constructor and primitive-recipe identity is established separately below. |
| `src/rendering/shared-gpu-frame-gate.ts` | New context-keyed lease/refcount helper. It constructs no scene, model, geometry, shader or material. |
| `src/session/free-roam.ts` | Coordinates retained-page pause, presentation admission, paused/photo cadence and redraw revisions. World definitions and render recipes are retained. |
| `src/simulation/surface-thermal.ts` | Caches fixed cell matrices with input invalidation. Thermal parameter constants and existing equations are retained. |
| `src/simulation/track.ts` | Applies existing conservative lane indexing to paved tracks and caches the identical depression expression and cell coefficients. Circuit definitions, track geometry and vehicle/handling parameters are retained. |
| `src/simulation/weather.ts` | Caches the same drainage exponential in bounded cell slots. Weather presets, timelines and existing water-step equations are retained. |
| `src/storage/telemetry-plots.ts` | Checks the final sample-to-finish interval for completed-lap gaps. No authored content changes. |
| `src/ui/credits.ts` | Owns focus/page/RAF listeners and fresh device edges. Credit markup is retained. |
| `src/ui/flashback.ts` | Uses the shared supported-mode predicate. Eligible modes and allowance values are retained. |
| `src/ui/interface.ts` | Adds abortable listener ownership, modal-operation ownership and disposal. Authored template segments are exact. |
| `src/ui/menu-gamepad.ts` | Rebaselines device/modal/page input and fences repeat/dispatch/cleanup. No model, environment or tuning edits occur. |
| `src/workers/physics.worker.ts` | Allocates the journal only for supported modes and clears it with the session. Journal ownership changes; physics definitions do not. |

The track depression expression keeps the same constants and operation order: `0.65 + 0.35 * Math.sin(row * 0.113 + col * 0.4) ** 2`, with the existing row/column indices. Its evaluation moves to initialization. The water cache retains `-Math.expm1(-drainage * dt)`. These are runtime coefficient caches, not revised environment authoring. Separate numerical-equivalence evidence is still required to establish the complete behavior of those implementations.

## Renderer, shader and authored-token checks

Both changed renderer classes were parsed as source text. Their constructor bodies are token-identical after excluding **only** assignments to `this.gpuFrames`, whose independently reviewed purpose is switching from per-owner gates to context-shared leases. No scene-construction statement was otherwise excluded.

| Renderer | Identical primitive constructor expressions | Constructor-body SHA-256 after the stated gate-assignment exclusion |
| --- | ---: | --- |
| `src/rendering/renderer.ts` | 19 | `5f085dbb26b6852a8c0e22a0068b7849820d28ed0a0831663df39b95294833a7` |
| `src/rendering/open-world/festival-renderer.ts` | 14 | `a1060e30eda23a6665cdcb6c8fd98705682e06f56c94bf75b7f18491e9e94f04` |

The primitive check compares the ordered token streams of geometry/material/mesh/color/vector/quaternion/Euler/matrix construction expressions. Its full digests are in the JSON. All **33 expressions** match. Whitespace and comments are ignored; token text and order are retained. These checks cover construction recipes while the hunk review addresses changed scheduling and cleanup around them.

Across the 24 existing changed production files, **23 retain their exact ordered template segments**. The only difference is two new segments in FestivalRenderer for its GPU preparation timeout diagnostic. No prior template segment is edited. There are 803 baseline segments and 805 candidate segments. All 486 segments in `src/ui/interface.ts`, all 143 in `src/main.ts`, and all 61 in RacingRenderer remain exact.

The parse-only audit also compares **135 existing top-level variable initializers** using lexical tokens. The sole changed initializer is the physics worker's `log`, changing from immediate journal allocation to `null` for conditional ownership. Authored parameter/filter constants in the reviewed files do not change. Newly introduced scheduling/cache constants are reviewed as engine behavior; this comparison does not pretend they are absent.

A supplemental shader-literal search uses `gl_Position`, `gl_FragColor`, `gl_FragCoord`, `#include <...>`, `uniform`, `varying` and `void main` patterns. It finds no shader literal in either revision of the 24 existing changed production files. This is a heuristic, not a complete GLSL parser. The stronger protection for game shaders and procedural artwork is exact whole-file identity for all unchanged `src/shaders/` files and the 705 unchanged rendering paths, plus the targeted renderer constructor comparison. TypeScript was used only to parse/scan source: no program, import graph, compilation or emitted code was created by this audit.

### Deliberately changed test-only shader fixture

`e2e/fixtures/engine-native-gpu-advancement.ts` contains synthetic GPU controls: a `PlaneGeometry(2, 2)`, an 8×8 render target, and constant/`vec3`/`vec4` RawShaderMaterial variants. The explicit `vec4` probe is the shared-GPU-gate ownership witness. These shader strings are new validation inputs, **not game artwork or replacements for game shaders**.

A direct search of `src/`, `index.html`, `vite.config.ts` and `package.json` found no reference to that fixture or `e2e/fixtures`. The fixture's image witness does not establish correctness of other native material paths. In particular, this content audit does not reclassify a separate MeshBasic/`vec3` diagnostic failure as a pass.

## Independent player-model and generated-LOD checks

The existing `scripts/source-stability.ts` intentionally skips `public/models/supplied-player-lods.bin.gz`. This audit does not inherit that exclusion.

| File | Independent result |
| --- | --- |
| `public/models/supplied-player-lods.bin.gz` | Absent from both complete Git trees and absent from the current working tree. No Git blob or bytes exist to hash. |
| `public/models/supplied-player.glb.gz` | Present in both trees and worktree; all identities and bytes match. |

The tracked player file has the following independently streamed identity:

```text
bytes:          36134058
baseline blob:  ab1b17f8247e5c6a0cfeaba3f357e5eb1a4c6af7
candidate blob: ab1b17f8247e5c6a0cfeaba3f357e5eb1a4c6af7
worktree blob:  ab1b17f8247e5c6a0cfeaba3f357e5eb1a4c6af7
content SHA256: 269b4d94c07602582070f1f48bc2e3a778f62d2e1cfcc26b021f52f79ad5ef3a
```

All other protected files received the same independent raw-byte check, not merely a `git status` check. Files were streamed in 1 MiB chunks; the large compressed player model was neither expanded nor loaded into one large allocation.

## Working-tree and execution boundaries

At capture, all 1,758 protected files existed as ordinary files; there were no protected symlinks or submodules. Every mode and raw-byte Git blob hash matched the candidate. Every one of the 25 reviewed runtime files also matched its candidate bytes. Read-only Git checks found no tracked deltas under content/runtime/script roots and no ignored or untracked files in those roots. Concurrent sibling edits were documentation/evidence only and are explicitly recorded in the JSON.

The audit uses complete Git trees, so sparse or incomplete baseline checkouts cannot masquerade as deletions. Its added/deleted/modified/rename checks are independent of the working tree. The generated LOD path received a direct existence check even though it is absent from both manifests.

No build, test suite, authoring command, browser, compiler program or lifecycle script was run by this audit. The root coordinator reports using direct compiler/test commands without `prebuild`, `pretest` or `predev`; the independent hashes and file-existence observations above are the evidence relied on for content preservation.

For reproduction, enumerate both pinned trees with `git ls-tree -r -z`, apply the manifest rules above, and compare each path's full mode/type/blob triple. For every worktree file, stream `SHA1("blob " + decimal_size + NUL + raw_bytes)` and a separate raw-content SHA-256; compare the former with the Git blob. Then compare all changed paths with the explicit 25-runtime allowlist and the documentation/test/CI classifications recorded in the JSON. Record untracked and ignored files separately and directly check the excluded generated LOD path.

## Limits and release conclusion

There is **no observed protected-content violation and no unclassified changed path** in the pinned candidate or captured worktree. No corrective production or asset edit is proposed.

The proof covers committed repository content and observed local bytes. It does not cover future generated LOD contents, remote mutable assets, browser caches, packaged output, game-wide pixel equivalence or subsequent unverified edits. The shader heuristic has the limitation described above. Runtime changes intentionally affect scheduling, ownership, input baselines and lookup behavior, so authored-content preservation must be read alongside the separate functional, numerical and browser acceptance results.

Only this report and `evidence/protected-content-audit.json` are the agent's repository deliverables. No production, test, asset or Git mutation was performed by this audit.
