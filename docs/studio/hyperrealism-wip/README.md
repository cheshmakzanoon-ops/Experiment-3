# Round-3 work in progress (saved, not applied)

Development was stopped by the user at 06:18 UTC on 2026-11-05, during round 3 of the hyperrealism pass (four
Sonnet 5.5 agents, xhigh reasoning, started 05:00 UTC). No round-3 agent had committed yet. The orchestrator
committed each agent's working tree and checked it:

| Section | Saved as | Size | Why it is a patch, not code |
| --- | --- | --- | --- |
| F1 / shared pipeline | **merged as code** (`dfb00ca`) | 7 files, +709 | tsc, eslint and 49 related test files (490 tests) pass |
| MotoGP | `motogp-round3.patch` | 22 files, +1794 / −55 | `BikeMaterials` (`src/rendering/bike.ts:466,471,472`) needs `aluminium`, `forkUpper`, `forkLower` typed as `T.MeshPhysicalMaterial`; `tests/gp-front-hydraulics.test.ts:42` mock `aluminium` needs `MeshPhysicalMaterial` (or widened `Materials` type in `gp-front-hydraulics.ts`); `tests/gp-panel-relief.test.ts:53` needs `new Set<number>([...])` |
| Motocross | `motocross-round3.patch` | 35 files, +2475 / −96 | `src/rendering/offroad/mx-course-dressing.ts:528` needs `meadow: mxShoulderPlantGeometry('meadow')` in `plantGeometry`; wire `installMxArenaLighting` in `src/rendering/offroad/index.ts` |
| Open world | `open-world-round3.patch` | 24 files, +1411 / −33 | remove temporary `globalThis.__owDbg` / `__owMorphOff` capture hooks marked `OW-DEBUG` in `coastal-water.ts`, `festival-renderer.ts`, `terrain.ts`, and `water.ts` |

Each patch is a `git diff --binary` against `812b933`. Because binary capture PNGs in `docs/studio/hyperrealism-tooling/` conflict if applied wholesale, apply only `src/` and `tests/` for each section:

```bash
git apply --include='src/**' --include='tests/**' docs/studio/hyperrealism-wip/<section>-round3.patch
```

Then fix the listed items in the table above, run `npx tsc --noEmit && npm run lint`, run the section's targeted vitest files, and commit.

What each patch contains (from file names and the agents' last messages; none of it has been seen in a game frame):

- **MotoGP**: anisotropic brushed metals, shell panel hems (`tests/gp-shell-hem.test.ts`), panel relief
  (`gp-panel-relief.ts`), forged-wheel and occlusion changes, a live-race capture tool
  (`docs/studio/hyperrealism-tooling/motogp/live-race/`).
- **Motocross**: soil parallax for rut depth (`mx-soil-parallax.ts`), loose clods and stones (`mx-loose-soil.ts`),
  arena lighting (`mx-arena-lighting.ts`), trackside meadow and grass tufts (`mx-meadow.ts`), spectators
  (`mx-spectators.ts`), plastic wear, boundary tape, dust-on-ground, updated capture scripts.
- **Open world**: dedicated grass field (`grass-field.ts`), roadside furniture, sea horizon, terrain LOD geomorphing
  (`terrain-morph.ts`, tile worker protocol changes), shared noise (`ow-noise.ts`), coastal water, road and car-finish
  changes.

The merged F1 work adds a screen-space exhaust heat haze (`src/rendering/heat-haze.ts`, High/Ultra, in the scene
composite, depth-tested) and a scene-depth binding for soft particles (`src/rendering/soft-particles.ts`, requested by
the motocross section). Both pass their unit tests but have **not** been seen in a game frame.
