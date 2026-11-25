# Assignment 20 — interrupted boot/selector contact

## Targeted correction

`src/simulation/offroad/mx-gear-stroke.ts` now coordinates the boot's clearance and cover routes when an accepted request interrupts a covered boot. Its incoming cover velocity first coasts to rest, while the boot moves outward around the sleeve. The cover transition then happens with outward clearance held; an upshift closes the lateral gap afterward. A repeated downshift keeps an already covered boot above the sleeve instead of unnecessarily crossing it twice.

The clearance waypoint is reached within 10 ms, the cover transition ends at 32 ms, and an interrupted upshift rejoins its original curve by 45 ms. A repeated downshift matches the canonical cover by 59 ms and retains the original return sequence. The selector bridge and its mechanical envelope are unchanged. All channels retain their incoming value and velocity; bounded Bézier control points and a bounded cover coast preserve C1 handoffs. The isolated curves, 260 ms stroke completion, gearbox acceptance and input cadence are unchanged. The new channels normalize a neutral signed-zero rate to preserve exact endpoint comparisons.

## Reproduced defect

Using the existing control-animation rig, an MX250 mid-detail downshift accepted at 0 followed by an upshift at 115 ms previously returned cover from 1 to 0 while clearance remained 0. At 120 ms, the boot and selector's actual vertical mesh intervals overlapped by **9.711 mm** at the existing 0.031 m sleeve station. This exceeds the established **3 mm** contact tolerance. The controller correction takes the boot around the sleeve before changing sides.

The checked pose uses each bike's static sag, a riding rider at standing 0.24, rear brake 0.75, neutral steering and chassis frame, and the recorded shift channels. No mesh, model, material, vehicle specification, environment or control-acceptance source was changed.

## Verification

```sh
npx vitest run tests/motocross-interrupted-shift-contact.test.ts tests/motocross-shift-continuity.test.ts tests/motocross-control-animation.test.ts
npx eslint src/simulation/offroad/mx-gear-stroke.ts tests/motocross-interrupted-shift-contact.test.ts
```

**40 tests passed across three files; focused ESLint passed.** The six new regressions cover:

- MX250 and MX450 at both mid and high detail, the LODs that include the selector. Three vertical ray stations across the authored sleeve use the actual articulated boot and selector meshes, with the existing 3 mm tolerance unchanged.
- All four direction pairs at twelve 60–259 ms interruption times, ten samples through each handoff, and a chain of accepted repeated/reversed requests. Together with contact positive controls and final settling, these evaluate 2,252 rig poses and 6,756 sleeve stations.
- Every integer-millisecond interruption from 60 through 259 ms, sampled over the following 60 ms, retaining outward clearance whenever the boot crosses the sleeve.
- Position/rate continuity at acceptance and coordinated waypoints, plus unchanged completion. The existing five continuity tests and 29 control/rig tests remain passing.

The tests assess sampled surface separation in the stated pose. They do not claim continuous triangle collision detection, every rider/terrain posture, or measured human acceleration limits. Far detail omits the foot-control geometry. No full type check was run; that gate belongs to the coordinator.

## Confirmed presentation follow-up — ordinary snapshot interpolation

The exact sampled motion is fixed, but an additional probe found that the runtime's independent linear interpolation of the three `MX_FOOT` fields in `src/rendering/bike.ts` can skip the necessary outward waypoint. This is a real remaining issue, including at nominal 60 Hz snapshot spacing: `src/workers/physics.worker.ts` publishes after at least two 120 Hz ticks. The coordinator assigned the reconstruction follow-up to assignment 27; this assignment deliberately leaves the reader and protocol unchanged.

Reproduce with an MX250 mid-detail rig and the same three sleeve stations as the new integration test:

```ts
const stroke = new MxGearStroke();
stroke.engage(-1, 0);
stroke.engage(1, .115);
// Copy [angle, cover, clear] at .115 and .115 + interval.
// Independently lerp the copied fields, pose the existing model and raycast.
```

The first endpoint is `[0.22, 1, 0]`. The following measurements use channel order `[angle, cover, clear]`; negative gap means overlap along the tested vertical ray.

| Snapshot interval | Second endpoint | Blend alpha | Blended channels | Minimum signed gap |
| --- | --- | --- | --- | --- |
| 8.333 ms | `[0.17851750241325004, 1, 0.9259259259259257]` | 0.3 | `[0.20755525072397502, 1, 0.2777777777777777]` | +1.382 mm |
| 16.667 ms | `[0.07744043082863368, 0.7801708545510193, 1]` | 0.4 | `[0.16297617233145348, 0.9120683418204077, 0.4]` | **−5.924 mm** |
| 33.333 ms | `[-0.16327490728039434, 0, 0.9705996392386922]` | 0.2 | `[0.14334501854392115, 0.8, 0.19411992784773846]` | **−14.541 mm** |

These temporary reader probes failed the unchanged 3 mm assertion. Their reproduction is recorded here; they are not included as passing controller coverage or hidden by a relaxed threshold.

### Reconstruction considerations for assignment 27

The foot's positions at two snapshots do not encode an intervening clearance maximum. Rates alone are also insufficient when the endpoint rates are both zero. Exact reconstruction can use the accepted command's start clock and direction plus its incoming three positions and three rates; these determine the current bounded selector bridge, cover coast, resting cover and clearance route. A reader must also respect an accepted command boundary inside a snapshot pair rather than interpolate one old trajectory across the new command. The current minimum accepted cadence allows at most one new command within a normal 16–33 ms pair, but stalled/coarse histories need a defined fallback.

The exact-pose test's ray helper is reusable for the reader regression. The follow-up should retain the 3 mm tolerance and cover nominal as well as coarse snapshot intervals, actual mesh separation, and unchanged direct endpoint poses.

## Files owned by this assignment

- `src/simulation/offroad/mx-gear-stroke.ts`
- `tests/motocross-interrupted-shift-contact.test.ts`
- This report

No git mutation was performed. Controller ownership was returned to the coordinator after the targeted change so that the shared reconstruction work can proceed independently.
