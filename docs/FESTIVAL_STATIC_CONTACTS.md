# Festival static contact coverage

## Problems corrected

The Festival collision owner previously queried the structure cell and tree tile
containing the chassis centre. A chassis could overlap a neighbouring cell or
tile while its centre remained outside it. This left missed facade and trunk
contacts at otherwise invisible spatial boundaries, including negative world
coordinates.

The building narrow phase also relied on eight sampled chassis perimeter
points. A thin building entirely inside the chassis, or intersecting edges with
no sampled point inside, could pass that check. A trunk on a chassis centreline
could produce `Math.sign(0)` and a zero collision normal.

## Implementation

- `StructureGrid.queryBounds` visits the cells touched by the chassis yaw
  footprint. A reusable typed visit-stamp array deduplicates structures spanning
  several cells; a caller-owned candidate array retains stable structure order.
  The visit counter handles unsigned wrap. Placement-time `near` and `blocks`
  behavior is unchanged.
- `StaticFootprintContact` checks the two chassis and two structure axes. Its
  reused output contains minimum translation depth, a unit normal and a single
  support-feature contact point. It rejects separated and exactly grazing
  footprints and detects containment without perimeter sampling.
- Trunk queries expand the actual chassis footprint bounds by
  `MAX_TRUNK_RADIUS`, shared with `trunkRadius`, then visit each intersecting tile
  once in integer coordinate order. The current vehicle fleet spans at most two
  tiles per axis. Tree arrays remain owned by the existing bounded LRU; exact
  horizontal rejection happens before terrain height lookup.
- A centred trunk has a deterministic shallow-axis escape normal, opposing
  motion on that axis where available. A near-vertical chassis forward vector
  obtains a finite yaw frame from its projected side axis.
- The oriented chassis vertical interval, finite building/tree heights, ground
  anchoring, existing collision impulse response, penetration cap and occupied
  reset placement are preserved.

## Verification

`tests/open-world-static-bounds.test.ts` covers unique sorted structure
candidates, visit-stamp wrap, positive/negative cell edges, fully contained and
crossing structures, rotated-footprint rejection, exact grazing, multi-cell
deduplication and a vertical chassis forward vector. Tree cases include an
actual generated Solvane trunk across a tile edge, four tile-corner combinations
with negative coordinates, one impulse per trunk, a no-contact control without
terrain lookup, centred-trunk dissipation and bounded cache residency.

The focused validation set also includes the existing finite-height, occupied
reset, free-roam session and traffic suites. TypeScript and scoped ESLint checks
accompany those runtime regressions.

Validation result: **42 tests passed across five files**, including 16 new
spatial-boundary/contact tests, six finite-height tests, three occupied reset
tests, ten free-roam session tests and seven traffic tests. `tsc --noEmit`,
scoped ESLint, formatting checks on the new files and `git diff --check` passed.

## Limits

Static buildings retain a yaw footprint plus a separate oriented vertical
interval. This is not full three-dimensional box contact, roof support,
continuous collision detection or a multi-contact manifold. The owner still
resolves one deepest building contact per collision call and retains the
existing per-trunk response. Extremely small configured tree-cache budgets can
evict neighbouring tiles between calls; residency remains bounded, while the
normal default budget retains the local working set.
