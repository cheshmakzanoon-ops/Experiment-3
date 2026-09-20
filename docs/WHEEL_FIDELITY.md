# Physical wheel state and visual fidelity — continuation of directive 6

This checkpoint follows the exact 148-section `MASTER_DIRECTIVE.md` (SHA-256
`f508a1b9be8e8a19a2ccc39d744e82d774cf95ecc773c12482efbcb9fb89f75c`). It addresses
steering/setup, telemetry/replay, and visual-suspension/tire-deformation requirements.
It does not certify the entire directive or commercial-game visual parity.

## Defects removed

Previously the tire solver used individual Ackermann, setup toe and local-damage
angles, while rendering gave both front wheels the common steering angle and
ignored rear toe and camber. Scaling the entire wheel pivot for tire condition also
shrunk the rigid wheel rim, brake disc and caliper. The suspension endpoint and
visible wheel could disagree.

The solver now retains its actual per-wheel steering and camber values in fixed
Float64 arrays. Both the force calculation and recorded snapshots consume those
same values; no grip, force, handling limit or AI advantage was changed. High and
reduced-detail wheel pivots interpolate the recorded angles. Negative setup camber
leans the wheel crowns inward. Wishbone endpoints transform with that pivot.
The steering-wheel display continues to show the common driver steering input,
not an arbitrarily selected road-wheel angle. F3 exposes the four recorded alignments.

## Rubber deformation without rubber rims

`src/rendering/tire-carcass.ts` keeps indexed tread and sidewall-marking geometry
separate from the rigid rim, spokes, hub and brake assembly. A bounded reduced
load/pressure deflection changes the rubber crown and sidewall. The bead remains
at the rigid rim radius. The bottom of the axle-plane contact patch uses the
recorded effective radius, including the existing rotating flat-spot term.

Deformation is calculated in the non-spinning axle frame and transformed back
into mesh space: the patch remains below the axle while the tread UVs roll.
Normals are refreshed, coincident UV-seam normals are reconciled, and conservative
bounds include every supported pose. Normal rendering and shadow passes therefore
consume identical actual geometry; there is no mismatched shadow-only substitute.
The update reuses vertex arrays, and an identical paused state skips uploads.
A replay seek recomputes from immutable base vertices, not an accumulated deformation.

Low-detail tires retain recorded radius while their rigid rims keep their size.
This is a presentation approximation, not a new tire-force or finite-element
solver. Its patch plane follows the wheel axle, not a separately recorded road
normal; full contact-plane/multibody fidelity remains open. The constants are
original bounded design calibration, not measured tire-construction data.

## Versioned recording contract

Snapshot protocol is **8**: 232 floats per car, 26 per wheel, debris begins at
car offset 200. `W.STEER` and `W.CAMBER` are the angles actually used by the solver.
Full-session replay pages enforce the protocol version. Older incompatible cache
pages are rejected rather than silently read with shifted offsets.

CSV now has **211 columns**. The existing first **203** names/positions are
unchanged. Eight appended columns (`FR`, `FL`, `RR`, `RL`, each steering/camber in
radians) carry the new measurements. Both the diagnostic ring recorder and the
full-session recorder retain these angles. Presentation interpolation cannot
modify the source physics/replay snapshots.

## Validation and limits

- Unit tests cover physical-angle identity, packed-region separation across 12
  cars, CSV mapping, replay interpolation and source immutability; load/pressure
  monotonicity, phase-independent contact placement, bead/normal/bounds safety,
  puncture and exact rewind/paused behavior.
- `e2e/02-wheel-fidelity.spec.ts` renders the production car and tire material,
  compares loaded/punctured fixture pixels, checks all three LODs and verifies
  rigid geometry and GPU geometry counts stay unchanged. These controlled images
  are not a claim that a player completed the final driving scenario.
- Existing worker, application, physics, race, pit, audio, camera and replay gates
  remain. CI now partitions the **complete** Playwright suite over three separate
  runners. All shards must pass before the tested build can publish; assertions,
  retries and individual test timeouts were not relaxed.

At local validation, all 438 tests passed and production build/lint succeeded.
The instrument canvas component passed. Local Chromium navigation was denied by
container policy and WebGL context creation was unavailable, so those failures
are environment limitations, not successful GPU/application tests. GitHub runner
GPU/full-suite results must be checked separately for the published commit.
The wider three-pass, representative-hardware and combined human-perceived
section-146 acceptance remain open.
