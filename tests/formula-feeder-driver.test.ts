import { expect, it } from 'vitest';
import * as T from 'three';
import { VehicleBodies } from '../src/rendering/vehicle-bodies/index.ts';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { H, F, carBase } from '../src/simulation/protocol.ts';

it.each(['fx26', 'fr3', 'jf2'])(
  'replays a %s driver’s neck, corner gaze and wet tear-offs from telemetry',
  (id) => {
    const sim = new Simulation({
      ...DEFAULT_OPTIONS,
      opponents: 0,
      vehicles: [id],
      weather: 'rain',
    });
    const manager = new VehicleBodies(),
      f = sim.makeFrame(),
      o = carBase(0);
    const hosts = [{ root: new T.Group(), lodLevel: 0 }],
      camera = new T.Vector3();
    const read = (own = false) => {
      manager.update(f, f, 1, hosts, false, { follow: 0, cockpit: own, camera });
      return manager.cabinOf(0)!;
    };
    try {
      const cabin = read();
      const origin = new T.Vector3(...cabin.layout.head);
      expect(cabin.head.position.distanceTo(origin)).toBeLessThan(0.13);
      expect(cabin.head.position.distanceTo(origin)).toBeGreaterThan(0.08);
      f[H.TIME] = 31;
      f[H.RAIN] = 14;
      f[H.AMBIENT] = 20;
      f[o + F.SPEED] = 66;
      f[o + F.STEER] = 0.28;
      f[o + F.WY] = 0.9;
      f[o + F.G_LONG] = -3;
      f[o + F.G_LAT] = 3;
      read();
      const pose = cabin.head.quaternion.toArray();
      expect(cabin.head.rotation.y).toBeGreaterThan(0.15);
      expect(cabin.head.rotation.z).toBeGreaterThan(0.055);
      expect(cabin.head.rotation.x).toBeGreaterThan(0.02);
      const film = cabin.formulaShield!.film;
      expect(film.state.value.toArray()).toEqual([31, 1, 1]);
      f[H.TIME] = 51;
      f[H.RAIN] = 0;
      f[o + F.WY] *= -1;
      f[o + F.STEER] *= -1;
      read(true);
      expect(cabin.head.visible).toBe(false);
      expect(cabin.head.rotation.y).toBeLessThan(-0.15);
      expect(film.state.value.y).toBe(0);
      f[H.TIME] = 31;
      f[H.RAIN] = 14;
      f[o + F.WY] *= -1;
      f[o + F.STEER] *= -1;
      read();
      expect(cabin.head.visible).toBe(true);
      expect(cabin.head.quaternion.toArray()).toEqual(pose);
      expect(film.state.value.toArray()).toEqual([31, 1, 1]);
    } finally {
      manager.clear();
    }
  },
);
