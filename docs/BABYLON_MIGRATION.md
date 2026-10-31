# Babylon main-engine migration

Owner direction, 2026-10-31: Babylon.js is the main engine for future development. Retain the existing custom vehicle/simulation engine as a component; do not discard prior Three.js assets or gameplay.

## Desktop delivery is primary

The shipping target is now a packaged Windows/macOS/Linux desktop game, not a browser site. Babylon's renderer and the existing simulation run within a bundled, sandboxed desktop runtime. Web entry points remain engineering previews. See [desktop delivery](DESKTOP_DELIVERY.md) and the root README for current product direction.

## Implemented first boundary

- Pinned Babylon core and glTF loaders at 9.33.1.
- `src/engine/simulation-component.ts` hosts the existing `Simulation`, unchanged, at 120 Hz. Rendering cadence cannot change fixed-step physics. Pause clears inputs and accumulated time; background catch-up is bounded and accounted for.
- `src/engine/babylon/snapshot-bridge.ts` transfers existing position/quaternion snapshots into Babylon transform nodes. The scene uses the same right-handed coordinate system and metres. Transfer checks every pose before mutation. Single-shot gear inputs are retained until a physics tick consumes them, even above 120 Hz rendering. No Babylon physics plugin is enabled: there must be only one authoritative vehicle solver.
- `src/engine/babylon/circuit-scene.ts` renders the actual sampled contact-track geometry. It intentionally uses diagnostic body proxies, not replacement production artwork.
- `babylon.html` runs the integration preview, the existing InputController/InputPump (saved keyboard mappings, gamepad calibration, touch and focus-loss safety), AI demo, pause/resume/restart and a link to the complete current Three.js game. Both entry points build from one repository and one Vite build.
- Optional asset inspection loads the **existing** compressed Formula model, checks compressed and decoded hashes against the existing manifest and imports it into Babylon. It is an unoptimised inspection path: full LOD, wheel/driver animations, materials and performance are not yet at parity. No external asset CDN is introduced.

Run `npm ci`, `npm run dev`, then open `/babylon.html` on the printed local server. This is a migration workbench, not a release-quality replacement for the four-discipline game.

## Existing procedural geometry

`src/engine/babylon/legacy-geometry.ts` transfers original indexed/interleaved geometry, normals, UVs, vertex colours, local transforms and material groups into Babylon without disposing or modifying the source asset. Plain PBR/basic materials retain their numerical properties. Textures, custom shader hooks, skins, morphs and instancing currently fail explicitly instead of silently losing content. This is an adapter foundation, not proof that every production model is ported. Three NullEngine contract tests currently verify the boundary.

## Verified and pending

`tests/babylon-integration.test.ts` checks identical original simulation snapshots at 60 Hz and 144 Hz, bounded catch-up, pause/input release, actual Babylon node transfer, invalid-pose rejection, contact-track width and scene disposal using Babylon's NullEngine. **NullEngine tests are not visual/GPU acceptance.**

`e2e/babylon-engine.spec.ts` exercises the real WebGL entry, pause/resume/restart and records a screenshot. Browser execution remains required. The dedicated `Babylon engine integration` Actions workflow builds both entries, runs the boundary tests, checks real WebGL pause/restart and imports the original Formula model, retaining screenshots and failure traces. It supplements, rather than replaces, the full release gates. Optional high-detail asset import is not certified by that test.

The existing Three.js type declarations incorrectly describe the native shader-error program argument as Three's internal wrapper. Babylon's DOM declarations exposed that mismatch. Three browser fixtures now explicitly cast this native handle at the diagnostic boundary; runtime diagnostics are unchanged, and type checking remains enabled.

## Migration gates before replacing the default entry

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

Native screenshot inspection found that the decoded-model status could precede visible GPU output, particularly when the scene was already paused. Import success now waits for two completed frames with ready scene materials before announcing the model as loaded. Restart/scene disposal aborts that wait and removes its observers. Three focused lifecycle tests pass; fresh real-renderer/native captures remain required to confirm the visual result. This fixes readiness reporting, not material, livery or animation parity.
