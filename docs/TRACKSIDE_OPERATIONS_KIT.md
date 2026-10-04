# A08–A10 — Trackside operations, integrated revision 1

## Delivered scope

This implementation continues the exact `f952d587fa9a3ccfae562611371bb18cea2987a4`
A01–A07 source tree. The normal asynchronous Aurel renderer loads three original,
self-contained GLBs. Other tracks retain their previous presentation. No vehicle,
track geometry, collision boundary, race-control simulation, timing rule, replay
protocol, save format, quality setting or camera director is replaced.

| Family | Placement and construction | State ownership |
|---|---|---|
| A08 | 12 panel backcases with fittings and cable routes, 13 utility cabinets, 3 passive timing-sensor housings at start and exact one-third/two-thirds splits | Retains the original LED geometry; five cached materials use the same recorded local witness as the physical marshals |
| A09 | 18 approach-facing 50/100/150 boards at the original six braking zones; two S1/S2 markers with detailed backs, posts, weighted feet and restrained wear | Distances remain in the authoritative venue plan; five shared label textures, not one texture per board |
| A10 | 20 dry/rain camera assemblies with lenses, hoods/covers, heads, tripods, access platforms, ladders and cable routing | Original optical origins, coverage, lens framing and replay director remain unchanged |

A08 uses the existing `postSignal` function: a post shows the recorded local flag
of the nearest eligible car within 45 metres, with the existing start/finish
chequered exception. It is a bounded presentation witness, not a newly computed
race-wide incident-zone map. Pitting/retired witnesses are excluded. Green,
yellow, double yellow, blue and chequered presentation is supported; absent
race-control states are not invented. Updates follow the supplied frame rather
than a wall-clock or a second animation loop, including held/replayed/reset frames.
LED meshes are explicitly preserved through static batching. Disposal restores
their borrowed materials and frees the five owned palette materials once.

Timing-sensor models decorate existing timing stations. They do not add simulated
inductive loops, transponders, timing packets or a new timing engine. A10 includes
pan, tilt, optical, tripod, cable and operator-grip sockets; mechanical tracking,
operators and live video feeds are not implemented. Camera hardware is fitted
around the unchanged optical positions and checked for self-occlusion. This is
an integrated art revision, not final-art approval or commercial photorealism.

## Provenance and authoring

Only the independent A08–A10 families from the user's
`Experiment-3-A01-recovery.zip` version 23 were reused. The archive's older renderer,
landscape, people and historical test claims were not substituted for current
main. `TRACKSIDE_OPERATIONS_PROVENANCE.json` retains the original identities.

All three families were re-exported in **Blender 5.2.2 LTS**, then reopened from
native files in separate processes to verify editable components and packed maps.
The A10 revision adds explicit pan/tilt/operator-grip sockets. Each family has
three authored detail levels and one shared structural PBR atlas with three
packed 512-square maps. A09 print faces reuse five small generated label textures.
Combined GLB transfer is under 4 MiB. Exact per-level counts and hashes are in
`src/rendering/*.manifest.json` and `TRACKSIDE_OPERATIONS_AUTHORING.json`.

```sh
python scripts/rebuild-trackside-operations.py \
  --blender /path/to/blender-5.2.2-linux-x64/blender \
  --output-root /tmp/aurel-operations
```

The wrapper requires the pinned Blender version, exports only the three named
scripts, performs native round-trips and writes a receipt. Do not export over an
artist's open source file. Cross-host binary equality is not assumed: any hosted
export must retain every construction-manifest field and pass its own exact-hash,
geometry and rendered-scene checks. Source and hosted identities are distinct.

## Runtime constraints

Placement is deterministic and based on existing track/station frames. Feet are
conformed to ground without altering the physical road. Mirrored towers and
housings preserve winding and recompute normals after conformance. Station LODs
share materials and retain silhouette; no new frame loop or per-frame geometry is
created. Disposal, failed transports, cancellation, byte limits, packed-resource
contracts and source-template immutability have focused tests. Dynamic LOD counts
remain separate from immutable environment identity, preserving menu-to-driving
identity assertions. Existing full-frame render budgets are not raised.

## Validation commands and evidence boundary

```sh
npm ci
npm run check
npx playwright install --with-deps chromium
APEX_BROWSER_BACKEND=mesa xvfb-run -a npx playwright test \
  e2e/57-trackside-operations.spec.ts
```

The five new unit suites cover geometry integrity (including zero-area triangles),
normals, UVs, sockets, authoritative placements, all 20 camera optical sites and
wide-view clearance, route/stand offsets, palette state, replay/reset, bounded
memory ownership and transport failures. The new browser observer uses the full
production factory, current cars/people/venue, twelve-car normal cockpit rendering,
11 fixed asset views, an original replay optic and a live-panel pixel measurement.
Day, sunset and wet-night are independent runs. Hidden-kit negative controls must
change visible pixels. Direct renders retain the existing 1,800-call ceiling;
normal cockpit frames retain the existing separately accounted complete-frame
budget. Matching baseline/candidate captures are observations, not hardware FPS.

A yellow-light test uses an explicitly constructed incident fixture passed through
production race control; rendered snapshot fields are not patched to invent the
flag. This does not represent an unassisted human-driven lap. Other palette states
are covered by deterministic unit fixtures. Existing full-lap, cockpit, grid/pit,
A01–A07 and wet-render tests remain unchanged. Actual executed outcomes belong to
the exact source run and retained reports, not this scope document.

Local Chromium launches but normal application navigation returns
`ERR_BLOCKED_BY_ADMINISTRATOR`. This is not a browser pass; production navigation
is verified on the repository's existing GitHub Actions Mesa backend. Human
full-lap review, target-hardware/controller performance, night-art approval,
Vellamar propagation, operating recovery gates and aborted-start race control
remain separate open work.

## Supplemental inspection observer correction

Run `37162990699` preserved the initial failures instead of marking them as
passes. The unchanged baseline's new board-back and camera-platform inspections
exceeded the old aggregate 1,800 draw-call assertion. A direct WebGL render can
also submit shadow maps; the supplementary observer now records colour and
shadow work separately with the existing `DrawLedger`. It requires exact totals
and bounds each submitted pass below 1,800 calls. Original infrastructure and
cockpit tests, their aggregate limits, and the 2% complete-cockpit regression
check remain unchanged. A fresh hosted run must establish these new inspection
results; the failed run is not approval.

The local panel pixel sample also projected before the unparented camera had
updated its world matrix. The inspection now updates that matrix before reading
screen coordinates. No camera placement, lens, race frame or runtime rendering
is changed by this correction. New unit negative controls cover pass totals,
missing/invalid/oversized passes and stale camera projection.
