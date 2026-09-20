# Reference depth pass — validation and limitations

Baseline: `a223c9afb57a00d8974000b9e3e983699a089f0a` (`main`).
Date: 20 September 2026. This report applies to the associated implementation patch, not an assertion that it is published or deployed.

## Source and reference provenance

The repository's successful reference-review workbench, GitHub Actions run `35501892952`, artifact `10602158571`, supplied source and lock-matched dependencies. The extracted source produced exactly the upstream Git tree `bc50a5d08df02764ec4ae6438d0eed1d8b8ecf3f`. The original shallow commit object was reconstructed and verified to hash to the exact baseline SHA, rather than creating a fabricated initial commit. Direct Git network access was unavailable; source retrieval is not described as a successful clone.

The package lock SHA-256 was `0ee732475bc70f3bec4bfa7787f904d51bc28c185534dff3762f2d18801bbc59`. Dependencies were not upgraded or added. All 100 uploaded image hashes match their individual catalogue records. There are 82 racing/game-related entries, two hardware photographs and 16 unrelated entries. Fifteen duplicate/variant relations are explicit. None of the reference image files is bundled into the game.

## Executed checks

| Check | Result | Boundary |
| --- | --- | --- |
| `npm run lint` / final `npx eslint src tests e2e scripts` | Pass | Source and test lint, not runtime rendering |
| `npx vitest run --maxWorkers=1` | **650 passed in 62 files**; 227.23 s | Full unit/regression suite; no skipped assertion substituted for graphics |
| `npx vitest run tests/reference-depth.test.ts --maxWorkers=1` | **29 passed** | Explicit final recheck of new slots, focus, geometry, audio and calendar logic |
| `npm run build` | Pass: strict TypeScript plus Vite production build | Shader appearance still requires WebGL execution |
| `npm run test:reference-ui` | Pass in real Chromium | Real DOM, Canvas2D texture pixels and OfflineAudioContext PCM; not a game-canvas screenshot test |
| `npx playwright test e2e/09-reference-depth.spec.ts --list` | Two real-application cases discovered | Discovery is not execution or acceptance |
| Exact reference-byte and referenced-source-path check | 100/100 hashes and all referenced source paths valid | Does not prove that all depicted features are complete |
| `git diff --check` | Pass | Patch formatting |

The initial sequential baseline-era run timed out in the existing third pit-release regression while other work was active. The final full suite passed all three pit-release cases with their existing assertions and timeouts unchanged; the longest took 28.423 s. No physics test was deleted, skipped or loosened to obtain the final result.

The production build emits the existing class of greater-than-500-kB chunk warning: this pass's minified Three chunk is approximately 529.53 kB and application chunk 589.93 kB. No GPU frame-rate, draw-time or commercial-console performance claim is made.

## New coverage in detail

`tests/reference-depth.test.ts` exercises sparse legacy-compatible decal validation, bounded transforms and real canvas drawing calls; finite/manual/subject photo focus; geometry sampling of actual world and instance transforms; sampling limits; restoration of renderer state even after a thrown render; settings migration; live-human-only cue arbitration, priority, dwell, stale worker ticks, stereo inversion and actual camera-handedness; finite batched headquarters meshes and physical-subject preservation; and research/payroll calendar projection against real `changeTeam` transactions.

`scripts/reference-ui-check.mjs` bundles the actual source components rather than reimplementing their business logic. It edits/saves two different decal slots, catches numeric car-selection coercion, verifies focus/survey/headquarters controls, checks actual left/right texture-map pixels at 128 and 512 resolution, checks left-side isolation, verifies all 100 review rows/84 inspection routes/16 exclusions, reads audio controls and renders real three-tone stereo PCM. Left/right directional energy exceeds the opposite channel by more than tenfold; the central tone is balanced, samples are finite, peak is about 0.1247, and the post-tone tail is silent. Its screenshots are prominently labelled **source component test, not rendered gameplay**.

## GPU boundary — not passed

Chromium 144.0.7559.96 returned `webgl2: false`, both in the component test and an explicit ANGLE/SwiftShader launch probe. The reported context creation error ended with `BindToCurrentSequence failed`. No administrative browser/network policy was changed to work around this.

Consequently the new photo depth pass, point-cloud/render split and headquarters lighting/composition have **not** received local GPU visual acceptance. The added real-application cases in `e2e/09-reference-depth.spec.ts` require the normal built game and actual WebGL. They test survey geometry, focus, headquarters rendering, held-frame preservation, application-reload decal/settings persistence and page errors. They were discovered/type-checked but not run to completion here; they are not replaced by a mocked canvas or a screenshot of a reference photo.

On a normal WebGL-capable test host, run:

```sh
npm ci
npm run build
npm run test:reference-ui
npx playwright test e2e/09-reference-depth.spec.ts
```

Use `CHROMIUM_PATH` only to select an installed browser. Install Playwright's browser normally when needed. Manually compare the real resulting scene captures to the user's originals after those checks; a nonblank render alone is not fidelity acceptance.

## Remaining product gaps

The image-by-image audit is the authoritative scope breakdown. In particular, this patch does not add a performed narrative/media campaign, animated office people, global/friends leaderboard infrastructure, reverse licensed circuits, rendered downloadable ghosts, a second F2 vehicle series, arbitrary image decals on every body surface, physical force feedback, optical shutter accumulation or PS5-level photorealism. The original headquarters is an inspection set, not a walkable campus. Audio guidance is advisory, not accessibility certification. The calendar is a current-staffing local projection, not a multi-race career scheduler.

Completing an inventory row, adding an inspection route or marking a cue “enhanced” is not equivalent to completing everything in that photograph. Those distinctions are retained in the live reference catalogue.
