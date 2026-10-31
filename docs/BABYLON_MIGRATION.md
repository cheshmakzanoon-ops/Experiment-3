# Babylon main-engine migration

Owner direction, 2026-10-31: Babylon.js is the main engine for future development. Retain the existing custom vehicle/simulation engine as a component; do not discard prior Three.js assets or gameplay.

## Desktop delivery is primary

The shipping target is now a packaged Windows/macOS/Linux desktop game, not a browser site. Babylon's renderer and the existing simulation run within a bundled, sandboxed desktop runtime. Web entry points remain engineering previews. See [desktop delivery](DESKTOP_DELIVERY.md) and the root README for current product direction.

## Current ownership and qualification · 2026-10-31

The desktop opens the labelled Babylon workbench; the full-content compatibility entry remains available until all four disciplines reach parity. Current source `b451a2ec07291c56329fb55b98fef710259e0dc1` enables the bounded live Formula surface path described below; its full-lap probes and Windows/Apple Silicon native journeys passed, and subsequent `cee488b` passed all 11 GPU journeys after correcting the recovery fixture; Linux GPU loss still blocks complete native qualification. Earlier source `2caf341` passed all ten Babylon WebGL journeys, including exact Three-reference paint-factor probes and authored-band/resource checks on short surface ranges. The active model-height path had already passed on `a937cac`. These results do not establish complete four-mode Babylon presentation, native Linux reliability or representative physical-GPU performance. [Exact source/run outcomes](CURRENT_STATUS.md) remain authoritative; earlier results are retained in the [development history](maintenance/development-history-2026-10-31.md).

Normal Babylon scene submissions now share the existing GPU completion-gate design. Input and the sole authoritative simulation continue independently while graphics is busy. Paused settlement and asset readiness use observed GPU completions, not merely CPU `onAfterRender` callbacks; the asset waiter excludes frames submitted before import. Context restoration preserves lost/abandoned-frame evidence rather than counting it as completion.

The subsequent restart repair resets simulation/input authority at the Restart event, while only scene disposal/rebuilding waits for GPU ownership. A later keydown or pause change therefore cannot be erased by delayed scene replacement. The restart/input repair passed subsequent native checks on Windows, Apple Silicon and diagnostic SwiftShader. Bounded read-only diagnostics retain the last GPU-loss receipt and CPU draw timing; these are evidence, not a claimed driver repair. See [current status](CURRENT_STATUS.md) for exact source/run outcomes.

## Implemented engine and model boundaries

- Pinned Babylon core and glTF loaders at 9.33.1.
- `src/engine/simulation-component.ts` hosts the existing `Simulation`, unchanged, at 120 Hz. Rendering cadence cannot change fixed-step physics. Pause clears inputs and accumulated time; background catch-up is bounded and accounted for.
- `src/engine/babylon/snapshot-bridge.ts` transfers existing position/quaternion snapshots into Babylon transform nodes. The scene uses the same right-handed coordinate system and metres. Transfer checks every pose before mutation. Single-shot gear inputs are retained until a physics tick consumes them, even above 120 Hz rendering. No Babylon physics plugin is enabled: there must be only one authoritative vehicle solver.
- `src/engine/babylon/circuit-scene.ts` now selects exact original road/edge-paint ribbons for validated canonical Aurel/Vellamar Formula contexts, with the original sampled coarse road retained elsewhere. It intentionally uses diagnostic body proxies until optional original-model loading; these are not replacement production artwork.
- `babylon.html` runs the integration preview, the existing InputController/InputPump (saved keyboard mappings, gamepad calibration, touch and focus-loss safety), AI demo, pause/resume/restart and a link to the complete current Three.js game. Both entry points build from one repository and one Vite build.
- Optional asset inspection loads the **existing** compressed Formula model, checks compressed and decoded hashes against the existing manifest and imports it into Babylon. Authored steering and rigid wheel motion now follow the existing snapshots. Full LOD, tyre deformation/blur, pit-service removal, other animation/material work and performance are not yet at parity. No external asset CDN is introduced.

Run `npm ci`, `npm run dev`, then open `/babylon.html` on the printed local server. This is a migration workbench, not a release-quality replacement for the four-discipline game.

## Live Formula surface boundary

The live scene receives actual vehicle definitions and explicit circuit context. Canonical Aurel/Vellamar Formula sessions replace—not overlap—the coarse +.010 m road with the original zero-lift road and +.006 m edge paint. Other contexts retain the unchanged coarse fallback; eligible-path failures propagate instead of silently falling back. The UI currently selects Aurel. Full-lap Aurel/Vellamar tests exercise the actual scene classes separately, without a hidden circuit selector.

