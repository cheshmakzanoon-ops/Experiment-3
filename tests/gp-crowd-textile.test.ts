import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { CrowdCluster, installCrowdShader } from '../src/rendering/crowd.ts';
import { F, H, B, BIKE_BASE, HEADER, CAR_STRIDE, carBase } from '../src/simulation/protocol.ts';
import { PHASE } from '../src/simulation/race.ts';

describe('GP grandstand attention', () => {
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
