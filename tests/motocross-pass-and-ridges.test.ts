import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { MxCrowdPass } from '../src/rendering/offroad/mx-crowd-pass.ts';
import { MxRidgeWoodland } from '../src/rendering/offroad/mx-ridge-woodland.ts';
import { setMxQuality } from '../src/rendering/offroad/mx-quality.ts';
import { terrainSurface } from '../src/rendering/terrain-surface.ts';
import { terrainFor } from '../src/rendering/terrain.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
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
