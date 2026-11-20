import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { motorcycleWheel } from '../src/rendering/gp-forged-wheel.ts';
import {
  RoadWheelExposure,
  spokeExposureAtlas,
  wheelExposureTurns,
} from '../src/rendering/road-wheel-exposure.ts';

function prefix(texture: T.DataTexture, turns: number, radius: number) {
  const { data, width, height } = texture.image,
    row = ((radius - 0.035) / (0.2039 - 0.035)) * (height - 1);
  const x = (turns - Math.floor(turns)) * (width - 1);
  const read = (u: number, v: number) => {
    const i = 4 * (v * width + u);
    return (
      (data[i] * 256 + data[i + 1] + Math.floor(turns) * (data[i + 2] * 256 + data[i + 3])) / 65535
    );
  };
  const ux = Math.floor(x),
    vy = Math.floor(row),
    fx = x - ux,
    fy = row - vy;
  return T.MathUtils.lerp(
    T.MathUtils.lerp(read(ux, vy), read(ux + 1, vy), fx),
    T.MathUtils.lerp(read(ux, vy + 1), read(ux + 1, vy + 1), fx),
    fy,
  );
}

describe('road motorcycle spoke exposure', () => {
  it.each(['prototype', 'wire', 'superbike'] as const)(
    'integrates the projected %s geometry across zero and one full turn',
    (design) => {
      const wheel = motorcycleWheel(0.2159, 0.1, 'mid', design);
      const texture = spokeExposureAtlas(wheel, 0.2039);
      const mat = new T.MeshBasicMaterial({ side: T.DoubleSide }),
        mesh = new T.Mesh(wheel, mat);
      const origin = new T.Vector3(),
        ray = new T.Raycaster(),
        axis = new T.Vector3(-1, 0, 0);
      try {
        for (const radius of [0.134, 0.179]) {
          for (const [lo, hi] of [
            [-0.09, 0.075],
            [0.12, 0.38],
            [0, 1],
          ]) {
            let hits = 0;
            const samples = 480;
            for (let i = 0; i < samples; i++) {
              const a = T.MathUtils.lerp(lo, hi, (i + 0.5) / samples) * 2 * Math.PI;
              ray.set(origin.set(0.4, radius * Math.cos(a), radius * Math.sin(a)), axis);
              if (ray.intersectObject(mesh, false).length) hits++;
            }
            const covered = (prefix(texture, hi, radius) - prefix(texture, lo, radius)) / (hi - lo);
            expect(Math.abs(covered - hits / samples)).toBeLessThan(0.045);
            expect(covered).toBeGreaterThan(0);
            expect(covered).toBeLessThan(0.91);
          }
        }
      } finally {
        wheel.dispose();
        mat.dispose();
        texture.dispose();
      }
    },
  );
  it('uses independent signed wheel telemetry and creates one shared atlas until its last owner releases it', () => {
    const wheel = motorcycleWheel(0.2159, 0.095, 'mid', 'prototype');
    const metal = new T.MeshStandardMaterial(),
      a = new RoadWheelExposure(),
      b = new RoadWheelExposure();
    const one = a.layer(wheel, metal, 'prototype', 0.2159, 0.095, 0.0775, false, 'mid')!;
    const otherMetal = new T.MeshStandardMaterial();
    const two = b.layer(wheel, otherMetal, 'prototype', 0.2159, 0.095, 0.0775, false, 'mid')!;
    const uniforms = (m: T.Material) => {
      const shader = {
        vertexShader: T.ShaderLib.standard.vertexShader,
        fragmentShader: T.ShaderLib.standard.fragmentShader,
        uniforms: {} as Record<string, T.IUniform>,
      };
      m.onBeforeCompile(
        shader as Parameters<T.Material['onBeforeCompile']>[0],
        {} as T.WebGLRenderer,
      );
      return shader.uniforms;
    };
    const ua = uniforms(one.material),
      ub = uniforms(two.material);
    const texture = ua.roadSpokeAtlas.value as T.DataTexture;
    expect(texture).toBe(ub.roadSpokeAtlas.value);
    let disposals = 0;
    texture.addEventListener('dispose', () => disposals++);
    a.update(0, -124);
    b.update(89, 0);
    expect(ua.roadShutter.value.toArray()).toEqual([0, wheelExposureTurns(124), 0.0775]);
    expect(ub.roadShutter.value.toArray()).toEqual([wheelExposureTurns(89), 0, 0.0775]);
    expect(one.visible).toBe(true);
    expect(two.visible).toBe(false);
    a.update(124,0);
    expect(one.visible).toBe(false);
    a.update(0,124);
    expect(one.visible).toBe(true);
    expect(wheelExposureTurns(NaN)).toBe(0);
    a.dispose();
    expect(disposals).toBe(0);
    b.dispose();
    expect(disposals).toBe(1);
    one.geometry.dispose();
    two.geometry.dispose();
    wheel.dispose();
    metal.dispose();
    otherMetal.dispose();
  });
});
