import { describe, expect, it } from 'vitest';
import { DynamicsTrack } from '../scripts/dynamics-fixtures.ts';
import { BIKE, Bike, EXPERT } from '../src/simulation/bike.ts';
import { BikeVehicle } from '../src/simulation/bike-vehicle.ts';
import { COMPOUNDS, DEFAULT_SETUP, type Assist } from '../src/simulation/config.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { isDirtBike } from '../src/simulation/offroad/dirt-bikes.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';

const DT = 1 / 240;
const ROAD_BIKES = ['sbk1000', 'ss600', 'nr900', 'cr750', 'mx250', 'mx450', 'sm450'] as const;

/** The real adapter from rest: only throttle and steering inputs change.
 * Four seconds approach the requested pace; four more hold the stick.
 * No assigned speed, pose, AI path, or modified solver is used. */
function slowTurn(id: string, assist: Assist, speed = 3, direction = 1) {
  const track = new DynamicsTrack();
  const definition = VEHICLES[id];
  const bike = isDirtBike(definition)
    ? new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, assist, definition)
    : new BikeVehicle(0, 'medium', DEFAULT_SETUP, assist, definition);
  bike.place(track, 0);
  for (const tire of bike.tires)
    tire.carcassTemp = tire.surfaceTemp = COMPOUNDS[tire.compound].ideal;
  let heading = 0;
  let wrongWay = 0;
  let entrySpeed = 0;
  for (let tick = 0; tick < 1920; tick++) {
    bike.input.steer = tick >= 960 ? direction * 0.6 : 0;
    bike.input.throttle = Math.max(0, Math.min(1, (speed - bike.dynamics.speed) * 0.5 + 0.06));
    bike.step(DT, track);
    if (tick === 959) {
      heading = bike.dynamics.heading;
      entrySpeed = bike.speed;
    } else if (tick >= 960)
      wrongWay = Math.max(wrongWay, -(bike.dynamics.heading - heading) * direction);
  }
  return { bike, entrySpeed, turned: (bike.dynamics.heading - heading) * direction, wrongWay };
}

describe('walking-speed player control on ordinary roads', () => {
  for (const id of ROAD_BIKES)
    for (const assist of ['sport', 'raw'] as const)
      it(`${id} ${assist}: holds the intended turn around 11 km/h in both directions`, () => {
        for (const direction of [1, -1]) {
          const { bike, entrySpeed, turned, wrongWay } = slowTurn(id, assist, 3, direction);
          expect(entrySpeed).toBeGreaterThan(2.8);
          expect(entrySpeed).toBeLessThan(3.2);
          // The former blend held a 28–62 degree turn the opposite way.
          expect(turned).toBeGreaterThan(0.35);
          expect(wrongWay).toBeLessThan(0.15);
          expect(bike.dynamics.lean * direction).toBeGreaterThan(0.05);
          expect(bike.dynamics.crashes).toBe(0);
          expect(bike.riding).toBe(true);
          expect(bike.dynamics.assists.traction).toBe(assist === 'sport');
          expect(bike.dynamics.assists.abs).toBe(assist === 'sport');
        }
      });

  it.each([2, 2.6, 3.5, 4, 4.5, 5, 8])(
    'crosses the walking-pace blend at %s m/s without reversing a held turn',
    (speed) => {
      for (const direction of [1, -1]) {
        const { bike, turned, wrongWay } = slowTurn('sbk1000', 'sport', speed, direction);
        expect(turned).toBeGreaterThan(0.35);
        expect(wrongWay).toBeLessThan(0.2);
        expect(bike.riding).toBe(true);
        expect(bike.dynamics.crashes).toBe(0);
      }
    },
  );

  it('switches the player balance at the AI substep boundary without resetting motion', () => {
    const track = new DynamicsTrack();
    const bike = new BikeVehicle(0, 'medium', DEFAULT_SETUP, 'sport', VEHICLES.sbk1000);
    bike.place(track, 0);
    bike.input.throttle = 0.1;
    bike.step(DT, track);
    expect(bike.dynamics.p.lowSpeedBalance).toBe(true);
    bike.aiControlled(2);
    bike.step(DT, track);
    expect(bike.dynamics.p.lowSpeedBalance).toBe(false);
    bike.step(DT, track);
    expect(bike.dynamics.p.lowSpeedBalance).toBe(false);
    const previous = bike.dynamics.z;
    bike.step(DT, track);
    expect(bike.dynamics.p.lowSpeedBalance).toBe(true);
    expect(bike.dynamics.z).toBeGreaterThan(previous);
    expect(bike.dynamics.z - previous).toBeLessThan(0.01);
  });

  it.each(['gpr1', 'gpr2'])('%s retains its separate GP controller', (id) => {
    const { bike, turned } = slowTurn(id, 'sport');
    expect(bike.dynamics.motoGP).not.toBeNull();
    expect(bike.dynamics.p.lowSpeedBalance).toBe(false);
    expect(turned).toBeGreaterThan(0.35);
    expect(bike.riding).toBe(true);
  });

  it('does not change direct-steer expert control in the standalone physics core', () => {
    const original = new Bike(EXPERT, { ...BIKE });
    const optedIn = new Bike(EXPERT, { ...BIKE, lowSpeedBalance: true });
    original.speed = optedIn.speed = 3;
    const input = { lean: 0.15, throttle: 0, frontBrake: 0, rearBrake: 0, rider: 0 };
    for (let tick = 0; tick < 240; tick++) {
      original.step(input, DT);
      optedIn.step(input, DT);
    }
    expect(optedIn.heading).toBe(original.heading);
    expect(optedIn.lean).toBe(original.lean);
    expect(optedIn.steer).toBe(original.steer);
    expect(optedIn.state).toBe(original.state);
  });
});
