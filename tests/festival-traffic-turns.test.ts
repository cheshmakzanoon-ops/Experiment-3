import { describe, expect, it } from 'vitest';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';
import { AmbientTraffic, TF, TRAFFIC_FLAG, TRAFFIC_HEADER } from '../src/simulation/open-world/ambient-traffic.ts';
import { openWorld } from '../src/simulation/open-world/world.ts';
import { trackPoint } from '../src/simulation/track.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';

describe('Port Ilse junction traffic', () => {
  it('signals both turn directions, clears the junction and rolls within its steering lock on the actual streets', () => {
    const net = openWorld().network;
    const player = new Vehicle(0, 'medium', DEFAULT_SETUP, 'sport', VEHICLES.tc1);
    const p = trackPoint();
    let left = 0, right = 0, reverse = 0, straight = 0, maxSlip = 0, maxStepError = 0, maxSteer = 0;
    for (const edge of net.edges) {
      if (edge.roadClass !== 'town' || edge.length < 75) continue;
      for (const dir of [1, -1] as const) {
        const node = net.nodes[dir > 0 ? edge.to : edge.from];
        if (node.edges.length < 3) continue;
        net.at(edge.offset + (dir > 0 ? edge.length : 0), p);
        const ax = p.tx * dir, az = p.tz * dir;
        for (const next of net.leaving(node.index)) {
          if (next.edge === edge || next.edge.roadClass !== 'town') continue;
          net.at(next.edge.offset + (next.dir > 0 ? 0 : next.edge.length), p);
          const tx = p.tx * next.dir, tz = p.tz * next.dir;
          const angle = Math.atan2(az * tx - ax * tz, ax * tx + az * tz);
          const expected = Math.abs(angle) < 0.45 ? 0 : angle > 0 ? TRAFFIC_FLAG.LEFT : TRAFFIC_FLAG.RIGHT;
          const traffic = new AmbientTraffic(net, 42, { maxCars: 0, perTile: 0 });
          const car = traffic.place(edge.index, dir, edge.length - 36, dir > 0 ? 6 : 9, dir > 0 ? 'rh3' : 'rs5');
          car.next = { edge: next.edge.index, dir: next.dir };
          player.body.position.set(node.x + 97, node.y, node.z + 111);
          const packet = traffic.writeSnapshot();
          let signalled = 0, firstSignal = Infinity, onArc = 0, cleared = false;
          for (let tick = 0; tick < 2000; tick++) {
            const x = car.position.x, z = car.position.z, yaw = car.yaw;
            const wasTurning = (car.turn?.travelled ?? -1) >= 0;
            traffic.step(1 / 120, player);
            const arc = car.turn;
            if (wasTurning || (arc && arc.travelled >= 0)) {
              onArc++;
              const dx = car.position.x - x, dz = car.position.z - z;
              const heading = (car.yaw + yaw) / 2, step = Math.hypot(dx, dz);
              maxSlip = Math.max(maxSlip, Math.abs(dx * Math.cos(heading) - dz * Math.sin(heading)) / step);
              maxStepError = Math.max(maxStepError, Math.abs(step - car.speed / 120));
              const curvature = Math.abs(car.yaw - yaw) / Math.max(step, 1e-8);
              const innerX = Math.abs(car.definition.wheelPositions[0][0]);
              const steer = Math.atan2(car.definition.spec.wheelbase * curvature, 1 - innerX * curvature);
              maxSteer = Math.max(maxSteer, steer / car.definition.spec.maxSteer);
              if (tick % 12 === 0) {
                const lateral = net.nearest(car.position.x, car.position.z, p, car.position.y);
                expect(Math.abs(lateral)).toBeLessThan(p.width);
              }
            }
            if (tick % 6) continue;
            const flags = traffic.writeSnapshot(packet)[TRAFFIC_HEADER + TF.FLAGS] & (TRAFFIC_FLAG.LEFT | TRAFFIC_FLAG.RIGHT);
            if (flags && !signalled) firstSignal = edge.length - car.s;
            signalled |= flags;
            if (car.edge === next.edge.index && car.s > 22 && flags === 0) {
              cleared = true;
              break;
            }
          }
          expect(cleared).toBe(true);
          expect(signalled).toBe(expected);
          if (expected) {
            expect(firstSignal).toBeGreaterThan(17);
            expect(onArc).toBeGreaterThan(45);
            if (angle > 0) left++;
            else right++;
            if (dir < 0) reverse++;
          } else straight++;
        }
      }
    }
    expect(Math.min(left, right, reverse, straight)).toBeGreaterThan(12);
    expect(maxSlip).toBeLessThan(0.008);
    expect(maxStepError).toBeLessThan(0.001);
    expect(maxSteer).toBeLessThan(1.025);
  });
});
