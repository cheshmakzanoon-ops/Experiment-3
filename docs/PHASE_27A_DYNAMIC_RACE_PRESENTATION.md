# Phase 27A — dynamic wet-race presentation milestone

## Why this is the next milestone

The retained 148-section master directive requires the simulation, presentation and integration passes to converge in the same driven scenario. The current repository already has connected 120 Hz vehicle physics, evolving weather and surface water, replay/telemetry, pit service, race control, cockpit cameras, photo/replay tools and a now-hardened full-race recording path. The newest continuity milestone explicitly leaves the human-perceived audiovisual section-146 run and final quality standard open.

The supplied reference review also makes the next gap presentation-facing. Reference 096 is a wet cockpit composition, 095 is an in-race pit-service view, 039 is a broadcast replay cue, and 075–080 emphasize long-lens/broadcast/photo readability. The game already emitted rain and wheel spray from real state, but those particles still shared a mostly generic soft point treatment and the spray inherited enough vehicle velocity to remain too attached to the car. Fog density reacted to rain while fog colour reacted only to cloud cover. Those are visible integration gaps, not missing physics systems.

For that reason this pass starts Phase 27 with **wet-race readability and atmospheric depth** before adding more decorative content.

## Engineering contract

This pass is presentation-only.

- Spray still originates from measured wheel contact state.
- Emission uses wheel water, normal load, vehicle speed and the selected tire compound.
- Wake direction is derived from the recorded/rendered vehicle quaternion and existing world velocity; it does not feed back into physics.
- Weather wind remains the same wind carried by simulation/replay.
- Rain birth rate remains elapsed-time based rather than frame-count based.
- No tire, aero, brake, hybrid, collision, AI, race-control, input or weather-evolution coefficient changes.
- Replay and pause continue to own presentation time through the existing effect-playback path.

## Visual changes

### Wheel spray

Wet contact now scales the bounded spray rate with measured normal load and forms a rearward plume using the car's actual orientation. Spray retains only a smaller fraction of vehicle translation, receives more of the shared wind field, expands as it ages and falls slightly rather than using the same buoyancy as dust/smoke.

### Rain, spray and spark silhouettes

The bounded particle pool is unchanged in capacity. A new per-particle shape attribute lets the existing single draw call render:

- elongated narrow rain streaks;
- broader anisotropic spray droplets/mist;
- brighter splinter-like sparks;
- the existing soft dust/smoke treatment;
- the existing solid marble treatment.

This is one shader/material and one point pool, not a new unbounded effect system.

### Atmospheric depth

The authored daylight state now exposes finite fog RGB channels in addition to density. Cloud cover retains its established contribution; precipitation additionally cools and darkens distant haze. The renderer consumes those channels directly. Night presentation still uses its separate reversible scene/fog scope.

## Validation boundary

The existing browser weather oracle remains the GPU integration gate. It drives an actual wet simulation, renders the particle system, requires visible pixel changes, verifies measured rain births, verifies rain advection against simulation wind, and proves cleanup returns to the blank frame.

The unit daylight/reference suite additionally requires a maximum-rain storm to have denser fog and lower RGB haze channels than clear weather while every daylight-state value remains finite.

This milestone does **not** certify final photorealism. The next Phase-27 work remains stronger original car silhouette/aero surfaces, driver/cockpit anatomy, authored crowd/terrain depth, and full-lap lighting/temporal review against the supplied references, followed by the complete human-driven section-146 audiovisual acceptance and final audits.
