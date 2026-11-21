import { describe, expect, it } from 'vitest';
import { circuitDefinition } from '../src/simulation/circuits.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { H } from '../src/simulation/protocol.ts';
import { Track, surfaceSample, trackPoint } from '../src/simulation/track.ts';
import { CLEAR_VISIBILITY_M } from '../src/simulation/weather.ts';
import { Simulation } from '../src/simulation/world.ts';

describe('Arena Nord roof over the racing surface', () => {
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
