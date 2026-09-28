# Supplied-player runtime tiers and validation gate

## Scope

This increment keeps Three.js, the current simulation, source RB19/R06 binary,
texture/material identity, suspension datum, camera sockets and snapshot-driven
steering/replay animation. It does not replace the supplied player with a legacy
car or claim final art, physical-hardware frame rates, or Steam acceptance.

## Source-preserving geometry

`npm run generate:player-lods` derives three index-only tiers from the exact
hash-pinned `public/models/supplied-player.glb.gz`. The original remains unchanged.
The generator runs before development, unit tests and builds. Its output is a
build asset, not another large binary committed to source history.

| Representation  | Triangles | Selection                                            |
| --------------- | --------: | ---------------------------------------------------- |
| Original        | 1,455,118 | High-quality followed car and close photo inspection |
| Efficient close |   855,654 | Low/medium-quality followed car                      |
| Medium distance |   814,806 | Existing camera-distance LOD 1                       |
| Distant         |   797,386 | Existing camera-distance LOD 2                       |

The build-time simplifier is pinned to `meshoptimizer@0.25.0`. Each of the 172
material primitives is processed separately. Borders and changes in skin
weights/joint indices are locked. All layered decals and their painted,
composite and tire support surfaces retain exact original indices, as do the
display, mirrors and small detail primitives. This explicitly prevents the
decal/surface intersections seen in an earlier, rejected simplification. Source vertex attributes, normals,
UVs, morph attributes, materials, bones and animation are not rewritten.
Error tolerances are simplifier estimates in source units, not surveyed surface
accuracy or a substitute for visual review. Material primitives are deliberately
not merged because doing so here would risk changing material and rig identity.

The geometry wrappers share immutable vertex attributes and own only reduced
index buffers. Tier changes allocate nothing per frame and retain the existing
logical distance hysteresis. The owner restores source geometry before disposing
all derivative wrappers; original resources remain owned by the normal scene.

The generated package is 3,906,174 bytes compressed (10,746,828 bytes decoded).
This is an **additional download**, not a claim of reduced loading time or texture
memory. Source and derivative hashes, primitive coverage, index ranges, budgets,
bounded downloads and cancellation are checked before use. Both explicit gzip
files and transparently HTTP-decompressed responses are supported. Missing or
corrupt required data stops loading instead of displaying a different car.

A deliberate source change requires rebuilding with `--update-manifest`,
reviewing the resulting geometry/images and committing the new manifest together
with the approved source. Normal builds refuse a different derived hash.

## Runtime and regression repairs

The camera-switch fixture now measures active supplied wheels rather than hidden
legacy wheels. Its original distance/long-lens assertions remain intact; the
player now genuinely changes detail instead of having its expected result
weakened. The general cockpit test uses the source eye socket with the chassis
offset applied once and verifies the active 58-joint rig, screen and mirrors.
Screen-visibility raycasts no longer traverse the hidden legacy player model.

Local fog retains all eight Gauss nodes and weights and the same optical tail
bound. Two vectorized batches combine the lateral/height exponential instead of
repeating scalar products. An independent scalar GPU control verifies pixel
agreement for low, high and long rays, including a fog-disabled negative control.
No existing full-scene atmosphere samples or resource/image assertions were
removed, and no per-test or job timeout was raised.

## Complete browser coverage

`npm run test:e2e:shard -- 1/8` enumerates the locked Playwright suite, assigns each
case exactly once using explicit scheduling estimates and keeps serial suites
atomic. It re-enumerates the actual CLI selection and rejects missing, duplicate
or additional cases before execution. Every worker retains one browser worker,
zero retries and the existing assertion/time budgets. `browser-shard-plan.json`
is retained with that worker's screenshots/traces, including failures.

The estimates balance long race cases that previously accumulated in the last
partition; they are not hardware timing measurements. `--plan-only` verifies
selection without claiming that tests ran. A runner-contract change fails closed.

## Publication

The CDN workflow no longer rebuilds or publishes on an unvalidated push. It only
accepts a successful main-branch Build and validation run from this repository,
downloads that run's gated `apex-formula-release`, verifies its source identifier
and both player asset hashes, and rejects superseded source. Publication appends
to the existing compiled CDN branch without force-pushing source or deployment
history. Repeating the same release is a no-op.

