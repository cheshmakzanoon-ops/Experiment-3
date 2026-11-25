# Wave 3: physics allocation and resource lifetime

All six assigned workers completed. No authored 3D content, environments, characters, asset files or vehicle tuning were changed. Collision-buffer writes, BVH bounds and clutch/contact arithmetic preserve numerical output.

## Changes

- BVH construction accumulates scalar node bounds before writing each bound once. The original triangle order, split policy and signed-zero semantics remain intact.
- Track contact construction removes 237,583 short-lived array literals at the default 8,192-row resolution. Geometry buffers are byte-identical.
- Road contact reuses its validated normal length; AWD clutch coupling computes its four-wheel maximum without an intermediate array.
- Texture registration batches wrappers by source and budget group. The 1,024-wrapper fixture performs one canvas draw and 1,024 version increments instead of 1,024 draws and 524,800 increments. Later registrations still repaint generated sources.
- Both renderers explicitly release their OutputPass. Festival disposal also releases its owned sky geometry/material and near sun-shadow targets while retaining the borrowed renderer.
- Mute cancels pending and scheduled driving-audio previews. Host blur and visibility suspension cover previews on menu and paused screens; disposal removes the bound blur listener.

## Validation

- Recovered physics changes: 78 tests in eight files passed in a fresh execution container.
- Texture batching and ownership: 19 tests in four files passed.
- Renderer disposal and host fixture integration: 58 tests in five files passed.
- Audio preview/lifetime/host cleanup: 56 tests in three files passed.
- Focused ESLint passed for changed code and tests. These suite totals overlap; they are not a distinct-test aggregate.
- A prior heavy native TypeScript physics probe exceeded the shared container memory budget before completion. No timing result is claimed from that probe. Controlled benchmarks and native GPU/audio checks are assigned to later waves.

These are engine-work and lifetime improvements; no end-to-end FPS improvement has yet been measured.
