import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { MxCrowdPass } from '../src/rendering/offroad/mx-crowd-pass.ts';
import { MxRidgeWoodland } from '../src/rendering/offroad/mx-ridge-woodland.ts';
import { setMxQuality } from '../src/rendering/offroad/mx-quality.ts';
import { terrainSurface } from '../src/rendering/terrain-surface.ts';
import { terrainFor } from '../src/rendering/terrain.ts';
import { MX_450 } from '../src/simulation/offroad/dirt-bikes.ts';
import { rideLine, rigBike, rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { jumpHoldSpeed } from '../src/simulation/offroad/jump-target.ts';
import { writeOffroadBlock } from '../src/simulation/offroad/session.ts';
import { offroadCourse } from '../src/simulation/offroad/venues.ts';
import { CAR_STRIDE, F, H, HEADER, O, OFFROAD_BASE, carBase } from '../src/simulation/protocol.ts';
import { PHASE } from '../src/simulation/race.ts';

describe('motocross venue sightlines', () => {
  it('points the crowd at the two leaders, holds a jump, and restores the same riders after a replay seek', () => {
    const pass = new MxCrowdPass(44),
      frame = new Float32Array(HEADER + 3 * CAR_STRIDE);
    frame[H.CARS] = 3;
    frame[H.PHASE] = PHASE.RACING;
    for (const [id, rank] of [2, 3, 1].entries()) {
      const b = carBase(id);
      frame[b + F.RANK] = rank;
      frame[b + F.X] = 20 * (id + 1);
      frame[b + F.Z] = 4 * id;
      frame[b + F.SPEED] = 22;
      frame[b + F.VX] = 10 - id;
      frame[b + F.VZ] = 6 + id;
    }
    frame[carBase(2) + OFFROAD_BASE + O.AIR_TIME] = 0.65;
    frame[carBase(2) + OFFROAD_BASE + O.AIRBORNE] = 1;
    pass.update(frame);
    const first = pass.a.value.toArray(),
      next = pass.b.value.toArray();
    expect(first[0]).toBe(60);
    expect(next[0]).toBe(20);
    expect(first[2]).toBeGreaterThan(next[2]);
    expect(first[3]).toBeCloseTo(1 / 44 ** 2, 12);
    expect(pass.velocity.value.toArray()).toEqual([8, 8, 10, 6]);
    frame[H.PHASE] = PHASE.FINISHED;
    pass.update(frame);
    expect(pass.a.value.toArray()).toEqual(first);
    expect(pass.b.value.toArray()).toEqual(next);
    frame[H.PHASE] = PHASE.GRID;
    pass.update(frame);
    expect(pass.a.value.z + pass.b.value.z).toBe(0);
    expect(pass.velocity.value.toArray()).toEqual([0, 0, 0, 0]);
    frame[H.PHASE] = PHASE.RACING;
    pass.update(frame);
    expect(pass.a.value.toArray()).toEqual(first);
    expect(pass.b.value.toArray()).toEqual(next);
    frame[H.CARS] = 1;
    pass.update(frame);
    expect(pass.a.value.x).toBe(20);
    expect(pass.b.value.z).toBe(0);
    expect(pass.velocity.value.toArray()).toEqual([10, 6, 0, 0]);
    frame[carBase(0) + F.VX] = NaN;
    pass.update(frame);
    expect(pass.velocity.value.toArray()).toEqual([0, 0, 0, 0]);
  });

  it.each([
    ['valley-ridge-mx', 'RIDGE TABLE', 0],
    ['valley-ridge-mx', 'SKY TRIPLE', 6],
    ['arena-nord-sx', 'TABLETOP', 0],
    ['arena-nord-sx', 'FINISH TRIPLE', 0],
  ] as const)('finishes the crowd reaction smoothly as the MX450 lands on %s / %s', (venue, name, extra) => {
    const track = rigTrack(venue);
    const jump = offroadCourse(track.circuit)!.jumps.find((j) => j.name === name)!;
    const target = jumpHoldSpeed(jump) + extra;
    const bike = rigBike(MX_450, track, jump.start - 12, target);
    const frame = new Float32Array(HEADER + CAR_STRIDE), b = carBase(0);
    frame[H.CARS] = 1;
    frame[H.PHASE] = PHASE.RACING;
    const pass = new MxCrowdPass(44), dt = 1 / 240;
    let apex = 0, previous = 0, flying = false, landed = false;
    for (let t = 0; t < 6; t += dt) {
      if (!bike.airborne) {
        const onFace = bike.s >= jump.start - 1 && bike.s <= jump.takeoff + 1;
        rideLine(bike, track, onFace ? Math.max(target, bike.dynamics.speed) : target);
      }
      bike.step(dt, track);
      frame[H.TIME] = t;
      frame[b + F.X] = bike.body.position.x;
      frame[b + F.Y] = bike.body.position.y;
      frame[b + F.Z] = bike.body.position.z;
      frame[b + F.SPEED] = bike.speed;
      writeOffroadBlock(frame, b + OFFROAD_BASE, bike, null);
      pass.update(frame, track);
      const response = pass.a.value.z;
      if (bike.airborne && Math.abs(bike.s - jump.takeoff) < 2) flying = true;
      if (flying) {
        apex = Math.max(apex, response);
        if (!bike.airborne) {
          expect(bike.lastLanding!.airTime).toBeGreaterThan(0.8);
          expect(apex).toBeGreaterThan(0.9);
          expect(response).toBeLessThan(apex - 0.3);
          expect(Math.abs(response - previous)).toBeLessThan(0.02);
          // A seek across the discrete contact edge at the same chassis pose
          // must not cause an additional head or arm release.
          frame[b + OFFROAD_BASE + O.AIRBORNE] = 1;
          frame[b + OFFROAD_BASE + O.AIR_TIME] = bike.lastLanding!.airTime;
          pass.update(frame, track);
          expect(pass.a.value.z).toBe(response);
          landed = true;
          break;
        }
      }
      previous = response;
    }
    expect(landed).toBe(true);
  });

  it('places the two woodland belts on the outdoor ridges and thins the same instances at lower detail', () => {
    setMxQuality('high');
    const track = rigTrack('valley-ridge-mx'),
      ground = terrainSurface(terrainFor(track));
    const woods = new MxRidgeWoodland(track),
      mesh = woods.root.children as T.InstancedMesh[];
    const matrix = new T.Matrix4(),
      p = new T.Vector3();
    try {
      expect(mesh).toHaveLength(4);
      const counts = mesh.map((m) => m.count);
      expect(counts.every((n) => n > 20)).toBe(true);
      const triangles = mesh.reduce((n, m) => n + (m.count * m.geometry.index!.count) / 3, 0);
      expect(triangles).toBeLessThan(100000);
      for (const m of mesh) {
        expect(m.castShadow).toBe(false);
        for (let i = 0; i < m.count; i += 9) {
          m.getMatrixAt(i, matrix);
          p.setFromMatrixPosition(matrix);
          expect(ground.height(p.x, p.z) - p.y).toBeCloseTo(1.2, 2);
        }
      }
      setMxQuality('low');
      expect(mesh.map((m) => m.count)).toEqual(counts.map((c) => Math.ceil(c * 0.42)));
      setMxQuality('high');
      expect(mesh.map((m) => m.count)).toEqual(counts);
    } finally {
      woods.dispose();
      setMxQuality('high');
    }
  });
});
