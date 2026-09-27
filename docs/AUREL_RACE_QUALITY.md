# Aurel race readability, dusk balance and static venue cost

Baseline: `b2ddae3d13f5c02c807830c3b03e351f39f2a485`, exact tree
`2c3ef04359f9bdb716c8584a3245e2a7591b34aa`. Its ordinary CI run
`36316614930` passed. This is an integrated game-quality increment, not completed
Phase 27, human Section 146, hardware or final-art acceptance.

## Observed baseline

The exact shard-8 artifact `10931129357` has SHA-256
`a2ad328221d304a7af494f6fecc8301561373c9b1dc677e0a859ada3a97b7af1`.
Its normal compact race and pit captures show central instruments masking cars
and service personnel; the same fixed panels consume most of a 480x300 view.
Its daylight/sunset circuit captures motivated improving shaded dusk readability
without increasing the warm direct light or applying a global exposure lift.
No new claim of reviewing all 100 source reference images is made.

## Actual application changes

**Compact racing view.** Below 1280 pixels wide or 680 pixels high, gear, speed,
RPM, pedals, fuel and ERS stay in a compact top readout. The original standings,
lap panel, map and tire/vehicle information move into an explicitly opened
RACE INFO region. These are the same live nodes, not a second data feed. The
panel says driving continues. All twelve standings remain reachable by native
scrolling. Escape closes the panel and restores button focus without also
pausing/exiting replay; keyup still releases held inputs. The wider established
layout is retained. No simulation settings, session storage or driving shortcut
is rewritten. There are no global listeners, timers or resize observers.

**Dusk lighting.** The existing shared sunset profile gains bounded cooler sky
fill and a small environment-floor lift. Warm direct sun, exposure, analytic
sky, weather fog and all day/night values remain unchanged. Actual scene lights
apply to cars, people and road together. This is authored balance, not measured
photometry or certified reference-title parity.

**Static circuit traversal.** Constructed surfaces/barriers, batched props and
vegetation have explicit transform-immutable owners. After construction, equal
local and parent matrices skip repeat descendant updates even when mirror,
shadow or colour traversals request a forced update. No geometry, material,
texture, draw submission or culling boundary is removed. Material uniforms,
instance counts and visibility stay live; animated people stay outside. Owner
and parent motion, reparenting and nonuniform scale are handled exactly. Editing
a descendant transform or hierarchy requires explicit invalidation. Skeletons
are rejected rather than accidentally frozen. Thawing provides an independent
normal-Three traversal control without replacing any matrices or resources.

## Executed local checks and measured scope

`npm run check` passes 1,193 unit cases in 118 files, ESLint, strict TypeScript and
the production build. Eight DOM browser checks pass: the retained wide-view and
menu-reachability tests plus compact live-panel bounds, all twelve standings,
keyboard ownership and same-node resize continuity. Three isolated ribbon test
fixtures now provide the new surfaces owner; every physical assertion remains.

Native physics, dynamics, marshal, wet-pit, integrated-driving, rotation, ten-car
service and clear/changeable classification checks pass. Generated historical
scenario reports are preserved rather than overwritten with this revision's
results. The simulation source remains byte-identical to the baseline.

A controlled browser construction of the actual CircuitScene (no GPU or cars)
counts 1,395 static nodes. Forced update visits fall from 1,585 to 190 with exact
world-matrix equality. Across eight alternating blocks per mode, each with
20 warmups and 120 updates, median CPU traversal is about 0.169 ms uncached and
0.0175 ms cached. Raw timings and scope are retained in
[AUREL_RACE_QUALITY_VALIDATION.json](AUREL_RACE_QUALITY_VALIDATION.json).
These are component traversal measurements, not full-game FPS, GPU VRAM, loading
latency or consumer-device performance.

## Hosted regressions and publication contract

`e2e/35-aurel-race-quality.spec.ts` adds an actual asset-loading renderer fixture
with unchanged snapshot bytes, exact cached/uncached matrices and pixels,
unchanged draws/resources, a retained normal-traversal control and alternating
CPU timings. It compares the previous and new dusk fill on the same constructed
scene/camera, with a separate clipped-pixel check and exact restoration. Direct
scene rendering isolates traversal from postprocessing history; it is not human
race footage or a replacement for the normal application pipeline.

`e2e/36-compact-race-journey.spec.ts` drives the ordinary application through a
populated dusk AI demonstration, live information toggling, a real 30-second
performance export, paused historical replay, seek, camera switch and return.
It captures full-tab images and video. This is labelled automated demonstration,
not uninterrupted human driving. The existing full-lap, grid, close-racing,
wet-following and complete physical pit suites remain intact.

Local Chromium could not create WebGL2. The two new GPU/application checks must
therefore be judged from their exact hosted source run; no local GPU pass is
claimed. Retain normal complete CI and inspect its images before deployment.
Publish only production bytes matching that successful run, never the historical
tracked playable directory. Preserve the existing public origin and user saves.

Original directive, dependency lock, simulation, authored Blender/GLB assets,
input, audio, workers, saves/replay and all existing CI workloads and acceptance
thresholds are unchanged. Complete human Section 146, physical device testing,
handling/audio assessment and broad final-art acceptance remain independent.
