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

On `d063029`, the rebuilt decoder produced no CSP errors in any native report. Windows and Apple Silicon passed every four-mode journey. Required Linux Mesa lost its graphics context during Formula preparation, so publication was skipped; a separate full-SwiftShader comparison passed all four journeys but does not override that failed gate or prove the driver's root cause.

A separate held-menu repair now polls an already submitted preview's GPU completion even while new drawing is suppressed. It preserves settings ownership, quiet intervals and immutable physics snapshots, and adds a real Academy receipt/held-frame journey. This does not resolve the forced-day showroom/night-preview mismatch or the cold graphics-preparation stalls.

### Graphics and session-lifetime increment (`4f5f66d`)

Source `1cc9d94` passed the new real Academy held-preview completion journey. Windows and Apple Silicon passed native qualification, but required Linux Mesa failed Open World capture after completing the three circuit disciplines. Its report also recorded GPU-process crashes, including an earlier blank Babylon capture. The separate settings suites still contain failures; one passing Academy test is not a complete settings pass.

This increment stages shadow and environment preparation before compiling the resulting lighting variants, retaining full-quality view warmups and unchanged deadlines. Open World uses the existing renderer's GPU-completion gate rather than submitting unbounded frames. Startup cancellation prevents stale imports, saved-state reads, worker readiness and late asset loaders from installing into a closed or replaced session. Process and document observations preserve graphics faults across navigation and require healthy observations around native screenshots and final acceptance.

Local evidence: 131 focused rendering/lifecycle/graphics tests passed, followed by three late-asset teardown tests. After the final late-asset guards, all 14 affected lifecycle tests, TypeScript, desktop compilation, full project lint, production build, workflow lint and diff checks passed. Its native outcome is recorded below; it did not establish a Linux driver repair or four-mode release acceptance.

### Latest native findings and next increment

On `4f5f66d`, Windows and Apple Silicon completed all four native disciplines with no recorded graphics faults, GPU exits or context losses. Babylon passed all five WebGL journeys. Required Linux Mesa failed before its first accepted capture: GPU exit 512 at 10:51:40.508 UTC during Babylon wheel checks, one process exit and one document context loss. The failure image showed a recovered car/road, which does not erase the fault. Publication was skipped. [Native run](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41193802910).

The same source's settings transition run passed five checks but failed the original paused-grid 60-second loading requirement. The new environment preparation fence completed in about 41 ms; final-state compilation took about 6.34 s. The trace then spent the remaining assertion window in the first full chase warmup; later teardown reached pit-crew preparation, so this is not proof of a permanent hang. This LOW preset disables shadows, local probes and mirrors. Further diagnosis must separate scene uploads/rendering and fullscreen post-processing, not lower quality or extend acceptance limits. [Settings run](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41193802893).

The next source increment bounds Babylon scene submissions with the existing GPU fence design while simulation and input continue independently. Reset/resize retain pending GPU ownership; asset readiness requires two observed ready completions, not merely CPU render callbacks. Context-loss recovery retains abandoned-frame evidence rather than inventing completion. Native and browser pause checks now wait for the actual settled presentation before measuring frozen visuals.

Academy circuit-lighting controls now promote the initial vehicle-only showroom to a complete venue without replacing held simulation samples or starting a race. Construction has one owner, repeated entry coalesces, Escape/controller pause cancels panel intent, resize waits for ownership, and late cancelled resources cannot reopen UI. Ordinary studio photographs retain their intentional daylight. These changes remain subject to native/browser qualification; local tests are not GPU or commercial acceptance. The combined local suite passed 175 focused tests; after the final recovery-accounting change, all 15 affected presentation tests passed again. TypeScript, desktop compilation, full project lint, workflow lint and production build passed; a final production build also passed with source-stability verification.

### `8a24796` outcome and restart repair

All five Babylon WebGL journeys passed. Apple Silicon passed all four native modes with zero recorded GPU exits/context losses. Windows and diagnostic SwiftShader failed their first throttle check after Restart: simulation kept advancing, but deferred scene replacement reset input after the new keydown. Required Mesa reached imported-model readiness, then recorded GPU exit 512 and context loss during wheel checks. Publication was skipped. [Native run](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41195048449).

The settings transition run still failed paused-grid loading at 60 seconds (five other checks passed). The interaction job was cancelled after the showroom/grid journey passed, while night/held-preview checks failed waiting for Academy visibility, before their lighting or frozen-frame assertions ran. Both had reached the construction “Scene ready” label around 14 seconds, followed by 67–85-second screencast gaps; this does not yet isolate the create tail from the first full-venue draw. A separate programme trace spent about 63.65 seconds in initial material compilation. [Transition run](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41195048433) · [Interaction run](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41195048491).

The repair separates immediate simulation/input restart ownership from GPU-delayed scene replacement. Deterministic tests preserve throttle pressed after Restart through a busy GPU, preserve later pause/resume input, and use only the latest repeated restart. It does not clear an unfinished fence or loosen the native throttle assertion.

Preparation evidence now records bounded CPU pass checkpoints and separate fence waits, restoring temporary method wrappers before ordinary rendering. A separate opt-in CPU-profile workflow retains the original Academy and paused-grid assertions; profiling adds overhead and is diagnostic, not acceptance or a performance benchmark. No quality settings are lowered and no acceptance deadline is extended. The mixed-class GP pace experiment remains unmerged: a globally applied admission-only prototype worsened that existing criterion despite passing focused safety tests.

Final local validation of this repair/diagnostic increment passed **117 tests across 15 files**, root and desktop TypeScript, full project lint, workflow lint and a source-stable production build (44.65 seconds). The optional profiler selected exactly the two intended original tests. Native restart repair, diagnostic artifact capture and performance acceptance remain pending.

## Remaining acceptance gates

1. Resolve mixed-class GP pace and confirm the full suite under appropriate runner load without hiding failures or extending acceptance limits merely to pass.
2. Exercise every discipline through real entry, driving, pause/restart and exit in the installed product. Existing full-content Three.js compatibility remains available; full four-discipline Babylon presentation is not ported yet.
3. Complete material/environment, wheel/driver animation, LOD, audio, UI and asset parity. Current Babylon captures are a labelled integration workbench, not final graphics.
4. Verify current-source packages and checksums, then installer upgrade/uninstall and controller-only navigation.
5. Measure target-PC frame time, memory and loading; review asset rights and obtain independent playtests.

The owner's US$10,000 profit aspiration is not a technical acceptance test or guarantee. Steam readiness requires product, hardware, rights and market evidence in addition to passing code checks.