Shared renderer-neutral ribbon/line data and Three-equivalent Float32 normals preserve the original geometry and detail. The material-local paint plugin ports authored colour, roughness and filtered grit/wear; **asphalt shader layers, grounding and light pools remain unported**. Full-lap geometry is 114/150 surface meshes, versus the previous single coarse surface; short-range probe passes do not establish full-workload performance.

Startup/rebuild prepares every actual variant under exclusive GPU ownership, suppresses normal drawing through compilation gaps, and requires two current-scene ready GPU completions within the original absolute readiness budget. Restart changes simulation/input authority immediately but waits for active compiler ownership to drain. Resize rechecks ownership after rebuild; constructor failures and scene-first disposal retain cleanup responsibility. Asset inspection remains disabled until readiness; actual surface diagnostics clear on restart/loss/failure. Native checks read those counts from the existing readiness snapshot without extra renders, queries or longer waits. [Implementation, tests and pending qualification](maintenance/babylon-live-formula-surfaces-2026-10-31.md).

## Original-model primitive identity and shared LOD data

The renderer-independent PLD2 codec now lives in `src/engine/assets/player-lod-data.ts`; existing Three.js imports remain compatible through re-exports. Babylon validates an immutable source-to-imported primitive/material/joint-palette binding table before returning the original model container. The optional derivative-row join does not fetch data or select a reduced tier. Full-detail geometry, materials, transforms, animation ownership and all graphics gates remain unchanged.

The actual hash-verified GLB imported through NullEngine retains 172 primitives, 101 materials and 82 texture objects. Every original index and position/normal/UV/joint/weight value matches the binary source accessors. Its 58 authored palette joints correspond to 59 Babylon bones because an extra armature ancestor has palette index -1. This is data/ownership proof, not texture-pixel or visual parity. The loader's internal source-pointer dependency is isolated and checked; missing or ambiguous identities fail closed. [Contract, checks and remaining limits](maintenance/babylon-primitive-bindings-2026-10-31.md).

## Existing procedural geometry

`src/engine/babylon/legacy-geometry.ts` transfers original indexed/interleaved geometry, normals, UVs, vertex colours, local transforms and material groups into Babylon without disposing or modifying the source asset. Plain PBR/basic materials retain their numerical properties. Textures, custom shader hooks, skins, morphs and instancing currently fail explicitly instead of silently losing content. This is an adapter foundation, not proof that every production model is ported. Three NullEngine contract tests currently verify the boundary.

## Verified and pending

`tests/babylon-integration.test.ts` checks identical original simulation snapshots at 60 Hz and 144 Hz, bounded catch-up, pause/input release, actual Babylon node transfer, invalid-pose rejection, contact-track width and scene disposal using Babylon's NullEngine. **NullEngine tests are not visual/GPU acceptance.**

`e2e/babylon-engine.spec.ts` exercises the real WebGL entry, pause/resume/restart and records a screenshot. Browser execution remains required. The dedicated `Babylon engine integration` Actions workflow builds both entries, runs the boundary tests, checks real WebGL pause/restart and imports the original Formula model, retaining screenshots and failure traces. It supplements, rather than replaces, the full release gates. Its import/lifecycle assertions are not certification of complete visual fidelity, physical-hardware performance or full-mode parity. The live full-lap coverage added in `b451a2e` passed; its restoration request was refused before the post-loss rebuild assertions could run. The subsequent `cee488b` task-boundary fixture correction passed real restoration, readiness invalidation and explicit rebuild without changing production code or deadlines.

The existing Three.js type declarations incorrectly describe the native shader-error program argument as Three's internal wrapper. Babylon's DOM declarations exposed that mismatch. Three browser fixtures now explicitly cast this native handle at the diagnostic boundary; runtime diagnostics are unchanged, and type checking remains enabled.

## Gates before making Babylon the full-content player entry

1. **Engine boundary:** deterministic snapshots, ownership/disposal, pause/restart and no second physics solver.
2. **Assets:** preserve authored models, registry, licences, transforms, LODs, skins/animations and material intent. Compare captures, not just mesh counts. No runtime remote dependency.
3. **Formula:** integrate the existing race director, UI, inputs, audio, replays, pits, weather and progression with Babylon presentation; verify complete races and interrupted flows.
4. **GP motorcycles:** port bike/rider pose, wheel motion, camera and tyre/environment effects; preserve braking, lean, contact and deterministic AI tests.
5. **Motocross:** port deformable terrain, rider weight, takeoff/landing, roost and race control; keep the existing off-road simulation authoritative.
6. **Open world:** retain Solvane road network, streaming terrain, traffic, activities, garage, saves and progression.
7. **Full-content promotion:** the desktop already opens Babylon as its workbench entry. Promote it to the complete player experience only after four-mode presentation, settings/save compatibility, visual evidence and representative-hardware budgets pass. Keep a recoverable Three.js compatibility entry until then.

