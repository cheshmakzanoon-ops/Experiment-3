import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { CrowdCluster, installCrowdShader } from '../src/rendering/crowd.ts';
import { F, H, B, BIKE_BASE, HEADER, CAR_STRIDE, carBase } from '../src/simulation/protocol.ts';
import { gpSpectatorYaw } from '../src/rendering/crowd-response.ts';
import { PHASE } from '../src/simulation/race.ts';

describe('GP grandstand attention', () => {
  it('follows the rider separately at each end of a rotated terrace and retraces a replay seek', () => {
    const frame = new Float32Array(HEADER + CAR_STRIDE);
    frame[H.CARS] = 1;
    frame[H.PHASE] = PHASE.RACING;
    const o = carBase(0);
    const material = new T.MeshStandardMaterial();
    const seats = [-12, -3, 3, 12].map(z => new T.Matrix4().makeTranslation(0, 0, z));
    const cluster = new CrowdCluster(seats, seats.map(() => new T.Color()), 42, material, undefined, 1);
    cluster.root.rotation.y = .81;
    cluster.root.position.set(41, 0, -72);
    cluster.root.scale.z = 1.2;
    cluster.root.updateMatrixWorld();
    const side = new T.Vector3(0,0,1).transformDirection(cluster.root.matrixWorld);
    const rider = cluster.root.localToWorld(new T.Vector3(-17,0,0));
    frame[o + F.X] = rider.x;
    frame[o + F.Z] = rider.z;
    frame[o + F.SPEED] = 50;
    const camera = cluster.root.position.clone();
    const sample = () => {
      cluster.update(15, camera, 0, frame, 44, 1.7, true, 1080);
      return [-12, 0, 12].map(z => cluster.gpYaw!.value + (z-cluster.gpSeats!.value.x) *
        (z < cluster.gpSeats!.value.x ? cluster.gpSeats!.value.y : cluster.gpSeats!.value.z));
    };
    try {
      const first = sample();
      expect(first[0]).toBeGreaterThan(.19);
      expect(first[2]).toBeLessThan(-.19);
      for (const [i,z] of [-12,0,12].entries()) {
        const actualSeat = cluster.root.localToWorld(new T.Vector3(0,0,z));
        expect(first[i]).toBeCloseTo(gpSpectatorYaw(frame, actualSeat, side.x, side.z), 8);
      }
      frame[o + F.RETIRED] = 1;
      expect(sample()).toEqual([0,0,0]);
      frame[o + F.RETIRED] = 0;
      expect(sample()).toEqual(first);
    } finally {
      for (const level of cluster.levels) {
        level.geometry.dispose();
        (level.material as T.Material).dispose();
        level.customDepthMaterial?.dispose();
        level.customDistanceMaterial?.dispose();
        level.dispose();
      }
      material.dispose();
    }
  });
  it('tracks an approaching pack across either side of the road and restores a held pose', () => {
    const frame = new Float32Array(HEADER + 2 * CAR_STRIDE);
    frame[H.CARS] = 2;
    frame[H.PHASE] = PHASE.RACING;
    const material = new T.MeshStandardMaterial();
    const matrix = new T.Matrix4(),
      camera = new T.Vector3(0, 2, 16);
    const stand = new CrowdCluster([matrix], [new T.Color()], 19, material, undefined, 1);
    const right = new CrowdCluster([matrix], [new T.Color()], 19, material, undefined, -1);
    try {
      for (let i = 0; i < 2; i++) {
        const o = carBase(i);
        frame[o + F.SPEED] = 38;
        frame[o + F.X] = -18;
        frame[o + F.Z] = 25 + 3 * i;
      }
      const read = (cluster: CrowdCluster, gp = true) => {
        cluster.update(12, camera, 0, frame, 58, 1.7, gp);
        return cluster.gpYaw!.value;
      };
      const before = read(stand);
      expect(before).toBeGreaterThan(0.3);
      const visibleAt = (metres: number, height: number, fov = 58, gp = true) => {
        camera.set(0, 0, metres);
        stand.update(12, camera, 0, frame, fov, 16 / 9, gp, height);
        return stand.levels.flatMap((mesh, i) => mesh.visible ? [i] : []);
      };
      expect(visibleAt(160, 1080)).toEqual([1]);
      expect(visibleAt(160, 540)).toEqual([2]);
      expect(visibleAt(160, 540, 16)).toEqual([1]);
      expect(visibleAt(72, 2160)).toEqual([0]);
      expect(visibleAt(72, 1080)).toEqual([1]);
      expect(visibleAt(12, 540)).toEqual([0]);
      expect(visibleAt(160, 540, 58, false)).toEqual([1]);
      camera.set(0, 2, 16);
      expect(read(right)).toBe(0);
      for (let i = 0; i < 2; i++) frame[carBase(i) + F.X] *= -1;
      expect(read(right)).toBeCloseTo(-before);
      for (let i = 0; i < 2; i++) frame[carBase(i) + F.X] *= -1;
      expect(read(stand)).toBe(before);
      expect(read(stand, false)).toBe(0);
      frame[carBase(0) + F.IN_PIT] = 1;
      frame[carBase(1) + BIKE_BASE + B.STATE] = 2;
      expect(read(stand)).toBe(0);
      frame[carBase(0) + F.IN_PIT] = 0;
      frame[carBase(1) + BIKE_BASE + B.STATE] = 0;
      frame[H.PHASE] = PHASE.GRID;
      expect(read(stand)).toBe(0);
    } finally {
      for (const cluster of [stand, right]) {
        for (const level of cluster.levels) {
          level.geometry.dispose();
          (level.material as T.Material).dispose();
          level.customDepthMaterial?.dispose();
          level.customDistanceMaterial?.dispose();
          level.dispose();
        }
      }
      material.dispose();
    }
  });
});

describe('MotoGP crowd clothing finish', () => {
  it('uses pixel-filtered cloth relief only in the colour surface pass', () => {
    const m = new T.MeshStandardMaterial();
    const uniforms = {
      crowdClock: { value: new T.Vector2() },
      crowdMotion: { value: 0 },
    };
    installCrowdShader(m, uniforms, true);
    const shader = {
      vertexShader: T.ShaderLib.standard.vertexShader,
      fragmentShader: T.ShaderLib.standard.fragmentShader,
      uniforms: T.UniformsUtils.clone(T.ShaderLib.standard.uniforms),
    };
    m.onBeforeCompile(
      shader as Parameters<T.Material['onBeforeCompile']>[0],
      {} as T.WebGLRenderer,
    );
    expect(shader.fragmentShader).toContain(
      'float textilePixel = 1. - smoothstep(.0012, .0060, px);',
    );
    expect(shader.fragmentShader).toContain(
      'float textileShoeMask = step(p.y, -.205) * step(p.x, -.2);',
    );
    expect(shader.fragmentShader).toContain('bump += .00024');
    expect(shader.fragmentShader).toContain('rough = clamp(rough + .022');
    m.dispose();
  });
});
