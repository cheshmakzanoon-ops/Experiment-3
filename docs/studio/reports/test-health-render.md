# Test health: rendering and presentation reds (group 2)

Branch `studio/qa-render-reds`, cut from main c818caa. Scope: `tests/race-view-continuity.test.ts` (4),
`tests/race-surface-finish.test.ts` (1), `tests/circuit-detail.test.ts` (1), `tests/road-detail.test.ts` (1).

Result: all four files green. No product code changed: in every case the code is the intended new
behaviour and the test fixture or expectation had not followed it. Each change is justified below.
No test was skipped, deleted or loosened (the one changed numeric expectation became stricter, 12 digits
against the real lens).

## Findings

| Test | Introduced by | Red on ebf691d? | Root cause | Fix |
| --- | --- | --- | --- | --- |
| race-view-continuity x4 ('poses each car once...') | `8fcc2ae` "cockpit lens setting for the original cockpit" (on branch `studio/legal-ip-hero-car`, entered main with merge `17550e8`) | No (7/7 pass) | `RacingRenderer.draw` now applies the Graphics "Cockpit field of view" to every Formula cockpit camera (it was gated by `car.suppliedPlayer`). The hand-built `this` in the test had no `graphics`, so `draw` threw `TypeError: ... 'cockpitFov'` before the shadow stage. Ordering contract (solve view, then pose each car once) was not changed. Second effect once the fixture is fixed: the cockpit lens is the 54 degree default, narrower than the 58 degree reference of `detailDistance`, so the LOD distance handed to `setLod` is scaled by tan(27)/tan(29) = 0.9192 (measured 0.41108 vs 0.44721, and 18.389 vs 20.005 for the reset case). | Fixture gets `graphics: graphicsPreset('high')`; the distance expectation is now `detailDistance(hypot(...), camera.fov, camera.aspect)` and `camera.fov` is asserted equal to the Graphics lens. All order assertions are untouched. |
| race-surface-finish 'observes all four live tyre states...' | weather 2 (`bea1750`): `PRECIPITATION` phase rule | No (12/12 pass); passes at 3ae3842 | Test wrote `H.RAIN = 14` into a zero-filled header, whose ambient is 0 C. Since weather 2, precipitation at 0 C and below is snow (`snowShare(0) = 1`), so `frameLiquidRain` is 0 and `tireWetAppearance` is 0, not 1. | `worn[H.AMBIENT] = 18` (rain temperature). Assertions unchanged. `docs/studio/reports/weather-2.md` (lines 111 and 220) records this exact hazard and that three older fixtures were fixed the same way; this fourth one was missed. |
| circuit-detail 'composes decorative finish...' | `328935c` "Weather: damp film and dust on the road shader" (wave 1, merge `3899af8`) | No (14/14 pass) | `installWetRoad` now adds the shared `roadDust` uniform (and `uniform float roadDust` in the fragment shader). The test pins the exact uniform key list and lacked the key. | Added `'roadDust'` in its real position (2nd) and asserted it is the shared `roadDustUniform`. |
| road-detail 'keeps the wet road uniform keys...' | same `328935c` | No (17/17 pass) | Same uniform list. | Added `'roadDust'` in the same position. |

These two files were measured red at 3ae3842. `328935c` is an ancestor of 7f2d2ed, which is consistent with
the PM's note that they were red in the earlier baseline (7f2d2ed itself was not re-run). They are not
defects of the original repository (both pass on ebf691d).

## Bisect evidence (throwaway worktree outside the repo, removed afterwards)

- `71b762d` (parent of 8fcc2ae): race-view-continuity 7/7 pass.
- `8fcc2ae`: 3 pass, 4 fail with the same four test names. Only commit that changed the failing code path.
  8fcc2ae is contained in `17550e8` and not in `1425750` (the merge before it).
- `3ae3842`: race-surface-finish 12/12 pass (so weather 2 introduced it), circuit-detail 1 fail, road-detail 1 fail.
- `ebf691d`: circuit-detail 14/14, road-detail 17/17, race-view-continuity and race-surface-finish all pass.

## Verification (this branch)

- `npx vitest run tests/race-view-continuity.test.ts` : 7 passed
- `npx vitest run tests/race-surface-finish.test.ts` : 12 passed
- `npx vitest run tests/circuit-detail.test.ts` : 14 passed
- `npx vitest run tests/road-detail.test.ts` : 17 passed
- `npx tsc --noEmit` : 0 errors
- `npx eslint` on the four test files : clean
- Full suite not run (rule: targeted files only).

## Not covered / follow-ups

- The race-view-continuity test builds `this` by hand, which is why a product change that reads one more
  renderer field breaks it. A fixture factory that starts from real defaults (`graphicsPreset`) for every
  member `draw` reads before the shadow stage would make it less brittle. Not done: out of scope.
- The weather 2 hazard (zero-filled header = 0 C = snow) can bite any future synthetic frame; consider a
  shared test helper that builds a header with a rain-temperature ambient.
