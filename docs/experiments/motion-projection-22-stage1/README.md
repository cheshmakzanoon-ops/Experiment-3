# Explicit motion / end-projection experiment

**UNMERGED · UNACCEPTED · NOT FOR RELEASE.** This archived patch does not activate or integrate the candidate; the running main application remains physics **21**. The isolated candidate uses unpublished identity **22**, identified by its exact source fingerprint—not by the number alone. No race, calibration, performance or release acceptance is claimed.

## Purpose and supported scope

The vehicle adapter can explicitly separate a real integrated segment from a zero-duration end-pose projection. The collision solver queries the physical segment, uses consistent event geometry/inertia for accepted projected contacts, transports collision-only angular impulse to the published orientation, and still depenetrates actual endpoint overlap. Capture/advance/solve ownership is consume-once; unsupported or failed states do not reuse stale metadata. Ordinary direct calls and disconnected ordinary contacts retain legacy behavior.

The correction is intentionally restricted to a qualified grounded/riding dirt-bike dab. It preserves the actual clamp and lean-rate damping. The final qualifier rejects factored raw lean that crosses the body's existing `!airborne && abs(rawLean)>1.2` pose convention; it does not extend the upright formula or invent a fallen trajectory. Original differentiation remains the honest fallback, including any existing projection-related rate artifact on unsupported branches.

This is the existing linear-centre/shortest-arc **discrete path approximation**, not a uniquely reconstructed trajectory or a full no-dab rerun. Both original v21 and an earlier rate-only v22 missed the specified mixed-motion fixture. Original query exhaustion is not a no-contact certificate, and no wet-race crash cause is established.

## Reconstruct and verify

Apply only in a separate disk-backed checkout/worktree at exact base:

```sh
git worktree add --detach ../motion-projection-review 2caf3413013f522c74f708262996c437e9433744
cd ../motion-projection-review
git apply --check /path/to/checkpoint/motion-projection.patch
git apply /path/to/checkpoint/motion-projection.patch
python3 /path/to/checkpoint/verify.py .
```

Do not apply to main or a newer base and assume equivalence. The patch contains **15 changed/new files**, no raw logs or asset copies. `verification.json` records their base/final hashes and the complete 850-input runtime-source fingerprint. The verification helper is read-only.

With Node **22.23.4** and dependencies installed from the pinned lockfile (`npm ci`), the exact local commands are:

```sh
node node_modules/vitest/vitest.mjs run tests/motion-projection-contract.test.ts tests/motion-response.test.ts tests/collision-continuous.test.ts tests/session-identity.test.ts tests/time-trial-physics-archive.test.ts --reporter=verbose
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js src/simulation/substep-motion.ts src/simulation/motion-response.ts src/simulation/collision.ts src/simulation/vehicle.ts src/simulation/bike-vehicle.ts src/simulation/pose-kinematics.ts src/simulation/offroad/dirt-bike-vehicle.ts src/simulation/world.ts src/simulation/open-world/session.ts src/core/session-identity.ts scripts/physics-cost.ts tests/motion-projection-contract.test.ts tests/motion-response.test.ts tests/session-identity.test.ts tests/time-trial-physics-archive.test.ts
```

These commands do **not** run full calibration or race gates. Run broad checks serially on a suitably provisioned machine; this checkpoint makes no performance claim. The five extra frozen pair-family executions have retained evidence digests, but their raw harness/data are deliberately not included in this small checkpoint and are not silently represented as reproducible by the three commands above.

## Measured local evidence

- **182/182 tests:** 68 motion/lifecycle, 35 contact/callback response, 22 unchanged continuous-collision, 35 identity and 22 archive-preservation checks.
- Full TypeScript and changed-file ESLint pass.
- Five frozen actual-MX450 pair families were freshly executed with control/observer pairs (**10 executions**): projection-only separation; real crossing plus projection; actual endpoint overlap; ordinary CCD; genuine teleport. Same-source observer/control states match; every captured record matches the previous motion prototype.
- Both signs below/at/above the existing pose convention are tested. Four cases retain actual core output; six explicitly labelled post-core operator fixtures inject boundary values. They are not six naturally observed trajectories.
- Physics 21/20/19/18 records remain preserved and separated from the unpublished candidate category; no archive deletion or relabelling.

**Registry status is source-specific.** The previous motion prototype (`575314a4…`) completed 513 registry cases, 15 production representatives and two Valley branches. It preceded the qualifier defect discovery and is **not** final-source evidence. The final candidate (`40d61808…`) is undergoing all 513+15+2 fresh framed cases against verified archived v21 baseline checkpoints. This stage-one checkpoint records that confirmation as **running, not passed**; it must not be upgraded by inference from old results.

## Remaining limits

- Original reduced adapter absorption still omits Y/pitch feedback; no full-3D conservation claim.
- Callback cleanup preserves genuine state changes and applied impulses; it restores only unchanged temporary solver geometry. Failed/dirty worlds must not continue silently. Completed vehicle placement does not alone clear a retained failed solver frame; the owner must close/discard it. A poisoned dirt-bike restart requires explicit completed placement rather than assumed remount support.
- Canonical comparisons do not expose every private/WeakMap field, container property or backing-buffer alias. Track/private terrain and full session state are not universally hashed. Single-player Valley checks are not multi-rider acceptance.
- Original full calibration/race gates, broader integration, gameplay benefit, hardware performance and release review remain separate and unaccepted. This archived patch must not be integrated into the application or activated merely because local checks pass.
