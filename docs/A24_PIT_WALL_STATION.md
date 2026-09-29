# A24 — Aurel pit-wall command station, revision 01

## Implemented scope

One original four-position engineering station is integrated into the normal circuit construction and production asset-loading path. It sits at track station 106 m, lateral offset 15.8 m, on the median between racing runoff and the pit lane. The full 3.1 x 8.1 m conservative envelope leaves at least 1.05 m to the pit driving ribbon and 2.21 m to the main racing/runoff ribbon in the current circuit. A sampled level foundation embeds into the existing grade. No pit-service box, outer fence, car spawn, simulation channel or collision rule is changed. The station is scenery, not a newly simulated collision barrier or a claim of regulatory safety compliance.

The asset includes a formed canopy with underside ribs, fascia and drainage edges; four shaped consoles and service panels; eight monitor enclosures with hoods, mounts and rear vents; contoured seats with cushions, armrests and foot rests; stored headsets and intercom controls; protected power/data trunks, junction boxes and cable bundles; mounting hardware; original Aurel identity. There are no static human stand-ins. Seventeen sockets support four future seated engineers, paired hand targets, stored headsets and a supervisor.

## Retained source and runtime files

- `scripts/author-pit-wall.py`: original procedural Blender authoring script.
- `scripts/aurel-pit-wall-command-station.blend`: editable components and material-batched runtime levels.
- `public/models/aurel-pit-wall-command-station.glb`: self-contained runtime export.
- `src/rendering/pit-wall-station.manifest.json`: byte/hash/geometry/socket/placement contract.
- `src/rendering/pit-wall-station.ts`: bounded acquisition, integrity validation, placement, LOD and resource ownership.
- `src/rendering/pit-wall-display.ts`: read-only snapshot extraction, clock and shared atlas rendering.

The export contains 44,544 / 20,320 / 2,372 triangles across its three levels, 10 material roles, one original embedded 128-square tangent-space micro-normal map, and 17 placement sockets. Its 6,282,844 bytes include all three levels. The close and middle counts are above the initial illustrative 40k/15k targets; the retained limits are 46k/21k/3k, with browser submission measurements required rather than pretending that the first targets were achieved. Only one LOD is rendered at a time; fine hardware disappears before the structural silhouette.

The station is protected from destructive static batching and uses lens-aware distance plus hysteresis. Screen faces across all LODs share one 2048 x 1024 canvas atlas and one material. The atlas is dynamic, excluded from ordinary texture downsampling, and uses glTF-compatible orientation. Existing sun, environment, fog, shadow and venue-light systems illuminate the structure; no extra scene lights, reflection passes or per-monitor lights are introduced.

## Actual session and replay data

Eight screen tiles show session state, lap timing, powertrain, energy/control, race control, car condition, weather and up to four classification positions. Values come from the renderer's **presented frame**, never a wall-clock animation, fabricated telemetry chart, AI suggestion, or mutation of the simulation. Speed converts metres/second to km/h and battery energy uses the same 4 MJ scale as the existing steering display. Missing lap measurements are `--`; disconnected/invalid data is `NO DATA`; menu displays use `STANDBY`.

This is the player's station, so its car-specific data stays on car zero even when a replay camera follows an opponent. Displays label LIVE, REPLAY or HELD explicitly. Advancing simulation updates are throttled to five Hz. A backwards seek, mode switch, visible return or corrected held snapshot refreshes immediately. Repeated identical paused snapshots do not upload another texture. Distant/off-camera/inactive station views suspend uploads; diagnostics report the last displayed sample, not an invented current sample. Mirrors reuse that representation rather than advancing its data independently.

## Validation

`tests/pit-wall-station.test.ts` covers author provenance, retained source, byte corruption, bounds/clearances, sockets, static batching, three LODs, shared eight-tile UVs and face orientation, real presentation/replay packets, pause/throttle/visibility behavior, one-time resource disposal and cancelled/oversized/truncated transport.

`e2e/44-pit-wall-station.spec.ts` covers normal menu/practice loading and real-circuit views in day, sunset and rainy night. Each lighting survey records circuit-facing, engineer-facing and monitor-detail PNGs plus the exact atlas. It checks unchanged frame/water arrays, stable geometry/texture allocations, held/rewound/restored screen timestamps, bounded added draw submissions and WebGL errors. The inspection fixtures use actual CircuitScene and renderer materials with fixed survey cameras; they are not a human-driven lap or hardware FPS certification.

```sh
blender --background --factory-startup --python scripts/author-pit-wall.py
npm ci
npm test -- tests/pit-wall-station.test.ts tests/hero-garage.test.ts tests/race-view-continuity.test.ts
npm run check
npm run test:e2e -- e2e/44-pit-wall-station.spec.ts e2e/43-hero-garage.spec.ts
```

### Export identity

The chosen hosted export is SHA-256 `702497c1a912213fbd5f047dda1b28b7fe4e08ad001c57d34f1d84fbf20c1cf3`. Two independent hosted runs produced these bytes. The local export `3c451d60a898836ca95c0cb1fc1fd00f29ad1177f3b6d3505911f910ad185e03` differed in indexed geometry/vertex packing; the embedded texture, counts, hierarchy and sockets agreed. That failed reproduction was retained, not called a pass. Pixel equivalence and universal cross-host byte reproducibility are not claimed. Regenerated exports are candidates requiring review. Runtime integrity remains exact, and tests run against the chosen export. The read-only authoring workflow reports future differences without overwriting release assets.

Hosted main CI remains the complete regression gate. A locally passing focused suite does not establish a completed hosted workflow or external-site deployment.

## Remaining acceptance

`finalArtApproved` remains false. This is a first integrated asset revision, not AAA-parity certification. Further material/lighting art review, full-lap camera scrutiny, distant wire/edge stability and physical-hardware GPU measurements remain. The optional engineer characters and their interaction animations are not part of this asset. There is no new collision/safety-wall system, no new race-control behavior, and no teleportation into the station or garage. The previously reported cockpit-camera defect is unchanged and still requires its own repair. GitHub source publication does not by itself redeploy a separately hosted AppDeploy/ChatGPT site.

## Provenance and implementation references

All mesh construction, labels and micro-surface pixels are original. Built-in Blender text is converted to geometry; no font files, commercial-game assets, copied team logos, stock scans or photographic textures are included. Existing car, cockpit, driver and A22 garage assets remain byte-identical.

The implementation follows the [Blender glTF custom-property/export convention](https://docs.staging.blender.org/manual/en/latest/addons/scene_gltf2.html) and [Three.js texture orientation and update semantics](https://threejs.org/docs/pages/Texture.html). The repository's pinned Blender authoring version and Three.js dependency remain unchanged.
