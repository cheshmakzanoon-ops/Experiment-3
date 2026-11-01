# Bounded live Formula dry asphalt

## Scope and unchanged reference

The already eligible canonical Aurel/Vellamar Formula road ribbons now use the
procedural dry substrate qualified in `47cb948`. This replaces only their
diagnostic road material. Eligibility, full-lap geometry/attributes, edge paint,
other-context coarse fallback and the single authoritative simulation are
unchanged. An eligible material/capability/preparation failure propagates; it
does not silently select the coarse road.

The qualified plugin, original Three factory, neutral texel data, frozen original
reference, output observer, masks and comparison bounds are unchanged. The exact
`47cb948` Babylon run `41261318300` passed 259 contracts and all 12 GPU journeys;
its artifact SHA-256 is
`b23de37c7506ab975ca681efbaee1791ffb0bdfe67a8bdf2bd1b6fb6b44f5e8f`.
All 15 original repeats were exact, all four independent negative controls
discriminated, and the candidate differed only at two single-channel pixels by
one RGB8 step. This is the controlled substrate baseline, **not acceptance of
this new live integration**. See the [probe scope](asphalt-substrate-probe-2026-11-01.md)
and [independent data boundary](asphalt-data-boundary-2026-10-31.md).

Unported: scanned asphalt, road macro/detail and racing-line/rubber state, wet
road/water film, grounding and light pools. Prelighting agreement does not imply
PBR/environment or complete four-discipline parity. Linux native reliability,
physical hardware and full-mode migration remain separate open gates.

## Ownership and readiness

- One surface owner creates one material and exactly three shared 512² maps:
  hardware-sRGB albedo, linear packed data and linear tangent normal. Every road
  chunk uses that material; paint does not acquire the asphalt plugin. Texture
  bytes, sampling, UV/world-space semantics and shader algebra are unchanged.
- Existing exclusive preparation compiles the actual scene variants. Current
  scene/owner identity, cancellation and two completed ready presentations still
  gate activation. Restart does not dispose an active compiler's resources.
- Context loss invalidates the substrate permanently. Restoration alone cannot
  rearm it; explicit rebuild owns fresh maps. Material-first, owner-first and
  scene-first disposal release the three maps once, without owning the scene's
  BRDF LUT or unrelated resources.
- Scene registration is not ownership: detaching an allocated paint/road material
  or map does not transfer it. Paint lifetime follows its actual disposal event.
  A surface-owner hook runs at the pinned Scene disposal notification, before
  Scene's material/mesh/texture lists, so retained detached resources also drain.
  Manual owner disposal removes that hook. Because an earlier observer can skip
  the hook, the view always attempts its owned cleanup after Scene disposal,
  preserving the first thrown value. Scene disposal alone is not that fallback.
  A texture is skipped as already released only after both its disposal event
  and a null internal allocation; Babylon emits the event before releasing it.
- Babylon 9.33.1 registers meshes/materials synchronously but notifies their
  added observables on a later task. Failure cleanup therefore captures the
  exclusive allocation interval rather than depending on those notifications.
  A partial PBR constructor can require base `Material.dispose`; a partial Mesh
  registered before its UBO exists requires completion through the fully built
  TransformNode base after AbstractMesh removal. These fallbacks apply only to
  failed construction, preserve the original exception and release observers.

Cleanup-error limits are explicit. Direct owner disposal attempts all owned
resources and retains the first thrown value, including null/undefined. Babylon's Scene notification
catch passes its error as Logger's numeric repeat limit, which can suppress the
actual log. The owner therefore reports **its own** callback error directly to
the console before rethrowing it; a reporting failure cannot replace that error.
Scene continues its resource lists but does **not** rethrow a notification error
and can skip later observers. An unrelated earlier callback error swallowed by
Scene is not recovered or newly reported by this owner. A texture-cleanup error
inside a material disposal listener can likewise skip later material observers.
Tests distinguish events, attempts and actual UBO/texture release, and verify
unrelated teardown for injected before/after-cleanup errors. A throwing disposer
is not assumed to have successfully released its allocation. No global Scene or
Logger wrapper, unbounded retry or production log suppression is added.

## Truthful observations and required acceptance

Four new counters derive from currently enabled road/submesh bindings, the exact
owned material/plugin and attached, registered textures with actual internal
resources: asphalt road chunks, materials, textures and hardware-sRGB textures.
Tests remove bindings/materials/textures and dispose resources so copied target
counts cannot satisfy the contract. The route publishes these observations only
after existing readiness, and clears them on loss, restart and stop.

