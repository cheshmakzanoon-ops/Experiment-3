# Phase 27 continuation — lit spray and continuous floodlighting

Base: `988dac65e66509e404b060ca5a1a683143ce72bb` on `main`.

This is a focused implementation of the wet/night-presentation work left open by Phase 27C/D. It is not completion of the graphics phase, commercial reference parity, the 148-section directive, or Steam release acceptance. The earlier pit-render-budget and covered-menu regressions were already repaired by the base commit; its GitHub Actions run `35543773466` is green. Those repairs are not claimed as new work here.

## Implemented

`SprayClouds` draws the existing 1,200-slot contact pool as world-scale, velocity-aligned instanced quads. It shares the original position, velocity, size, alpha and kind arrays; there is no second emitter, new particle lifetime or changed wheel-water calculation. The original point pass excludes spray to avoid double rendering. Dust, smoke, sparks and marbles retain their point presentation, and rain retains its separately protected 600-slot streak pass.

The new shader uses stable slot variation, compact overlapping density lobes, soft edges and optical-depth alpha. Actual hemisphere, ambient, directional and point-light state supplies its illumination. The shader supports scene fog, opaque depth occlusion and a bounded near-plane fade. Clear/seek explicitly dirties the shared opacity attribute, including a held zero-delta frame. No wall-clock animation or random per-frame noise is introduced.

Floodlights retain the four allocated light slots and the existing authored mast positions. Their contribution now fades to zero at the fourth-nearest selection boundary. Tied lamps exchange at zero contribution instead of switching at full intensity. The weighting is spatial and stateless: pause, revisiting a position and seeking cannot leave an old fade running. Peak per-lamp intensity is increased from 450 to 1,800 for night readability. No new shadow passes, simulated clock or physics changes are introduced.

Owners: `src/rendering/spray-clouds.ts`, `effects.ts`, `venue-lighting.ts`.

## Executed evidence

The local environment could not install the locked npm toolchain. Real Three.js **0.180.0** and its actual addon sources were recovered from an existing build's source maps; global TypeScript **5.8.3** compiled component fixtures, and headful Chromium/SwiftShader under Xvfb rendered them. This is not a mock, but it is also not certification by the normal locked TypeScript 5.9.3/Vite/Vitest/Playwright toolchain. That gate belongs to the commit's GitHub CI.

Initial local evidence used a recovered delivery with companion rendering files that differ from `main`. Both existing files changed by this increment were independently verified against the current GitHub blobs before editing (`effects.ts`: `6b869aafb3c0d928181b03d5a467bc7ba82f1d9e`; `venue-lighting.ts`: `a9afa526067cf84e11d60b91b70e36e74adf4853`). Core/simulation source trees match the base. Publication must use the remote base tree and only the listed changed/new files, never replace the repository with that recovered delivery. The initial whole-scene measurements have this limitation. Subsequent verification retrieved the exact `537491b41b4eb7fe7d34bcdaa863369bc04d9da6` CI source artifact (ID `10622263686`, SHA-256 `37616794d226b54a0150b52aad1307efb01eeaae016bc38406c5b7259bf64670`) and independently reconstructed its Git tree `f6ce5ec5ca1d3d5e34349d0db75182adbeb2c8e5`. This supports exact-source component captures; it is still not a local locked-toolchain build or human-driven application review.

* **600 production rain frames, six cars, 2,400 physics ticks:** baseline and updated Effects matched exactly in all six compared particle fields and diagnostics. Both produced 56,241 spray births and 19,200 rain births. Rendered input snapshots stayed unchanged.
* **Nineteen isolated GPU captures:** horizontal/vertical projected footprints rotate correctly; repeated held and restored states are byte-identical. Complete fog, opaque obstruction, a near-plane particle, a non-spray slot, no illumination and explicit clear produce zero visible spray pixels. Daylight and actual point-light illumination produce visible mist. A near-axial projected-velocity reversal initially changed up to 73 channel levels. A wider diagonal probe then exposed a remaining 13-level jump from the square density cutoff. Making both the footprint and its cutoff radial at the singularity reduces the worst measured change to one channel level across positive/negative axial motion and all four diagonal approaches; the two-level assertion is retained. WebGL/console errors: zero.
* **Repeated resource check:** twelve updates/renders retained one geometry and zero textures in the isolated fixture. This bounded check is not an application-wide leak or GPU-memory certification.
* **6,001 racing-line lighting samples:** scalar light-contribution range 1.07067–2.76369; maximum adjacent change 0.02742. These are renderer-relative measurements, not calibrated lux. Weight bounds/continuity were checked at another 10,001 samples.
* **Twelve venue captures:** five broadcast positions and a service area in wet daylight and wet night, using snapshots from a real 8,577-tick production-simulation lap. Source state and physical water were retained, with no reported WebGL errors.
* **Existing wet GPU checks:** weather changed 478 pixels, explicit cleanup changed none, rain births remained 480 with the correct wind. Moving production-renderer chase/cockpit/trackside captures remained finite, with unchanged source snapshots and identical held effect state.

New normal-runner coverage is in `tests/spray-lighting.test.ts` and `e2e/13-wet-lighting-closure.spec.ts`, backed by `e2e/fixtures/wet-lighting-closure.ts`. Existing tests and their acceptance thresholds are not removed or weakened.

## Cost and reference boundary

The spray path adds one instanced draw per render pass, at most 2,400 submitted quad triangles, one geometry and 4,800 bytes of stable CPU slot variation. Dynamic attributes are views into the existing CPU pool, but the new GPU attributes still require their own upload/storage; CPU sharing is not a claim of free GPU memory or fill rate. Mirrored/reflected scene passes can render that draw again. Representative-hardware frame-time and overdraw profiling remain required.

All 100 supplied reference images were revisited in contact sheets; the wet-car reference 010 and night-circuit reference 087 were also inspected at full resolution. Relevant cues are finer water plumes, local illumination, visible racing surfaces and readable cars at night (including the previously linked 068/082/093/096 and 079/080 families). No supplied commercial image or extracted asset is included in the runtime or this delivery. Existing exclusions/supplements and non-racing reference requirements remain unchanged.

The visible result is still a bounded billboard approximation. Dense plumes can still look like discrete smoke/mist lobes; lighting is not volumetric multiple scattering and does not sample light shadow maps. Road/spray intersection softness, high-quality reflections, final wet-night exposure, scenery density, whole-car art, driver anatomy, distant crowd representations and full-lap temporal review are still open. Do not upgrade per-image or master-directive coverage to final acceptance merely because this path exists.

This advances graphics/effects/lighting requirements, especially sections 54, 60, 67–68, 95–96, 122 and 134–135. Sections 140–148, the human-driven final race and actual hardware/controller acceptance are not closed.

## Normal reproduction

```sh
npm ci
npm run check
npm run test:e2e -- e2e/13-wet-lighting-closure.spec.ts e2e/00-wet-presentation.spec.ts e2e/weather.spec.ts
npm run test:physics
npm run test:e2e
```

Use the committed version's CI results, not historical test totals, to assess normal-runner acceptance. Source publication, deployment and Steam acceptance are distinct steps.
