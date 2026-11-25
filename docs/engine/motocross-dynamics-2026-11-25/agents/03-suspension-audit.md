# Assignment 03 — suspension/contact/motion audit

Baseline: `b527a7e0`. Scope: production offroad spring/contact state and pure motion controllers. No model, environment, material, geometry, or production source edits made.

## Highest priority: publish suspension travel at the same physical instant as chassis pose

`DirtBikeVehicle.vertical()` calculates `cF`/`cR` from the incoming CG/pitch, applies forces, integrates CG/pitch, then publishes the **old** gaps as `compressionFront`/`compressionRear`. `writeBody()` publishes the **new** CG/pitch. `updateSuspensionAndTyres()` subsequently adds a 20 ms exponential low-pass to those already delayed gaps before publishing `fork`/`shock`. Machine-motion rates and renderer axle interpolation inherit this mismatch.

This has a directly reproduced consequence: rapid compression puts the axle strokes and sprung root at different physical instants. A smooth interpolation of inconsistent endpoints does not solve wheel support. The static geometry tests in `motocross-reference-geometry.test.ts` and synthetic pose tests in `motocross-sprung-pose.test.ts` mainly prescribe coherent inputs; they do not bound these errors in an actual landing.

### Measurements

Production `rideLine()` at a 15 m/s target, starting `place(track, 35)` on Valley Ridge, AI controls enabled, simulated for 20 seconds. Measurements include only frames where the bike is riding and grounded. The run has one crash per configuration; these are stress-path measurements, not a claim of clean race acceptance.

| Bike | Solver Hz | Maximum published fork/shock error | Maximum raw compression error |
| --- | ---: | ---: | ---: |
| MX250 | 240 | 148.90 mm | 37.20 mm |
| MX250 | 480 | 142.54 mm | 18.75 mm |
| MX450 | 240 | 149.51 mm | 37.46 mm |
| MX450 | 480 | 142.99 mm | 18.90 mm |

Errors compare each channel to the independent current-pose gap, clamped to mechanical travel. The almost unchanged 143–150 mm published error after doubling solver frequency demonstrates that the 20 ms presentation lag dominates. The halved raw compression error exposes a separate one-step timestamp defect.

One front-only MX450 observation at 240 Hz: `s=214.787737987024`, fork `0.146123491647681 m`, raw compression `0.2625766765810593 m`, current geometric gap `0.29107098439655954 m`, CG vertical velocity `-4.270899457815975 m/s`.

### Recommended engine-only fix

1. Preserve incoming contact gaps for force evaluation and bottoming/landing judgments.
2. Recompute presentation travel from the final authoritative CG/pitch at the existing contact heights, after integration/projection. Preserve clamping and explicitly account for genuinely unloaded wheels.
3. For the motocross publication path, stop independently delaying wheel travel relative to the authoritative sprung root. Smooth secondary elastic/rider response, or interpolate coherent pose snapshots, instead.
4. Keep physical spring-load calculation separate from the presentation-channel correction. Initially constrain changed behavior to MX250/MX450; verify supermoto/AI scope deliberately.

Safe ownership: coordinator owns adapter changes in `src/simulation/offroad/dirt-bike-vehicle.ts`; a separate worker can own a helper in `src/simulation/offroad/` and a dedicated dynamic suspension-coherence regression suite. No `dirt-bike-model.ts` edits are required.

### Acceptance scenarios

- Real MX250/MX450 surveyed jump approaches, one-axle touchdown, full compression, rebound and whoop departure at 120/240/480 Hz: require presentation travel to match the final clamped geometric gap to floating-point tolerance.
- Preserve the incoming force/bottoming calculation: compare speed/position/landing outcome to baseline if the change is strictly presentation publication.
- Stationary preload/fuel equilibrium and place/restart must preserve existing support tests.
- Record snapshots and render interpolated wheel/chassis support during actual descent and settlement, including a sequence with different front/rear strokes. Bound support discrepancy using actual generated transforms; avoid only synthetic matching inputs.
- Check replay reconstruction and paused identical-frame sampling.

## Other audit conclusions

- `RiderWeight` uses an exact critically damped step with finite stroke and momentum accounting. Existing tests cover reversal, substep independence, airborne trajectory invariance, touchdown and replay. No reason found to replace it wholesale.
- `wheelPickupImpulse` includes translational and rotational inverse mass and caps its impulse to rolling equality/friction. Existing energy/passivity tests are sound. Most player MX ground exchange now occurs in the independent ground solver, so changes to this helper alone would miss the live path.
- `MxMachineMotion` records deterministic beam modes and finite chain response. Its fork/shock rate is a finite difference of published travel, so fixing travel synchronization will also improve those motion tangents without touching meshes.
- `risingRateSag` is intentionally a calibrated six-iteration static inverse. Tests explicitly verify force reconstruction at existing bike loads. Changing its numerical method is lower value than fixing dynamic pose coherence and risks unrelated reference-geometry drift.

## Minimal reproduction

Run from repository root with Node's TypeScript transform support:

```js
import { DirtBikeVehicle } from './src/simulation/offroad/dirt-bike-vehicle.ts';
import { MX_450 } from './src/simulation/offroad/dirt-bikes.ts';
import { DEFAULT_SETUP } from './src/simulation/config.ts';
import { rigTrack, rideLine } from './src/simulation/offroad/jump-rig.ts';
import { factoryBikeSag } from './src/simulation/offroad/suspension-geometry.ts';

const track = rigTrack('valley-ridge-mx');
const bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, 'sport', MX_450);
bike.place(track, 35);
bike.aiControlled(1e9);
const reference = factoryBikeSag(MX_450), spec = MX_450.bike;
let maximum = 0;
for (let n = 0; n < 20 * 240; n++) {
  rideLine(bike, track, 15);
  bike.step(1 / 240, track);
  if (!bike.riding || bike.airborne) continue;
  const gap = bike.contacts[0].height - (
    bike.cgY + spec.cgToFront * Math.sin(bike.pitch) -
    (spec.cgHeight + reference.fork) * Math.cos(bike.pitch)
  );
  maximum = Math.max(maximum, Math.abs(
    bike.fork - Math.max(0, Math.min(spec.forkTravel, gap))
  ));
}
console.log({ maximum });
```
