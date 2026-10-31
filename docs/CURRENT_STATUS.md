# Current development status

Updated 2026-10-31. Source integration, automated evidence and release qualification are distinct.

## Product and supported targets

MOTOBOUND is a desktop-first Windows/macOS/Linux game, not a browser-first product. Babylon.js is the primary engine direction, with the existing custom physics/simulation retained as the sole authoritative solver. The website is a secondary engineering preview.

The owner approved development downloads for **Windows x64, Linux x64 and Apple Silicon macOS**. All three supported build/launch lanes must pass. Intel macOS is **experimental and unreleased**, with a separate manual workflow and no publishing job. Its failures remain failures. See [desktop delivery](DESKTOP_DELIVERY.md).

Signing/notarization, Steam submission, physical-hardware qualification and a finished commercial game are not claimed. The first supported-target development publication is being validated.

## Repository consolidation

All eight audited branch tips are ancestors of `29a6f871db184c39de791d8e210d90999069ffe5`. Main was fast-forwarded from `2107a9f1`, preserving 53 MotoGP commits. [Branch receipt](maintenance/branch-consolidation-2026-10-31.json). Cleanup [run 41160579689](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41160579689) succeeded; the subsequent remote listing contains only main. [Repository map](REPOSITORY_MAP.md).

## Completed evidence

- Frozen tracked source `207d5a6` completed four local unit shards: **5,004/5,006 passed, two failed, zero skipped**. Mixed GP/superbike pace remains a logical failure. A pit-release service-bay sweep exceeded its unchanged 30-second deadline under parallel load; all three tests in that file passed unchanged when rerun alone (case 18.61 seconds, process exit 0). The original full-run failure is retained in the [validation ledger](maintenance/validation-2026-10-31.json).
- The latest complete local motocross suite passes **572/572** after physical fixes and explicitly documented finite-inertia test-contract corrections. This is not physical handling certification.
- Source `704e933` passed all four [Babylon WebGL journeys](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41173504842), including the original model, left/right authored steering sampling, pause/restart and production inputs. The discipline-menu fixture checks routing/discoverability, not complete races in every mode. This is software-WebGL evidence, not physical GPU performance acceptance.
- The same source passed packaged launch, real keyboard driving, paused physics, original-model import, screenshot, offline-request and renderer-isolation checks on Linux x64, Windows x64 and native Apple Silicon. Native images were inspected and show the original car.
- The secondary Pages preview was verified at HTTP 200 with build identity `704e933`; later deployments require their own source verification.
- Full lint, TypeScript and production builds pass on the latest tested increments. An earlier partial-log lint report was corrected explicitly; the ledger preserves that correction.

## Current game improvements

- GP overtaking reserves enough target-lane room for finite lean response without reducing stopping or swept-collision margins. The real catch-and-pass reproduces exactly without contact. Shared traffic and GP approach/riding checks pass; the separate mixed-class pace case remains open.
- Deep motocross overlap recovery exchanges forward/heave/pitch momentum through a passive contact impulse. Original launch-height and crash bounds pass; 270 analytic contact combinations verify non-increasing kinetic energy. AI/supermoto touchdown no longer arms an obsolete one-frame pickup flag.
- Brake/soil tests now represent finite rotor and tyre response. They retain material-force contrast within 16.7 ms, check each intermediate force against supported load, verify independently sampled grip exactly and require honest slip. These contract corrections are not counted as newly changed vehicle behavior.
- The original authored driver steering clip is sampled from physics snapshots in Babylon, sharing the unchanged Three.js mapping. Model-ready status waits for completed rendered-ready frames; cancellation/disposal is covered.
- The chase camera now uses the stopped chassis' horizontal forward axis instead of snapping to world north. A vertical pose retains the last meaningful heading; moving velocity-following behavior is unchanged. A regression first demonstrated the old 12 m wrong-axis displacement. All 17 Babylon unit cases, TypeScript, completed lint and production build pass locally after the repair; its real-renderer check is pending.

## Remaining acceptance gates

1. Resolve mixed-class GP pace and confirm the full suite under appropriate runner load without hiding failures or extending acceptance limits merely to pass.
2. Exercise every discipline through real entry, driving, pause/restart and exit in the installed product. Existing full-content Three.js compatibility remains available; full four-discipline Babylon presentation is not ported yet.
3. Complete material/environment, wheel/driver animation, LOD, audio, UI and asset parity. Current Babylon captures are a labelled integration workbench, not final graphics.
4. Verify current-source packages and checksums, then installer upgrade/uninstall and controller-only navigation.
5. Measure target-PC frame time, memory and loading; review asset rights and obtain independent playtests.

The owner's US$10,000 profit aspiration is not a technical acceptance test or guarantee. Steam readiness requires product, hardware, rights and market evidence in addition to passing code checks.
