# Development checkpoint — 2026-09-17

This is an incremental implementation checkpoint, **not completion of the master directive**.

## Reconstructed and committed source

The earlier unpublished working directory did not survive; see [RECOVERY.md](RECOVERY.md). The changes below were reconstructed on the verified application baseline, rather than silently treating historical reports as proof of recovered code.

- BVH triangle queries along suspension axes, seam-stable normals, and a separate physical contact ribbon.
- Oriented chassis boxes, sweep-and-prune, separating-axis contact, and rotational normal/friction impulses.
- Contact-localized wheel/suspension damage, punctured tire pressure/radius/grip, graining, blistering, and flat-spot contact variation.
- Bounded physical wing fragments and lost component mass. Fragment presentation and full repair bookkeeping still need integration.
- Physical jack support forces, pit-release and merge prediction, three-rate AI, swept traffic-lane planning, and an executable long-run acceptance harness.

## Validation of this checkpoint

`npm run check`: **62 unit tests, lint, TypeScript and production build passed** locally. Local browser navigation was denied by the environment; no local WebGL pass is claimed. GitHub browser CI is a separate gate.

The source fingerprint for the latest long-run trials was `2f6fc69f7ab257ea84853b38b70d66e7ee6e48c585683e9105271aa6e1a36ff3`.

| Trial | Result | Observed failure |
|---|---|---|
| Ten cars, requested 50 laps, seed 4417, clear | **FAIL** | Minimum 49 laps reached; car 0 remained in service phase 5 for over 100 simulated seconds. |
| Ten cars, requested 100 laps, seed 73021, clear | **FAIL** | Minimum 46 laps reached; car 7 remained in pit approach phase 1 for over 100 simulated seconds, with contact damage. |

These trials substantially outlasted the earlier traffic implementation but do not satisfy either endurance gate. The next repair targets pit-lane service/fast-lane interaction, deadlock-free release, and the physically driven approach. Do not lower acceptance thresholds to make these failures disappear.

The normal GitHub validation workflow remains. Temporary patch-transfer files/workflows are removed in this source checkpoint. Actual readable source files, not an encoded patch, are the delivered application.
