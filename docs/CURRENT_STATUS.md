# Current development status

Updated 2026-10-31. Source integration, automated evidence and release qualification are distinct.

## Product and supported targets

MOTOBOUND is a desktop-first Windows/macOS/Linux game, not a browser-first product. Babylon.js is the primary engine direction, with the existing custom physics/simulation retained as the sole authoritative solver. The website is a secondary engineering preview.

The owner approved development downloads for **Windows x64, Linux x64 and Apple Silicon macOS**. All three supported build/launch lanes must pass. Intel macOS is **experimental and unreleased**, with a separate manual workflow and no publishing job. Its failures remain failures. See [desktop delivery](DESKTOP_DELIVERY.md).

Signing/notarization, Steam submission, physical-hardware qualification and a finished commercial game are not claimed. All three supported native targets passed on `b0b3ccc` in [run 41183949366](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41183949366); its [desktop development release](https://github.com/cheshmakzanoon-ops/Experiment-3/releases/tag/desktop-dev-b0b3cccb54502898312efe5f884c2c254ddc48f2-41183949366-1) is published with five platform packages, three checksum lists and three source receipts.

## Repository consolidation

All eight audited branch tips are ancestors of `29a6f871db184c39de791d8e210d90999069ffe5`. Main was fast-forwarded from `2107a9f1`, preserving 53 MotoGP commits. [Branch receipt](maintenance/branch-consolidation-2026-10-31.json). Cleanup [run 41160579689](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41160579689) succeeded; the subsequent remote listing contains only main. [Repository map](REPOSITORY_MAP.md).

## Completed evidence

- Frozen tracked source `207d5a6` completed four local unit shards: **5,004/5,006 passed, two failed, zero skipped**. Mixed GP/superbike pace remains a logical failure. A pit-release service-bay sweep exceeded its unchanged 30-second deadline under parallel load; all three tests in that file passed unchanged when rerun alone (case 18.61 seconds, process exit 0). The original full-run failure is retained in the [validation ledger](maintenance/validation-2026-10-31.json).
- The latest complete local motocross suite passes **572/572** after physical fixes and explicitly documented finite-inertia test-contract corrections. This is not physical handling certification.
- Source `704e933` passed all four [Babylon WebGL journeys](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41173504842), including the original model, left/right authored steering sampling, pause/restart and production inputs. The discipline-menu fixture checks routing/discoverability, not complete races in every mode. This is software-WebGL evidence, not physical GPU performance acceptance.
- The same source passed packaged launch, real keyboard driving, paused physics, original-model import, screenshot, offline-request and renderer-isolation checks on Linux x64, Windows x64 and native Apple Silicon. Native images were inspected and show the original car.
- The secondary Pages build identity was verified at HTTP 200 for `8013d22815e50fb9bec86c537e20d7e2e5f464a7`, fingerprint `32755bb27bb734cbabba8e04e4dc92f3f848df2d38a57460c4c7df1a7109c4e1`; it remains an engineering preview, not the shipping product.
- Full lint, TypeScript and production builds pass on the latest tested increments. An earlier partial-log lint report was corrected explicitly; the ledger preserves that correction.

## Current game improvements

- GP overtaking reserves enough target-lane room for finite lean response without reducing stopping or swept-collision margins. The real catch-and-pass reproduces exactly without contact. Shared traffic and GP approach/riding checks pass; the separate mixed-class pace case remains open.
- Deep motocross overlap recovery exchanges forward/heave/pitch momentum through a passive contact impulse. Original launch-height and crash bounds pass; 270 analytic contact combinations verify non-increasing kinetic energy. AI/supermoto touchdown no longer arms an obsolete one-frame pickup flag.
- Brake/soil tests now represent finite rotor and tyre response. They retain material-force contrast within 16.7 ms, check each intermediate force against supported load, verify independently sampled grip exactly and require honest slip. These contract corrections are not counted as newly changed vehicle behavior.
- The original authored driver steering clip is sampled from physics snapshots in Babylon, sharing the unchanged Three.js mapping. Model-ready status waits for completed rendered-ready frames; cancellation/disposal is covered.
- The chase camera now uses the stopped chassis' horizontal forward axis instead of snapping to world north. A vertical pose retains the last meaningful heading; moving velocity-following behavior is unchanged. A regression first demonstrated the old 12 m wrong-axis displacement. All 17 Babylon unit cases, TypeScript, completed lint and production build pass locally after the repair; source `6afc763` passed all four real WebGL journeys in [run 41179328794](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41179328794). This is not a physical-GPU benchmark.

The new Babylon increment ports original rigid wheel hub/steering/camber/spin motion from existing snapshots. It retains tyre deformation, blur, pit-service offsets and LOD as explicit remaining work. All 20 Babylon checks, 21 desktop/legacy contract checks, TypeScript, completed lint and the production build pass locally. Source `b0b3ccc` passed all five WebGL journeys and all three native wheel/layout checks, with inspected visible-car captures. This is still not physical-hardware performance certification. Inspection of the `6afc763` Windows capture also found the diagnostic panel overlapping the car at a 1008 px viewport. A bounded responsive panel and explicit central-view/touch-control layout checks repaired that overlap in `8013d22`; the Windows and Apple Silicon native images now show the entire car clear of the panel.

The following qualification increment adds real installed-game compatibility journeys for Formula, GP, Outdoor MX and Open World. It observes each session's own authoritative/presented motion and autopilot state, then requires real throttle response, pause/resume/pause and return through production menus. All 37 focused local checks, TypeScript, completed lint and production build pass. On `710fb863`, Windows and Apple Silicon completed all four journeys but failed the aggregate guard on four Basis worker CSP EvalErrors. Linux had two GPU-process crashes and a fatal graphics-context loss during Formula preparation; its stale loading state then reached the 300 s readiness timeout. Publication was skipped. Native reports now retain error stacks and stage checkpoints and stop immediately on the production fatal panel. The strict-CSP decoder rebuild preserves all 3,543 output hashes locally; fresh native verification remains required. Separate settings tests also exposed a showroom/night-preview mismatch and blocking cold shadow/reflection preparation.

## Remaining acceptance gates

1. Resolve mixed-class GP pace and confirm the full suite under appropriate runner load without hiding failures or extending acceptance limits merely to pass.
2. Exercise every discipline through real entry, driving, pause/restart and exit in the installed product. Existing full-content Three.js compatibility remains available; full four-discipline Babylon presentation is not ported yet.
3. Complete material/environment, wheel/driver animation, LOD, audio, UI and asset parity. Current Babylon captures are a labelled integration workbench, not final graphics.
4. Verify current-source packages and checksums, then installer upgrade/uninstall and controller-only navigation.
5. Measure target-PC frame time, memory and loading; review asset rights and obtain independent playtests.

The owner's US$10,000 profit aspiration is not a technical acceptance test or guarantee. Steam readiness requires product, hardware, rights and market evidence in addition to passing code checks.
