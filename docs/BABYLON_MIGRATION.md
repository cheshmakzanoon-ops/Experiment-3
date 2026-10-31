# Babylon main-engine migration

Owner direction, 2026-10-31: Babylon.js is the main engine for future development. Retain the existing custom vehicle/simulation engine as a component; do not discard prior Three.js assets or gameplay.

## Desktop delivery is primary

The shipping target is now a packaged Windows/macOS/Linux desktop game, not a browser site. Babylon's renderer and the existing simulation run within a bundled, sandboxed desktop runtime. Web entry points remain engineering previews. See [desktop delivery](DESKTOP_DELIVERY.md) and the root README for current product direction.

## Current ownership and qualification · 2026-10-31

The desktop opens the labelled Babylon workbench; the full-content compatibility entry remains available until all four disciplines reach parity. On `80d9fe4`, Windows and Apple Silicon passed the packaged Babylon checks and all four retained-mode journeys. Required Mesa lost its GPU process during Babylon wheel/presentation checks after the original model was displayed; successful context restoration does not erase that fault. Publication was skipped. The separate `80d9fe4` SwiftShader comparison also passed all four modes with a complete native checkpoint stream. These results do not establish complete four-mode Babylon presentation or physical-GPU performance. [Exact source/run outcomes](CURRENT_STATUS.md).

Normal Babylon scene submissions now share the existing GPU completion-gate design. Input and the sole authoritative simulation continue independently while graphics is busy. Paused settlement and asset readiness use observed GPU completions, not merely CPU `onAfterRender` callbacks; the asset waiter excludes frames submitted before import. Context restoration preserves lost/abandoned-frame evidence rather than counting it as completion.

The subsequent restart repair resets simulation/input authority at the Restart event, while only scene disposal/rebuilding waits for GPU ownership. A later keydown or pause change therefore cannot be erased by delayed scene replacement. The restart/input repair passed subsequent native checks on Windows, Apple Silicon and diagnostic SwiftShader. Bounded read-only diagnostics retain the last GPU-loss receipt and CPU draw timing; these are evidence, not a claimed driver repair. See [current status](CURRENT_STATUS.md) for exact source/run outcomes.

## Implemented first boundary

- Pinned Babylon core and glTF loaders at 9.33.1.
- `src/engine/simulation-component.ts` hosts the existing `Simulation`, unchanged, at 120 Hz. Rendering cadence cannot change fixed-step physics. Pause clears inputs and accumulated time; background catch-up is bounded and accounted for.
- `src/engine/babylon/snapshot-bridge.ts` transfers existing position/quaternion snapshots into Babylon transform nodes. The scene uses the same right-handed coordinate system and metres. Transfer checks every pose before mutation. Single-shot gear inputs are retained until a physics tick consumes them, even above 120 Hz rendering. No Babylon physics plugin is enabled: there must be only one authoritative vehicle solver.
- `src/engine/babylon/circuit-scene.ts` renders the actual sampled contact-track geometry. It intentionally uses diagnostic body proxies, not replacement production artwork.
- `babylon.html` runs the integration preview, the existing InputController/InputPump (saved keyboard mappings, gamepad calibration, touch and focus-loss safety), AI demo, pause/resume/restart and a link to the complete current Three.js game. Both entry points build from one repository and one Vite build.
- Optional asset inspection loads the **existing** compressed Formula model, checks compressed and decoded hashes against the existing manifest and imports it into Babylon. Authored steering and rigid wheel motion now follow the existing snapshots. Full LOD, tyre deformation/blur, pit-service removal, other animation/material work and performance are not yet at parity. No external asset CDN is introduced.

Run `npm ci`, `npm run dev`, then open `/babylon.html` on the printed local server. This is a migration workbench, not a release-quality replacement for the four-discipline game.

## Original-model primitive identity and shared LOD data

The renderer-independent PLD2 codec now lives in `src/engine/assets/player-lod-data.ts`; existing Three.js imports remain compatible through re-exports. Babylon validates an immutable source-to-imported primitive/material/joint-palette binding table before returning the original model container. The optional derivative-row join does not fetch data or select a reduced tier. Full-detail geometry, materials, transforms, animation ownership and all graphics gates remain unchanged.

The actual hash-verified GLB imported through NullEngine retains 172 primitives, 101 materials and 82 texture objects. Every original index and position/normal/UV/joint/weight value matches the binary source accessors. Its 58 authored palette joints correspond to 59 Babylon bones because an extra armature ancestor has palette index -1. This is data/ownership proof, not texture-pixel or visual parity. The loader's internal source-pointer dependency is isolated and checked; missing or ambiguous identities fail closed. [Contract, checks and remaining limits](maintenance/babylon-primitive-bindings-2026-10-31.md).

## Existing procedural geometry

`src/engine/babylon/legacy-geometry.ts` transfers original indexed/interleaved geometry, normals, UVs, vertex colours, local transforms and material groups into Babylon without disposing or modifying the source asset. Plain PBR/basic materials retain their numerical properties. Textures, custom shader hooks, skins, morphs and instancing currently fail explicitly instead of silently losing content. This is an adapter foundation, not proof that every production model is ported. Three NullEngine contract tests currently verify the boundary.

## Verified and pending

`tests/babylon-integration.test.ts` checks identical original simulation snapshots at 60 Hz and 144 Hz, bounded catch-up, pause/input release, actual Babylon node transfer, invalid-pose rejection, contact-track width and scene disposal using Babylon's NullEngine. **NullEngine tests are not visual/GPU acceptance.**