Native smoke reads the four fields in its **existing single readiness snapshot**;
there is no additional polling, render or deadline. Expected Aurel counts are
38 road chunks, one asphalt material, three maps and one sRGB map. Full-lap GPU
fixtures additionally require the compiled asphalt marker on all 38/50 road
chunks, on no paint chunk, and exact retained/restored resource counts. All 12
existing journeys remain, including real route/model/loss/rebuild and the
independent original-factor/negative-control probe. Windows/POSIX path-normalized
import classification from `c340680` and all six separator cases are retained.

## Verification boundary

The affected selector passes **94/94 tests across seven files** and scoped ESLint
passes. Actual deferred-constructor notification tests, cancelled
preparation ownership, exact original full-lap geometry and native snapshot
validation are included. Independent read-only review covers these boundaries.
Final aggregate checks and exact input hashes are retained separately with the
increment's validation manifest.

Initial disposal failures, the strengthened partial-Mesh observer failure and
detached-owner/error-witness failures are retained alongside corrected passes.
One invocation collected no tests because
shared `/tmp` was full; the verified rerun routes temporary/cache files to the
workspace. This is not relabelled as a renderer result. No local Chromium bypass
was attempted. **GPU and native acceptance of this live increment remain pending
its exact-source Actions runs and image review.** No deadline, quality, security
or comparison gate is relaxed.

## Exact-source Actions qualification

The preceding pending statement describes the pre-publication checkpoint. Source
`f2cf877b4d5e6984ab8f193f2083684fcb3a7cb0` now has these independent outcomes:

- [Babylon run 41268495905](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41268495905)
  passed **293 contracts and all 12 real-WebGL journeys**, with no retries,
  skips or flaky cases. All **56 unique PNGs / 87 image attachments** were
  inspected. Full Aurel/Vellamar scenes bind the asphalt shader to all 38/50
  road chunks and no paint chunk, share one material/three maps/one sRGB map,
  prepare 115/151 variants and return owned scene resources to zero. Loss invalidates readiness/counts; restoration alone leaves them invalid,
  and explicit restart rebuilds them.
  Original references/negative controls remain independently qualified before
  candidate allocation. Recomputed pixel comparisons retain the earlier two
  one-channel, one-byte deviations; no comparison tolerance changed.
- GPU artifact **13069050168**, 7,930,891 bytes, SHA-256
  `f597398a03c57615107fdd41b65272ed001fd6d6d63ce975f368a7f6ee5de6e4`.
- [Required native run 41268495872](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41268495872):
  Windows and Apple Silicon passed **855 contracts each**, original model/wheel
  acceptance and all four compatibility journeys. Actual live-substrate counts
  remain 38/1/3/1 through initial/restart/model observations. Preparation is
  403/403; completed presentations are Windows 3→19→31 and ARM 3→9→21.
  All ten native images were inspected; the original car and textured road are
  visible. These are CI-hosted smoke tests, not representative physical-hardware benchmarks.
- Required Mesa completed initial/restart road presentations 3→9 and all 403
  preparation leases. The model loaded with ten scalar-height materials. Later
  normal frame 13 stayed pending for 30.063 seconds with 12 completed; CPU draw
  had returned in 14.2 ms. Wheel acceptance timed out; final failure evidence records GPU exit
  512/context loss with frame 13 pending. These observations use different clocks
  and do not establish the ordering of timeout and GPU exit. Compatibility
  journeys never began. The failure image shows the
  cleared scene and explicit context-loss/rebuild message. This is neither an
  initial road-readiness failure nor proof that road/model work caused the fault.
  No driver/watchdog/OOM cause is established. Development publication was
  **skipped**, so the older downloadable baseline remains unchanged.
- Windows artifact **13067639290**, SHA-256
  `a1d45a7194976a0a0772ad9f2bdaa3c9091ebc4210b3263dad312d93a199835a`;
  ARM artifact **13067943647**, SHA-256
  `f6ed5d04099c9bd6769cacdb7fced1f7630bc49d4c7c7ae383b50e70f66216a5`;
  Mesa artifact **13067659471**, SHA-256
  `ca16f806dd3767310000c96cd9e070c4e6409c9a1934de457196a1ad89ce12b0`.
- [Ubuntu24 diagnostic 41268495953](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41268495953)
  passed 855 contracts but stopped before application connection on the unchanged
  sandbox-helper requirement. It provides no graphics observation. No security
  setting, permission, watchdog or acceptance deadline was changed.

Live dry-substrate integration therefore has real renderer and two native-target
acceptance, **not** a complete supported desktop matrix, full original lighting,
weather/material parity, four-mode Babylon completion or retail qualification.
Separate driver diagnostics remain source-qualified and do not replace required
Mesa acceptance.
