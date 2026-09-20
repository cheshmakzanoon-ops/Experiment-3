# Phase 27A — dynamic wet-race presentation milestone

## Why this is the next milestone

The retained 148-section master directive requires the simulation, presentation and integration passes to converge in the same driven scenario. The current repository already has connected 120 Hz vehicle physics, evolving weather and surface water, replay/telemetry, pit service, race control, cockpit cameras, photo/replay tools and a now-hardened full-race recording path. The newest continuity milestone explicitly leaves the human-perceived audiovisual section-146 run and final quality standard open.

The supplied reference review also makes the next gap presentation-facing. Reference 096 is a wet cockpit composition, 095 is an in-race pit-service view, 039 is a broadcast replay cue, and 075–080 emphasize long-lens/broadcast/photo readability. The game already emitted rain and wheel spray from real state, but those particles still shared a mostly generic soft point treatment and the spray inherited enough vehicle velocity to remain too attached to the car. Fog density reacted to rain while fog colour reacted only to cloud cover. Those are visible integration gaps, not missing physics systems.

For that reason this pass starts Phase 27 with **wet-race readability and atmospheric depth** before adding more decorative content.

## Engineering contract

This pass keeps presentation coupled to simulation truth. The particle continuation itself is presentation-only; the preceding wet-broadcast milestone also changed surface drainage.

- Spray still originates from measured wheel contact state.
- Emission uses wheel water, normal load, vehicle speed and the selected tire compound.
- Wake direction is derived from the recorded/rendered vehicle quaternion and existing world velocity; it does not feed back into physics.
- Weather wind remains the same wind carried by simulation/replay.
- Rain birth rate remains elapsed-time based rather than frame-count based.
- No tire, aero, brake, hybrid, collision, AI, race-control or input coefficient changes are introduced by the particle presentation.
- Replay and pause continue to own presentation time through the existing effect-playback path.

## Visual changes

### Wheel spray

Wet contact now scales the bounded spray rate with measured normal load and forms a rearward plume using the car's actual orientation. Spray retains only a smaller fraction of vehicle translation, receives more of the shared wind field, expands as it ages and falls slightly rather than using the same buoyancy as dust/smoke.

### Rain, spray and spark silhouettes

The continuation preserves the original 1,800-particle budget but partitions it into **1,200 contact particles and 600 rain particles**, with independent recycling cursors. A heavy-rain burst can no longer erase an already emitted tire plume. The twelve-car maximum-rain regression fills both budgets without growing either.

Rain now uses one instanced quad batch rather than point sprites. Its short exposure is projected from each droplet's recorded-wind-driven velocity. Perspective division, the actual render-target viewport and camera roll determine its direction and width; near-plane rejection and bounded screen length prevent screen-filling streaks. This is world-space precipitation, not a fixed vertical HUD overlay. Arrays are views of the existing pool, not a second simulation.

The contact-point batch retains anisotropic spray, brighter splinter-like sparks, soft dust/smoke and solid marbles from `1f2d085`. Spray has a soft birth envelope and broader age-dependent expansion. Both batches now participate in scene fog and depth testing, so the storm-haze work also applies to the particles. The cost is at most one extra effect draw per rendered view, 1,200 rain triangles, and bounded instance attributes; it is not a measured hardware FPS claim.

Particle size uses the current viewport and camera projection rather than a hard-coded 650-pixel scale. Rain spawns down to eye/road level so high-rate recycling does not keep the entire storm overhead. Rain remains centered on the player car; arbitrary photo-target precipitation coverage and terrain-specific droplet collision remain outside this increment.

### Atmospheric depth

The authored daylight state now exposes finite fog RGB channels in addition to density. Cloud cover retains its established contribution; precipitation additionally cools and darkens distant haze. The renderer consumes those channels directly. Night presentation still uses its separate reversible scene/fog scope.

## Validation boundary

The existing browser weather oracle remains the GPU integration gate. It drives an actual wet simulation, renders the particle system, requires visible pixel changes, verifies measured rain births, verifies rain advection against simulation wind, and proves cleanup returns to the blank frame.

The unit daylight/reference suite additionally requires a maximum-rain storm to have denser fog and lower RGB haze channels than clear weather while every daylight-state value remains finite.

`tests/wet-presentation.test.ts` checks separate capacity saturation at 24/60/144 display FPS, preservation of an existing spray plume through 2,000 subsequent rain births, shared instance storage, pause/seek cleanup, finite arrays, and explicit load-to-emission cases. The existing temporal fixture retains its original 2,000 N and 48 births/second assertions under the upstream load-aware rate; only its cleanup now disposes the rain mesh too.

`e2e/00-wet-presentation.spec.ts` measures the actual rain silhouette on the GPU (wind, camera roll, fog, depth occlusion, near plane and clear). Its second case advances a real wet simulation through a 1.2-second rendered sequence, then records chase, cockpit and trackside captures while checking that neither held particle state nor source snapshots change. This capture uses high settings at 960 x 540 with environment reflections to isolate particle presentation; the existing reference-view suite separately covers local reflections. It is not a full-lap review.

An independent `wet-presentation` CI job retains these measurements and screenshots early. The original full browser suite remains intact, and publication additionally depends on this new job. Local lint, TypeScript/build and unit checks are available; the local Chromium could not create a WebGL context, so the GitHub GPU evidence must be read before calling the visual gate passed.

Integration base: `1f2d085b85ea396846f55ff4c357abca48dc83dc`, which followed `42c390c` while work began from `63679fb`. Its load-aware wake, particle kind attribute, storm haze, water-film response, drainage and trackside changes are retained. See [the broader wet-broadcast milestone](WET_BROADCAST_FIDELITY_MILESTONE.md). Replay capture, telemetry storage, physics, audio and input code are unchanged by this continuation. Reference interpretation uses the repository's retained review; this is not a new inspection of all 100 original images.

This milestone does **not** certify final photorealism. The next Phase-27 work remains stronger original car silhouette/aero surfaces, driver/cockpit anatomy, authored crowd/terrain depth, and full-lap lighting/temporal review against the supplied references, followed by the complete human-driven section-146 audiovisual acceptance and final audits.