`e2e/babylon-engine.spec.ts` exercises the real WebGL entry, pause/resume/restart and records a screenshot. Browser execution remains required. The dedicated `Babylon engine integration` Actions workflow builds both entries, runs the boundary tests, checks real WebGL pause/restart and imports the original Formula model, retaining screenshots and failure traces. It supplements, rather than replaces, the full release gates. Optional high-detail asset import is not certified by that test.

The existing Three.js type declarations incorrectly describe the native shader-error program argument as Three's internal wrapper. Babylon's DOM declarations exposed that mismatch. Three browser fixtures now explicitly cast this native handle at the diagnostic boundary; runtime diagnostics are unchanged, and type checking remains enabled.

## Gates before making Babylon the full-content player entry

1. **Engine boundary:** deterministic snapshots, ownership/disposal, pause/restart and no second physics solver.
2. **Assets:** preserve authored models, registry, licences, transforms, LODs, skins/animations and material intent. Compare captures, not just mesh counts. No runtime remote dependency.
3. **Formula:** integrate the existing race director, UI, inputs, audio, replays, pits, weather and progression with Babylon presentation; verify complete races and interrupted flows.
4. **GP motorcycles:** port bike/rider pose, wheel motion, camera and tyre/environment effects; preserve braking, lean, contact and deterministic AI tests.
5. **Motocross:** port deformable terrain, rider weight, takeoff/landing, roost and race control; keep the existing off-road simulation authoritative.
6. **Open world:** retain Solvane road network, streaming terrain, traffic, activities, garage, saves and progression.
7. **Default-engine switch:** make Babylon the normal player entry only after the four modes, settings/save compatibility, visual evidence and representative-hardware budgets pass. Keep a recoverable Three.js fallback until then.

This is staged migration, not a promise that installing a second renderer makes the game commercially ready. Current blockers are tracked in [current status](CURRENT_STATUS.md).

## References

- [Official Babylon ES module packages](https://doc.babylonjs.com/setup/frameworkPackages/npmSupport/)
- [Official modular imports and tree shaking](https://doc.babylonjs.com/setup/frameworkPackages/es6Support/treeShaking/)

## Browser verification, 2026-10-31

Actions run `41163173580` passed real Babylon startup/pause/resume/restart and discipline switching on SwiftShader. The original-model import failed its compressed-byte check. The importer now accepts only either the exact compressed hash or the exact decoded hash, matching browser-transparent gzip transport; new tests verify both representations and corruption rejection. A repeat browser run is still required. This is a repaired candidate, not a claimed GPU pass.

Actions run [41164885118](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41164885118), source `eff454e9`, passed the repaired importer, real renderer lifecycle, production keyboard/touch inputs and discipline switching. Its screenshots confirm the original model is present and road normals face the light. This remains an integration workbench: environment, materials, livery, animation and full-mode presentation parity are not complete.

## Model presentation readiness

Native screenshot inspection found that the decoded-model status could precede visible GPU output, particularly when the scene was already paused. The initial gate waited for two CPU render callbacks with ready scene materials; the current GPU-completion gate described above supersedes that weaker receipt. Restart/scene disposal aborts that wait and removes its observers. Three focused lifecycle tests pass; fresh real-renderer/native captures remain required to confirm the visual result. This fixes readiness reporting, not material, livery or animation parity.

The `395d7df` native Apple Silicon capture now shows the original car after the rendered-ready gate; the earlier blank-road capture is no longer accepted as visible-model evidence. Linux reached all gameplay/isolation checks but its page-wide screenshot preparation exceeded 30 seconds. The native harness now captures the existing viewport surface through CDP, following the project's established visual-test method, with the same 30-second deadline and lossless PNG validation.

## Authored driver steering adapter

`ExistingPlayerSteering` locates the original `PLAYER_STEERING` animation, pauses autonomous playback and samples it only from the authoritative snapshot's steering value. The existing `steeringSample` mapping was extracted unchanged into a renderer-independent module and re-exported for the Three.js implementation. Unit checks cover both locks, neutral, nonzero clip frame ranges, unchanged snapshots, paused rendering, invalid inputs, missing/ambiguous clips and disposal; the original supplied-player tests still pass. The real-renderer journey now exercises left/right keys and checks that the sampled clip freezes during pause. Source `704e933` passed the four real WebGL journeys, and `6afc763` repeated that result after the parked-camera repair. These software-renderer checks do not certify physical GPU performance. Wheel deformation/rotation, driver-camera treatment, LOD and material parity remain separate work.

## Authored rigid-wheel adapter

`ExistingPlayerWheels` now maps each original `PLAYER_WHEEL_*` / `PLAYER_SPIN_*` pair to the authoritative hub travel, steer, camber and measured rotation phase. It uses the existing contact-hub/fallback helper, retains authored x/z placement, and matches the legacy Three XYZ rotation order with Babylon quaternions. It never integrates angular velocity or changes simulation state. All four poses validate before any node mutation; the container retains node ownership. Reset clears the adapter and diagnostics.

Contract checks compare the applied rotations with the legacy implementation, cover measured and fallback travel, pause/frozen snapshots, malformed rigs, non-finite snapshots and disposal. The hashed real GLB also has its node hierarchy and identity rotation/scale checked. The renderer journey reads back the applied Babylon spin quaternion, drives with the production throttle input, checks rotation changes, then verifies pause freezes it and restart clears it. The packaged native smoke test also resumes the imported car, requires an applied wheel rotation change within 15 seconds of real keyboard input, then verifies a 300 ms pause freeze before capture. The wheel/layout journey passed on `b0b3ccc`; later stronger native runs exposed the graphics and restart issues recorded above. Rigid wheel motion is not tyre deformation, blur, pit-service wheel removal or complete material/LOD parity.
