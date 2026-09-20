# Phase 27A — Wet-race broadcast fidelity and full-lap trackside density

This milestone follows the full-race recording-continuity work and advances the retained 148-section master directive's Phase 27 graphics-quality pass. It is deliberately not another menu feature. The target is the repeated visual gap shared by the supplied wet/broadcast reference frames: convincing water-film response, readable spray/rain structure, trackside infrastructure with a believable motorsport purpose, and trackside cameras that exist in the same world as the replay director.

It does **not** claim F1 25 parity, ray tracing, screen-space reflections, volumetric-fluid spray, scanned venues, licensed assets, or a completed final visual audit.

## Why this milestone now

The current simulation evidence already includes the fixed-step tire/aero/weather/race stack, the 10-car/100-lap endurance gate, a continuous changing-weather driving journey, replay/telemetry transport hardening, and physical wet-track state. The larger remaining blocker is that the scene still reads below the engineering underneath it. Sections 57, 58, 66, 68, 122, 128, 134 and the final section-146 scenario all benefit from one connected presentation pass.

The supplied reference set repeatedly reinforces the same targets:

- 010 / 068 / 082: wet rear three-quarter compositions with dense contact-patch spray and a readable wet surface;
- 093 / 096: wet cockpit/traffic scenes where rain, reflective surfaces and nearby infrastructure remain legible;
- 039 / 079 / 080 / 087: broadcast/night compositions whose credibility depends on scene reflection, track furniture, camera placement and layered venue detail.

## Implemented systems

### Spatial water-film specular response

The asphalt/pit material can now use a `MeshPhysicalMaterial` water-film path while retaining the existing spatial water/rubber/marbles state texture. The 512 × 7 physical water grid now also precomputes a deterministic drainage field: both shoulders drain normally, while the low/outside edge receives a smooth local evacuation boost only around the same 56 drain stations rendered beside the circuit. The shader sets clearcoat only from actual wetness and standing-water signal; dry cells stay at zero clearcoat. Wet cells also keep the existing albedo darkening, roughness response and normal flattening. This is a dielectric-film approximation, not an SSR/ray-traced mirror.

### Wet-aware local reflection cadence

The existing bounded local cubemap probe still alternates source/target buffers and restores renderer state. On high/local-reflection settings, a physically wet/raining followed car now permits a 0.55 s probe cadence instead of the dry 1.5 s cadence. The cadence is bounded and validated; menu/photo-stage ownership rules remain intact. Night presentation no longer disables the local probe simply because it is night.

### Rain and spray shape separation

The existing 1,800-particle fixed pool and simulation-driven emission rules are preserved. Wet-wheel spray rate now also consumes recorded normal load, and its world-space wake uses the recorded car quaternion so the plume extends rearward rather than remaining attached to translation. Particle kind is now a GPU attribute so the shader can visually distinguish:

- narrow screen-space rain streaks;
- expanding soft spray plumes;
- smoke/dust radial clouds;
- spark glints;
- rubber marbles.

Spray still requires actual grounded/load/water/speed state. This changes presentation, not physical emission truth.

### Storm atmospheric depth

The daylight model now exposes finite fog RGB channels as well as density. Precipitation increases haze density while cooling and darkening the distance colour, so a heavy-rain broadcast view no longer receives the same clear-weather haze colour. These channels are derived from recorded weather state and remain presentation-only.

### Full-lap authored/rule-based infrastructure

A deterministic circuit-life plan adds no random prop scatter. Its visible drainage stations share the same cadence, low/outside-edge selection and bounded influence field as the **physical surface-water drainage model**; the scene does not show drains that the simulation ignores. On the current 2.973 km Aurel circuit it creates:

- **56** low-edge drainage grates following drainage stations;
- **12** marshal shelters placed at fixed authored stations and moved to the clear side when grandstand footprints conflict;
- **13** service/utility cabinets at a fixed cadence;
- **20** replay-camera sites using the exact same rig positions as the trackside replay director.

The 56 visible grates are not disconnected scenery: their cadence and bank/curvature-selected side are shared with the physical surface-drainage field, so those local edge cells actually evacuate water faster. The infrastructure starts as 323 mesh instances / 5,268 triangles / 9,752 source vertices. Existing spatial/material batching reduces it to 157 draw-owning meshes while preserving the 5,268 triangles. The higher post-batch vertex count reflects non-indexed merged geometry, not extra visible triangles.

Marshal LED boards consume the real `H.FLAG` race-control channel and change green/yellow/double-yellow/blue/chequered appearance from recorded/live state. They are not timer-driven scenery.

## Validation added

`tests/wet-broadcast-fidelity.test.ts` checks deterministic placement, racing-corridor clearance, visible/physical drain identity and real water evacuation, exact replay-camera positional identity, finite/batchable geometry, flag-driven safety panels, the wet clearcoat shader hook, and bounded particle-kind profiles.

`tests/reflections.test.ts` adds the faster wet-probe cadence boundary and rejects invalid cadence values.

`e2e/06-circuit-survey.spec.ts` now retains the established dry/wet grandstand/barrier/kerb captures and adds real marshal-shelter and replay-camera-infrastructure views. It also exposes the exact 56/12/13/20 plan counts without changing simulation state or track water.

## Remaining acceptance gaps

- no SSR, ray tracing or planar wet-road reflection solve;
- no commercial volumetric spray/fluid simulation or windshield-wiper system;
- no scanned circuit/service-road asset set, full broadcast crew, cranes, recovery vehicles or bespoke venue architecture around every metre;
- physical replay-camera housings are intentionally modest procedural assets and still need manual obstruction/composition review;
- local authoring environments without WebGL2 cannot certify the actual appearance of the new clearcoat, spray silhouettes or infrastructure captures;
- representative-hardware FPS and final GPU frame-time acceptance remain part of the later complete Phase-27/25 profiling gates.

This milestone therefore closes a specific layer of the visual/systemic gap while preserving the master directive's rule: presentation must be driven by real simulation/replay state and must not be mistaken for final AAA certification.

## Local validation result

The focused Phase-27A validation completed with **82/82** rendering/weather/circuit tests passing, plus **36/36** recording/replay tests from the immediately preceding continuity milestone. ESLint, `tsc --noEmit`, and the production Vite build pass. The resulting primary app chunk is 598.48 kB minified (190.19 kB gzip), with the existing chunk-size warning still visible rather than suppressed.

The all-files Vitest aggregate did not finish collection within its bounded local run and therefore is **not** reported as a full-suite pass. Playwright's bundled Chromium is absent in this environment; `/usr/bin/chromium` was also unable to complete the GPU circuit-survey case within the bounded attempt. The new dry/wet marshal/replay-camera survey cases remain committed for CI/WebGL-capable execution, and local GPU visual acceptance remains open.