## September 28 render-cost continuation

The preceding source at `52e4b221` had successful geometry, camera and fog
regressions but not a green full-browser run (`36358747179`). Close-racing,
wet-following and pit-service event reviews ended without qualification, and
one full-lap review had only seven presented frames. The pit trace measured
668.69 ms GPU time at 320 x 200 and showed raised removal at simulation time
102.533 followed by repair at 105.003, missing installation. These are recorded
software-GPU measurements, not the user's hardware or proof of a physics fault.
The detector correctly rejects a service stage that was never actually rendered.

This continuation retains the exact supplied source and protected layered
surfaces. Revised derivative tolerances reduce efficient-close geometry from
998,950 to 855,654 triangles. Index selection does not alter rig weights, vertex
attributes, livery UVs, display/mirror geometry or the original high-detail tier.
The existing close-view pixel-error gate remains unchanged and must pass on the
new derivative; mathematical tolerances alone are not art acceptance.

Named transparent `Decal |` sheets now use Three.js `forceSinglePass`. This
removes the redundant separate back/front submission without removing either
side, changing alpha blending, or applying the rule to a visor/transparent
volume. Opaque rendering prioritizes front-to-back depth rejection within the
existing explicit group/render orders; transparent sorting is unchanged.

The existing texture-size/filter controls now include the actual immutable glTF
maps. Low and medium budgets resample from the retained original, while the
1024 setting restores its original ImageBitmap (all shipped maps are at most
1024 pixels). Each shared source owns at most one current reduced canvas.
Separate Source objects prevent budget changes from mutating loader-owned maps
or unregistered clones. Original pixels, glTF orientation, UV transforms,
colour-space bindings, and source identity are restored on teardown. Dynamic
wheel displays, simulation data, reflection targets and unmarked textures are
excluded. No KTX2 compression or reduced original download is claimed.

All populated event reviews now prepare the actual paused grid before enabling
AI/camera/recording, so slow interface setup cannot release opponents before
the player. No simulation timing, service duration, car position, event
qualification threshold, retry count, or test timeout is changed.

`tests/imported-render-budget.test.ts` checks ownership, restoration, opt-in
boundaries, material scope and stable opaque ordering. The added real-binary
`e2e/41-player-render-budget.spec.ts` compares old/new decal passes and opaque
ordering in front, rear and cockpit views, exercises Low/High texture changes,
checks exact restored pixels and bounded warmed resources, and attaches images
and synchronized studio-frame timings. Those timings include CPU and GPU wait;
they are not full-race FPS. Existing complete-race/event tests remain required.

## Evidence and independent remaining gates

The following component evidence describes the preceding checkpoint, not
certification of the September 28 continuation. The exact new commit's complete
Build and validation result remains authoritative.

At authoring time, focused local browser runs passed the two camera-continuity
cases, the expanded supplied-player case and the independent fog-quadrature
case. The expanded player case captures all original fit/steering/camera/rewind
views and five LOD comparisons. It checks retained mesh/material/rig identity,
actual submitted triangle reduction, exact full-detail pixel restoration and
stable warmed resource counts through repeated tier changes.

The component screenshots were reviewed, including original/efficient exterior,
cockpit and distant detail. These studio views are not a full-race art approval.
The original high- and long-distance full-scene fog cases completed within their
existing 300-second limits with vectorized fog. The general browser session,
cameras, pause, telemetry and replay case also passed in an isolated local run. Full source validation, the full eight-way
hosted browser run and the ensuing publisher must be checked on the final commit,
not inferred from these focused checks. The CI result is authoritative for that
commit; old checkpoint test totals are not current certification.

Physical target-hardware profiling, human manual full-race acceptance and final
visual polish remain independent requirements. In particular, a software GPU
trace must not be presented as the user's frame rate. The new geometry counts do
not certify a 60 FPS target, lower draw calls, compressed textures, DRS behavior,
editable baked decals, or commercial rights to the supplied team markings.