This is staged migration, not a promise that installing a second renderer makes the game commercially ready. Current blockers are tracked in [current status](CURRENT_STATUS.md).

## References

- [Official Babylon ES module packages](https://doc.babylonjs.com/setup/frameworkPackages/npmSupport/)
- [Official modular imports and tree shaking](https://doc.babylonjs.com/setup/frameworkPackages/es6Support/treeShaking/)

## Historical importer and readiness checkpoints

These observations describe their named revisions, not pending work on today's implementation. The [immutable `b451a2e` migration snapshot](https://github.com/cheshmakzanoon-ops/Experiment-3/blob/b451a2ec07291c56329fb55b98fef710259e0dc1/docs/BABYLON_MIGRATION.md) retains the full earlier narrative; historical reports remain unchanged.

- Run `41163173580` passed startup/lifecycle/discipline switching but failed original-model compressed-byte verification. The corrected importer accepts only the exact compressed or decoded hash and rejects corruption. [Run `41164885118`](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41164885118), source `eff454e9`, subsequently passed repaired import, real-renderer lifecycle, keyboard/touch controls and discipline switching.
- Earlier native screenshots exposed status preceding visible model output. The first correction used two ready CPU render callbacks; the current GPU-completion gate supersedes that weaker receipt. Source `395d7df` showed the original car on Apple Silicon; its earlier blank-road image was not retained as successful visible-model evidence. Linux then exceeded the original 30-second page-wide capture deadline despite reaching gameplay/isolation checks. The viewport CDP capture correction preserved that deadline and lossless PNG validation; later Linux GPU failures remain recorded in [current status](CURRENT_STATUS.md).

These milestones fixed specific import/readiness contracts, not material, livery, animation or whole-game parity.

## Authored driver steering adapter

`ExistingPlayerSteering` locates the original `PLAYER_STEERING` animation, pauses autonomous playback and samples it only from the authoritative snapshot's steering value. The existing `steeringSample` mapping was extracted unchanged into a renderer-independent module and re-exported for the Three.js implementation. Unit checks cover both locks, neutral, nonzero clip frame ranges, unchanged snapshots, paused rendering, invalid inputs, missing/ambiguous clips and disposal; the original supplied-player tests still pass. The real-renderer journey now exercises left/right keys and checks that the sampled clip freezes during pause. Source `704e933` passed the four real WebGL journeys, and `6afc763` repeated that result after the parked-camera repair. These software-renderer checks do not certify physical GPU performance. Rigid-wheel rotation was subsequently integrated as described below. Tyre deformation/blur, driver-camera treatment, automatic LOD policy and full material parity remain separate work.

## Authored rigid-wheel adapter

`ExistingPlayerWheels` now maps each original `PLAYER_WHEEL_*` / `PLAYER_SPIN_*` pair to the authoritative hub travel, steer, camber and measured rotation phase. It uses the existing contact-hub/fallback helper, retains authored x/z placement, and matches the legacy Three XYZ rotation order with Babylon quaternions. It never integrates angular velocity or changes simulation state. All four poses validate before any node mutation; the container retains node ownership. Reset clears the adapter and diagnostics.

Contract checks compare the applied rotations with the legacy implementation, cover measured and fallback travel, pause/frozen snapshots, malformed rigs, non-finite snapshots and disposal. The hashed real GLB also has its node hierarchy and identity rotation/scale checked. The renderer journey reads back the applied Babylon spin quaternion, drives with the production throttle input, checks rotation changes, then verifies pause freezes it and restart clears it. The packaged native smoke test also resumes the imported car, requires an applied wheel rotation change within 15 seconds of real keyboard input, then verifies a 300 ms pause freeze before capture. The wheel/layout journey passed on `b0b3ccc`; later stronger native runs exposed the graphics and restart issues recorded above. Rigid wheel motion is not tyre deformation, blur, pit-service wheel removal or complete material/LOD parity.

## Source-bound carbon and tyre interpretation

The original Formula model carries scalar height images through glTF normal slots. The actual loader now installs their verified interpretation before material preparation under the existing exclusive GPU lease. Exact source hashes and source material/image/texture slots select the ten affected materials; all original resources remain owned by the container. No replacement textures, physics changes or livery changes are introduced.

GPU cache composition, true-normal controls, cancellation during hashing, ordinary restart drain, scene-owned cleanup and exact post-disposal raw restoration have dedicated checks. Enabled-count evidence is published only after completed presentation and final ownership checks. Full details and limits are in the [height-parity report](maintenance/babylon-height-parity-2026-10-31.md); coatings, environment, commercial artwork rights and close-detail framing are separate work.
