import { describe, expect, it } from 'vitest';
import { circuitDefinition } from '../src/simulation/circuits.ts';
import { controls, DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { PHASE } from '../src/simulation/race.ts';
import { H } from '../src/simulation/protocol.ts';
import { Track, surfaceSample, trackPoint } from '../src/simulation/track.ts';
import { CLEAR_VISIBILITY_M } from '../src/simulation/weather.ts';
import { Simulation } from '../src/simulation/world.ts';

function manualStartAndStop(
  circuit: 'arena-nord-sx' | 'valley-ridge-mx',
  machine: 'mx250' | 'mx450',
  weather: 'clear' | 'rain',
) {
  const sim = new Simulation({
    ...DEFAULT_OPTIONS,
    circuit,
    vehicles: [machine],
    opponents: 0,
    laps: 2,
    mode: 'race',
    ruleset: 'motocross-moto',
    assist: 'sport',
    seed: 60117,
    weather,
  });
  const rider = sim.cars[0];
  if (!(rider instanceof DirtBikeVehicle)) throw new Error('Expected a dirt bike at the gate');
  const input = controls();
  let green: number | undefined, brakePoint: { x: number; z: number } | undefined;
  let peak = 0,
    beforeGreen = 0;
  for (let tick = 0; tick < 120 * 20; tick++) {
    if (sim.race.phase === PHASE.RACING) green ??= tick;
    const elapsed = green === undefined ? -1 : (tick - green) / 120;
    input.throttle = elapsed >= 0 && elapsed < 2.4 ? Math.min(1, elapsed / 0.3) : 0;
    input.riderLean = elapsed >= 0 && elapsed < 1.2 ? 0.24 : 0;
    input.brake = elapsed >= 2.6 ? Math.min(0.86, (elapsed - 2.6) * 2.4) : 0;
    if (elapsed >= 2.6 && !brakePoint) brakePoint = { x: rider.dynamics.x, z: rider.dynamics.z };
    sim.setInput(input);
    sim.step(1 / 120);
    if (elapsed < 0) beforeGreen = Math.max(beforeGreen, rider.speed);
    peak = Math.max(peak, rider.speed);
    if (brakePoint && elapsed >= 2.8 && rider.speed < 0.8) {
      expect(beforeGreen).toBe(0);
      expect(sim.autoPlayer).toBe(false);
      expect(sim.race.laps[0].jumped).toBe(false);
      expect(rider.riding).toBe(true);
      expect(rider.dynamics.crashes).toBe(0);
      return {
        peak,
        distance: Math.hypot(rider.dynamics.x - brakePoint.x, rider.dynamics.z - brakePoint.z),
      };
    }
  }
  throw new Error('The player did not clear the gate and stop on the approach');
}

describe('Arena Nord roof over the racing surface', () => {
  it.each(['mx250', 'mx450'] as const)(
    'keeps the manual %s launch and braking distance consistent under the roof during rain',
    (bike) => {
      const dry = manualStartAndStop('arena-nord-sx', bike, 'clear');
      const rain = manualStartAndStop('arena-nord-sx', bike, 'rain');
      expect(dry.peak).toBeGreaterThan(10);
      expect(dry.distance).toBeGreaterThan(8);
      expect(Math.abs(rain.peak - dry.peak)).toBeLessThan(0.2);
      expect(Math.abs(rain.distance - dry.distance)).toBeLessThan(0.3);

      const outdoors = manualStartAndStop('valley-ridge-mx', bike, 'clear');
      const wet = manualStartAndStop('valley-ridge-mx', bike, 'rain');
      expect(wet.peak).toBeGreaterThan(1);
      expect(wet.peak).toBeLessThan(outdoors.peak);
      expect(wet.distance).toBeGreaterThan(0);
      expect(wet.distance).toBeLessThan(outdoors.distance);
    },
  );

  it('keeps atmospheric rain out of every wheel contact and the displayed race, including after the gate', () => {
    const sim = new Simulation({
      ...DEFAULT_OPTIONS,
      circuit: 'arena-nord-sx',
      weather: 'rain',
      ruleset: 'motocross-moto',
      mode: 'race',
      opponents: 0,
      vehicles: ['mx450'],
    });
    const track = sim.track,
      p = trackPoint(),
      tyre = surfaceSample();
    const outside = { rain: 0, windX: 0, windZ: 0, cloud: 0, ambient: 0 };
    track.weather.sample(60, outside);
    expect(outside.rain).toBeGreaterThan(10);
    for (const time of [0, 60, 180]) {
      if (time > 0) track.evolve(time === 60 ? 60 : 120, time);
      const frame = sim.makeFrame();
      expect([frame[H.RAIN], frame[H.WIND_X], frame[H.WIND_Z], track.meanWater()]).toEqual([
        0, 0, 0, 0,
      ]);
      expect(track.visibility).toBe(CLEAR_VISIBILITY_M);
      for (const station of [1, 100.7, 110.82, 166.89, track.length - 1]) {
        track.at(station, p);
        track.sample(p.x, p.z, tyre);
        expect(tyre.terrain).toBe(true);
        expect(tyre.water).toBe(0);
      }
    }
    expect(track.sheltered.every((v) => v === 1)).toBe(true);
    expect(sim.offroad!.terrain.wetness).toBe(0);
    expect(sim.offroad!.terrain.moistureAt(10)).toBeGreaterThan(0);
  });

  it('keeps outdoor rain and the water film on the Valley Ridge riding line', () => {
    const track = new Track('rain', false, undefined, circuitDefinition('valley-ridge-mx'));
    const p = track.at(110.82, trackPoint()),
      tyre = surfaceSample();
    track.evolve(60, 60);
    track.sample(p.x, p.z, tyre);
    expect(track.rain).toBeGreaterThan(10);
    expect(track.meanWater()).toBeGreaterThan(0.5);
    expect(tyre.water).toBeGreaterThan(0.5);
    expect(Math.hypot(track.windX, track.windZ)).toBeGreaterThan(1);
  });
});
