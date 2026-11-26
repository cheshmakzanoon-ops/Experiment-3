# Agent 05 — motocross lifecycle audit

Date: 2026-11-25. Audited HEAD: `f3b39eb8e1b02fc0677086819fc384b6ceacefc2`.

Read-only production audit of dirt-bike placement, reset, rider/AI handover, recovery, machine/gear state, and input-journal replay. No production edits, dependency operations, hooks, commits, or pushes. Protected models, geometry, materials, tracks, and environments were not changed. Excluded the already reported pose-derivative, remount-heading, and diagonal-speed issues.

## Confirmed findings

### L05-1 — P2: meeting gate choices are recorded but ignored by physical placement

**Cause:** `src/simulation/offroad/session.ts:165–179` always uses `pickGates(order, slots.preference)` when placing vehicles. It never reads `options.gates`. The constructor independently honors `options.gates` at lines 126–139 and records the chosen slot/lateral. Thus authoritative vehicle positions and the session's gate metadata disagree from tick zero.

**Runtime evidence:** Constructed a two-rider `valley-ridge-mx-moto-1` simulation with vehicles `mx450`, `mx250` and valid `gates: [9, 8]`. The validated options retained `[9, 8]`.

| Rider | Reported gate index | Actual lateral, m | Selected gate lateral, m | Error, m |
| --- | ---: | ---: | ---: | ---: |
| 0 | 9 | -5.175 | +5.175 | -10.350 |
| 1 | 8 | -4.025 | +4.025 | -8.050 |

The venue's default preference was `[0,1,2,3,4,5,6,7,8,9]`, explaining the actual locations. Choosing gates `[0,1]` yielded matching positions and metadata, confirming this depends on selecting non-default gates.

**Impact:** A meeting's gate choice does not determine where the bike starts. If the front tyre reaches the closed gate, `session.ts:344` places the bike at `e.slotLateral`, which now differs from its original lane: the gate collision path can therefore move the bike across the grid. The initial mismatch was executed and measured; that subsequent displacement follows directly from the gate-wall placement call and was not separately simulated.

**Existing coverage gap:** `tests/offroad-meeting.test.ts:120–130`, named “lines every rider up on the gate the meeting picked,” checks `entrants[].slot` only. It never compares vehicle lateral position with the selected gate.

**Repair direction:** Resolve gate picks once, using the same validated choices for placement and session metadata. Regression coverage should compare every vehicle's physical lateral position with `gateSlots(...).lateral[options.gates[id]]`, including a non-default player choice. No track or model change is needed.

### L05-2 — P2: automatic player recovery does not select the stranded-bike restart policy

**Cause:** The inherited `BikeVehicle.recoverIfUpset` recognizes six seconds of stationary throttle and calls `this.restart(track)` (`src/simulation/bike-vehicle.ts:1323–1338`). The dirt-bike override defaults the missing reason to `'rider'` (`dirt-bike-vehicle.ts:1811–1812`). Consequently it calls `planRemount(track, false)` and excludes both the extra approach run-up and rear-wheel reach used for stranded bikes (`1868–1880`). The live session invokes this inherited recovery for every vehicle after physics (`world.ts:199`). In contrast, the off-road AI explicitly passes `'stranded'` (`offroad/ai.ts:462`).

**Runtime evidence:** With the same simulation's player MX450, placed at BARN DOUBLE's `jump.start - (cgToFront + frontWheelRadius) - 0.12` and lateral `-2.5`, stationary with throttle 1:

1. Before recovery: station `299.22971191492456`, state `riding`, speed 0, not retired, not in pit.
2. Called `recoverIfUpset(BIKE_RECOVERY.stuckSeconds + 0.01, track)` to exercise the timer boundary directly. It returned `true`, but station remained exactly `299.22971191492456` and state remained `riding`.
3. Called `restart(track, 'stranded')` from that same position. State immediately became `remount`, arming the visible assisted push.

This is a narrow recovery-contract probe, not a six-second end-to-end driving simulation. It confirms that the automatic stationary-player recovery omits the reason that activates the approach/rear-tyre recovery policy. The existing AI regression at `tests/motocross-ai.test.ts:457–483` deliberately distinguishes ordinary reset and stranded reset at this approach location, making the missing caller reason material rather than cosmetic.

**Impact:** When a manually controlled bike qualifies as stranded within those extended recovery regions, the timeout can report recovery while leaving it at the same unusable restart location. AI has the enhanced policy; the player timeout does not.

**Repair direction:** Give the dirt-bike stationary-timeout path the stranded reason while preserving the base road-bike behavior and ordinary rider reset semantics. Cover the actual `recoverIfUpset` entry point at the existing approach/rear-wheel fixtures, rather than testing only a direct `restart(..., 'stranded')` call.

## Reproduction

Executed directly through Node's installed TypeScript transform, without npm hooks. One simulation, two riders, no long race or test worker pool:

```js
import { Simulation } from './src/simulation/world.ts';
import { DEFAULT_OPTIONS } from './src/simulation/config.ts';
import { EVENTS, eventSession } from './src/simulation/events.ts';
import { gateSlots } from './src/simulation/offroad/session.ts';
import { offroadCourse } from './src/simulation/offroad/venues.ts';
import { BIKE_RECOVERY } from './src/simulation/bike-vehicle.ts';

const event = EVENTS.find(e => e.id === 'valley-ridge-mx-moto-1');
const sim = new Simulation({
  ...eventSession(event, DEFAULT_OPTIONS), opponents: 1,
  vehicles: ['mx450', 'mx250'], gates: [9, 8],
});
console.log(sim.cars.map((c, id) => ({
  id, actual: c.lateral, expected: sim.offroad.entrants[id].slotLateral,
})));
const bike = sim.cars[0];
const course = offroadCourse(sim.track.circuit);
const jump = course.jumps.find(j => j.name === 'BARN DOUBLE');
const rim = bike.bikeSpec.cgToFront + bike.bikeSpec.frontWheelRadius;
bike.place(sim.track, jump.start - rim - 0.12, -2.5);
bike.input.throttle = 1;
console.log(bike.recoverIfUpset(BIKE_RECOVERY.stuckSeconds + 0.01, sim.track),
  bike.s, bike.dynamics.state);
bike.restart(sim.track, 'stranded');
console.log(bike.s, bike.dynamics.state);
```

## Remaining audit outcome

No additional defect was promoted in player/AI flags, gear-stroke/machine reset, or the input journal during this focused pass. `applyLoggedInput` passes the current mutable controls to `InputLog.input`, including handback mutations, and journal comparisons include rider lean and rear brake. This was code inspection, not a blanket deterministic-replay certification. Placement's suspension/air-yaw/wheel-spin reset was inspected; broader reset behavior should not be inferred as fully verified from this limited audit.
