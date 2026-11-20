import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { GpPitBoards } from '../src/rendering/venue-kit/gp-pit-boards.ts';
import { CIRCUITS } from '../src/simulation/circuits.ts';
import { CAR_STRIDE, carBase, F, H, HEADER, R, RACE_BASE } from '../src/simulation/protocol.ts';
import { PHASE } from '../src/simulation/race.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { vehicleIndex } from '../src/simulation/vehicles.ts';

function snapshot() {
  const f = new Float32Array(HEADER + 8 * CAR_STRIDE);
  f[H.CARS] = 8;
  f[H.PHASE] = PHASE.RACING;
  f[carBase(0) + RACE_BASE + R.VEHICLE] = vehicleIndex('ss600');
  f[carBase(1) + RACE_BASE + R.VEHICLE] = vehicleIndex('gpr2');
  f[carBase(0) + F.RANK] = 3;
  f[carBase(1) + F.RANK] = 1;
  f[carBase(0) + F.LAPS] = 1;
  f[carBase(1) + F.LAPS] = 2;
  return f;
}
function digits(uv: T.BufferAttribute) {
  return Array.from(
    { length: 9 },
    (_, i) => '0123456789PL#'[Math.floor(uv.getX(4 * i) * 4) + 4 * Math.floor(uv.getY(4 * i) * 4)],
  ).join('');
}

describe('physical race-number pit boards', () => {
  it.each(['poggio-alto', 'cape-wrenna', 'haarveld', 'montejaral'] as const)(
    '%s mounts both boards to its own parapet with both vehicle paths clear',
    (id) => {
      const track = new Track('clear', false, undefined, CIRCUITS[id]),
        kit = new GpPitBoards(track),
        f = snapshot();
      for (const board of kit.boards) {
        const p = track.at(board.station, trackPoint());
        expect(board.station).toBeGreaterThan(-track.pit.divergeEnd);
        expect(board.station).toBeLessThan(track.pit.mergeStart);
        for (const approach of [-21, -8, 20, 96, 142]) {
          f[carBase(board.slot) + F.S] = board.station - approach;
          kit.update(f);
          kit.root.updateMatrixWorld(true);
          const intoTravel = new T.Vector3(0, 0, 1).transformDirection(board.face.matrixWorld);
          if (approach === 20)
            expect(intoTravel.dot(new T.Vector3(-p.tx, 0, -p.tz))).toBeGreaterThan(0.999);
          if (approach === 142)
            expect(
              intoTravel.dot(new T.Vector3(p.nx * track.pit.side, 0, p.nz * track.pit.side)),
            ).toBeGreaterThan(0.999);
          board.root.traverse((o) => {
            if (!(o instanceof T.Mesh)) return;
            const vertices = o.geometry.getAttribute('position'),
              v = new T.Vector3();
            for (let j = 0; j < vertices.count; j++) {
              v.fromBufferAttribute(vertices, j).applyMatrix4(o.matrixWorld);
              const l = track.pit.side * ((v.x - p.x) * p.nx + (v.z - p.z) * p.nz);
              expect(l).toBeGreaterThan(p.width + 0.5);
              expect(l).toBeLessThan(track.pit.offset - 2.5);
            }
          });
        }
      }
      const meshes: T.Mesh[] = [];
      kit.root.traverse((o) => {
        if (o instanceof T.Mesh) meshes.push(o);
      });
      expect(meshes.length).toBeLessThanOrEqual(8);
      expect(kit.boards[0].face.material).toBe(kit.boards[1].face.material);
    },
  );
  it('shows the actual machine number, standing and lap and rewinds the same cards and hinge', () => {
    const track = new Track('clear', false, undefined, CIRCUITS['cape-wrenna']),
      kit = new GpPitBoards(track),
      f = snapshot();
    const board = kit.boards[0],
      o = carBase(0);
    f[o + F.S] = board.station - 112 + track.length;
    f[carBase(1) + F.S] = kit.boards[1].station - 22;
    kit.update(f);
    const rotation = board.hinge.rotation.y;
    expect(Math.abs(rotation)).toBeGreaterThan(0.1);
    expect(Math.abs(rotation)).toBeLessThan(Math.PI / 2);
    expect(digits(board.cards)).toBe('#07P03L02');
    expect(digits(kit.boards[1].cards)).toBe('#03P01L03');
    const version = board.cards.version;
    kit.update(f);
    expect(board.cards.version).toBe(version);
    const original = f.slice();
    f[o + F.RANK] = 1;
    f[o + F.LAPS] = 10;
    f[o + F.S] = board.station + 25;
    kit.update(f);
    expect(digits(board.cards)).toBe('#07P01L11');
    expect(Math.abs(board.hinge.rotation.y)).toBeCloseTo(Math.PI / 2);
    kit.update(original);
    expect(digits(board.cards)).toBe('#07P03L02');
    expect(board.hinge.rotation.y).toBe(rotation);
    for (const field of [F.RETIRED, F.IN_PIT, F.FINISH]) {
      const stopped = original.slice();
      stopped[o + field] = 1;
      kit.update(stopped);
      expect(board.face.visible).toBe(false);
      expect(Math.abs(board.hinge.rotation.y)).toBeCloseTo(Math.PI / 2);
    }
    f[o + RACE_BASE + R.VEHICLE] = vehicleIndex('mx450');
    f[carBase(1) + RACE_BASE + R.VEHICLE] = vehicleIndex('apx01');
    kit.update(f);
    expect(kit.root.visible).toBe(false);
    kit.update(original);
    expect(kit.root.visible).toBe(true);
    f[H.CARS] = 0;
    kit.update(f);
    expect(kit.root.visible).toBe(false);
  });
});
