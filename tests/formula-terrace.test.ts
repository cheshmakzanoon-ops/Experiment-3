import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { CrowdCluster } from '../src/rendering/crowd.ts';
import {
  formulaStations,
  formulaWindSites,
  FormulaCourse,
} from '../src/rendering/formula-course.ts';
import { inStandFootprint } from '../src/rendering/grandstand.ts';
import { gpWindMast } from '../src/rendering/venue-kit/gp-windsock.ts';
import { AUREL, VELLAMAR } from '../src/simulation/circuits.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { PHASE } from '../src/simulation/race.ts';
import { F, H, carBase, HEADER, CAR_STRIDE } from '../src/simulation/protocol.ts';

describe('Formula grandstands and braking approaches', () => {
  it('leads a fast car, responds independently at opposite ends of a block and restores a seek', () => {
    const seats = [-9, 0, 9].map((z) => new T.Matrix4().makeTranslation(0, 0, z));
    const stand = new CrowdCluster(
      seats,
      seats.map(() => new T.Color()),
      631,
      new T.MeshStandardMaterial(),
      undefined,
      0,
      false,
      1,
    );
    const frame = new Float32Array(HEADER + CAR_STRIDE),
      o = carBase(0);
    frame[H.CARS] = 1;
    frame[H.PHASE] = PHASE.RACING;
    frame[o + F.X] = -15;
    frame[o + F.Z] = 0;
    frame[o + F.SPEED] = 75;
    const camera = new T.Vector3();
    const angle = (v: number, enabled = true, height = 1080) => {
      frame[o + F.VZ] = v;
      stand.update(12, camera, 3, frame, 58, 16 / 9, false, height, enabled);
      return stand.gpYaw!.value;
    };
    const ahead = angle(75),
      slopes = stand.gpSeats!.value.toArray();
    expect(ahead).toBeGreaterThan(0.18);
    expect(angle(180)).toBeCloseTo(ahead, 8);
    expect(angle(-75)).toBeCloseTo(-ahead, 8);
    expect(angle(0)).toBeCloseTo(0, 8);
    expect(angle(75, false)).toBe(0);
    expect(angle(75)).toBe(ahead);
    expect(stand.gpSeats!.value.toArray()).toEqual(slopes);
    expect(stand.gpSeats!.value.y).toBeLessThan(0);
    expect(stand.gpSeats!.value.z).toBeLessThan(0);
    frame[o + F.IN_PIT] = 1;
    expect(angle(75)).toBe(0);
    frame[o + F.IN_PIT] = 0;
    camera.z = 1300;
    expect(angle(75)).toBe(0);
  });

  it.each([AUREL, VELLAMAR])(
    'keeps wind fabric clear of the verge and spectators on $id',
    (circuit) => {
      const track = new Track('clear', false, undefined, circuit);
      const stations = formulaStations(track),
        sites = formulaWindSites(track, stations);
      expect(sites.length).toBeGreaterThan(0);
      expect(sites.length).toBeLessThanOrEqual(2);
      for (const site of sites) {
        const p = trackPoint(),
          lateral = track.nearest(site.position.x, site.position.z, p);
        expect(Math.abs(lateral) - track.boundaryAt(p, Math.sign(lateral))).toBeGreaterThan(2.9);
        expect(inStandFootprint(track, site.position.x, site.position.z, 2.75)).toBe(false);
        expect(
          stations.some(
            (b) =>
              b.kind === 'detection' &&
              Math.min(Math.abs(site.s - b.s), track.length - Math.abs(site.s - b.s)) < 25,
          ),
        ).toBe(true);
      }
    },
  );
  it('replays the local wind in a rotated mast and leaves an invisible venue at rest', () => {
    const course = new FormulaCourse(new Track());
    const mast = gpWindMast(new T.MeshStandardMaterial());
    mast.root.rotation.y = 1.11;
    course.root.add(mast.root);
    course.windSleeves.push(mast.sleeve);
    const geometry = mast.sleeve.mesh.geometry.getAttribute('position') as T.BufferAttribute;
    const wind = new T.Vector4(8, -3, 15, 0.62);
    const rest = Array.from(geometry.array);
    course.presentWind(wind);
    expect(Array.from(geometry.array)).toEqual(rest);
    course.root.visible = true;
    course.presentWind(wind);
    const gust = Array.from(geometry.array);
    expect(gust).not.toEqual(rest);
    const version = geometry.version;
    course.presentWind(wind);
    expect(geometry.version).toBe(version);
    course.presentWind(new T.Vector4(-6, 2, 18, 0.3));
    expect(Array.from(geometry.array)).not.toEqual(gust);
    course.presentWind(wind);
    expect(Array.from(geometry.array)).toEqual(gust);
  });
});
