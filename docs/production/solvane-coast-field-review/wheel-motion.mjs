import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { newSim, Pilot } from '../../../scripts/studio/tools/festival-qa.ts';
import { W, WHEEL_BASE, WHEEL_STRIDE, carBase } from '../../../src/simulation/protocol.ts';
import { recordedWheelTurns } from '../../../src/simulation/wheel-rotation.ts';
import {
  contactHubLength, sampleWheelContact, wheelContactPose,
} from '../../../src/rendering/wheel-contact.ts';
import { wheelPhase, wheelValue } from '../../../src/rendering/wheel-pose.ts';

const roadCars = ['rh3', 'sc7', 'rs5', 'eh3', 'rp6', 'rr4', 'rm8', 'rd2', 'rg63', 'lx12'];
const requested = process.argv.slice(2);
const vehicles = requested.length ? requested : roadCars;
const event = 'port-ilse-loop';
const seed = 73021;
const hz = 120;
const dt = 1 / hz;
const player = carBase(0);
const degrees = 180 / Math.PI;

function run(vehicle) {
  assert.ok(roadCars.includes(vehicle), `Unknown Festival road car ${vehicle}`);
  const sim = newSim({ vehicle, weather: 'rain', seed, traffic: true });
  sim.command({ type: 'travel', event, runUp: false });
  for (let tick = 0; tick < 1200 && sim.status().card?.id !== event; tick++) sim.step(dt);
  assert.equal(sim.status().card?.id, event);
  sim.command({ type: 'start', event });
  const route = sim.events.find((entry) => entry.spec.id === event).path;
  const pilot = new Pilot(sim, route, 0.92);
  const contact = wheelContactPose();
  const wheels = Array.from({ length: 4 }, () => ({
    minHub: Infinity, maxHub: -Infinity, minTurns: Infinity, maxTurns: -Infinity, contacts: 0,
  }));
  let previous = sim.makeFrame();
  let current = new Float32Array(previous.length);
  let racingTicks = 0;
  let brakingInputTicks = 0;
  let maxSteerDifference = 0;

  for (let tick = 0; tick < hz * 1050 && !sim.results.some((r) => r.eventId === event); tick++) {
    pilot.step(dt, sim.mode === 'countdown', sim.mode === 'finished');
    sim.step(dt);
    sim.writeFrame(current);
    if (sim.mode === 'running') {
      racingTicks++;
      if (sim.player.input.brake > 0.1) brakingInputTicks++;
      let rightFrontSteer = 0;
      for (const [index, wheel] of wheels.entries()) {
        const offset = player + WHEEL_BASE + index * WHEEL_STRIDE;
        sampleWheelContact(previous, current, player, index, 0.5, contact);
        const hub = contactHubLength(contact, previous, current, offset, 0.5);
        const steer = (previous[offset + W.STEER] + current[offset + W.STEER]) / 2;
        const phase = wheelPhase(previous, current, player, offset, 0.5);
        const omega = wheelValue(previous, current, player, offset, W.OMEGA, 0.5);
        const turns = recordedWheelTurns(current, player, index);
        assert.ok([hub, steer, phase, omega, turns].every(Number.isFinite));
        if (contact.valid) {
          wheel.contacts++;
          const normalLength = Math.hypot(contact.normalX, contact.normalY, contact.normalZ);
          assert.ok(contact.radial >= 0 && Math.abs(normalLength - 1) < 1e-8);
        }
        wheel.minHub = Math.min(wheel.minHub, hub);
        wheel.maxHub = Math.max(wheel.maxHub, hub);
        wheel.minTurns = Math.min(wheel.minTurns, turns);
        wheel.maxTurns = Math.max(wheel.maxTurns, turns);
        if (index === 0) rightFrontSteer = steer;
        if (index === 1) {
          maxSteerDifference = Math.max(maxSteerDifference, Math.abs(rightFrontSteer - steer));
        }
      }
    }
    [previous, current] = [current, previous];
  }
  const finish = sim.results.find((r) => r.eventId === event);
  assert.ok(finish?.completed && racingTicks > 0 && brakingInputTicks > 0);
  assert.ok(wheels.every((wheel) => wheel.contacts > 0 && wheel.maxTurns > wheel.minTurns));
  return {
    finishSeconds: Number(finish.time.toFixed(3)),
    racingTicks, brakingInputTicks, offRouteSeconds: finish.offRouteSeconds, pilotResets: pilot.resets,
    maxFrontSteeringAngleDifferenceDeg: Number((maxSteerDifference * degrees).toFixed(3)),
    hubTravelMm: wheels.map((wheel) => Number(((wheel.maxHub - wheel.minHub) * 1000).toFixed(2))),
    measuredContactMidpoints: wheels.map((wheel) => wheel.contacts),
    spanOfRecordedFullTurns: wheels.map((wheel) => wheel.maxTurns - wheel.minTurns),
  };
}

const source = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: new URL('../../../', import.meta.url), encoding: 'utf8',
}).trim();
const results = Object.fromEntries(vehicles.map((vehicle) => [vehicle, run(vehicle)]));
console.log(JSON.stringify({ source, event, seed, physicsHz: hz, vehicles: results }, null, 2));
