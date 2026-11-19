# Vellamar road-profile continuity

## Defect and correction

The original four-lap `vellamar-gp-motorcycle-sprint` event completed with eight
falls, exceeding the existing six-incident acceptance limit. All eight were
roll-limit lowsides between stations 3659 and 3715, without a preceding vehicle
impact. The first affected rider lost both road contacts for 19 consecutive
1/240-second physics steps at stations 3620.90–3625.26. Side velocity grew during
that 79.2 ms flight, followed by front-only touchdown and an unrecoverable
roll/yaw excursion.

The road elevation passed through its authored values but had a discontinuous
slope. `periodicProfile()` used uniform-parameter Catmull–Rom derivatives for
knots with unequal station intervals. At the authored 3620 m knot, the adjacent
intervals are 220 m and 127 m long. The same normalized tangent was therefore
converted to two different physical road grades. On the actual 3997.268925 m
track, the one-sided grades were −0.0395428485 and −0.0684992242: an abrupt
change of −0.0289563757.

Each knot now owns one derivative in station units, computed from its periodic
neighbors. Adjacent cubic Hermite intervals share that derivative and scale it
by their own interval lengths when evaluating the cubic. The corrected grades
at this knot are −0.0501407299 and −0.0501407258; the finite-difference residual
is 4.01e−9. The authored elevation remains 8 m. Every authored elevation and bank
knot, the periodic seam, and the original uniform-spacing interpolation are
covered by regression tests. This change does not flatten the circuit or alter
its design points.

## Affected production paths

`src/simulation/circuits.ts` contains both production callers of the helper:
Vellamar elevation and Vellamar bank gain. Their common definition feeds the
road mesh, collision surface, terrain placement, and car and motorcycle
simulation. Aurel, the catalogue circuits including Arroyo Oro, and offroad
profiles do not call this helper and are unchanged by this patch.

The existing nonnegative bank-gain clamp is retained. The raw periodic cubic
has shared endpoint slopes; the clamp can still introduce a derivative change
where its result reaches zero. The tessellated collision road is also still
piecewise planar. The correction does not claim that every collision normal
is globally continuous.

No suspension constants, tyre coefficients, force limits, AI gains, speed
targets, race thresholds, or deadlines were changed. The road geometry itself
now satisfies the interpolation contract required by the sprung contacts.

## Independent contact evidence

The contact regression prescribes traversal of the real Vellamar road at two
lateral offsets and three speeds. Front and rear heights come from
`Track.cast()` against the actual owned collision ribbon. They drive the
unchanged production `RoadBikeSuspension` of a GP R1, without a planar steering
controller or AI. Initialization includes the measured road-height velocity;
the approach starts at station 3500, before the measured window 3605–3640.

| Lateral offset | Speed | Old zero-support steps | Corrected zero-support steps | Corrected minimum total load |
| --- | --- | --- | --- | --- |
| 0 m | 40 m/s | 0 | 0 | 2407.58 N |
| 0 m | 55 m/s | 22 | 0 | 2460.50 N |
| 0 m | 60 m/s | 33 | 0 | 2483.74 N |
| −2.2 m | 40 m/s | 1 | 0 | 1717.64 N |
| −2.2 m | 55 m/s | 24 | 0 | 1884.16 N |
| −2.2 m | 60 m/s | 34 | 0 | 1926.91 N |

The test also checks finite suspension state, successful real surface casts,
and supported contact at each measured step. Replacing only the interpolator
with its old implementation makes seven of the ten new tests fail: both
nonuniform derivative checks and five of these six contact traversals. The
authored-value and uniform-spacing compatibility checks continue to pass.

## Event and acceptance status

The exact original sprint configuration was replayed: seed 3303, clear weather,
eight GP R1 riders, four laps, medium tyres, sport assists, default setup,
automatic player, and a 1/120-second world step. It completed with zero falls
after the correction, compared with eight before. Completion time changed from
399.124199 s to 376.990866 s. These event diagnostics establish the local
regression result; they are not a replacement for the original full matrix.

The initial focused run passed 56 tests across seven files: the ten new
profile/contact tests plus the original circuits, road suspension, road
contact surface, road ownership, racing line, and kerb/runoff tests. The
circuits tests include a production Formula car drive on Vellamar. Scoped lint
passed. The integrated checkout also passed all ten new regression tests and
the complete TypeScript check, both with exit code zero. An earlier isolated
typecheck was inconclusive because that reduced snapshot omitted unrelated
imported assets and e2e fixtures; both receipts are retained in the evidence.

The preceding complete original 19-scenario matrix had 17 passing scenarios;
its other failure was the separate Arroyo Oro superbike event. Final matrix
and complete unit-suite acceptance must use the corrected integrated source
after that investigation, keeping all original thresholds. Vellamar's changed
definition also changes its geometry-derived circuit identity; release-level
simulation versioning remains part of the integration review.

Exact values, source hashes, event configuration, and validation receipts are
in `docs/studio/reports/evidence/vellamar-profile-continuity.json`. The permanent
regression is `tests/vellamar-profile-contact.test.ts`.
