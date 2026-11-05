import * as T from 'three';
import { describe, expect, it } from 'vitest';
import {
  HEAT_HAZE,
  HEAT_HAZE_GLSL,
  HeatHaze,
  createHeatHazeUniforms,
} from '../src/rendering/heat-haze.ts';
import { SceneAmbientPass } from '../src/rendering/scene-ambient-pass.ts';
import { F, H, carBase } from '../src/simulation/protocol.ts';

function frame(cars: { speed: number; throttle: number; retired?: number }[]) {
  const f = new Float32Array(carBase(cars.length) + 200);
  f[H.CARS] = cars.length;
  cars.forEach((c, i) => {
    f[carBase(i) + F.SPEED] = c.speed;
    f[carBase(i) + F.THROTTLE] = c.throttle;
    f[carBase(i) + F.RETIRED] = c.retired ?? 0;
  });
  return f;
}
function camera() {
  const c = new T.PerspectiveCamera(50, 16 / 9, 0.1, 1000);
  c.position.set(0, 1.3, -6);
  c.lookAt(0, 0.5, 0);
  c.updateMatrixWorld(true);
  return c;
}
/** Chassis matrix of a car at `z` metres, nose along +Z (the camera looks down +Z). */
const chassis = (x: number, z: number) => new T.Matrix4().makeTranslation(x, 0.4, z);

describe('exhaust heat haze', () => {
  it('declares the plume uniforms and the displacement function', () => {
    for (const text of [
      'uniform int hazeCount;',
      'uniform vec4 hazeOrigin[HAZE_MAX];',
      'uniform vec4 hazeAxis[HAZE_MAX];',
      'vec2 heatHazeUv(vec2 uv, float z)',
    ])
      expect(HEAT_HAZE_GLSL).toContain(text);
    // The depth test (path clipped at the surface) and the foreground rejection exist.
    expect(HEAT_HAZE_GLSL).toContain('float surface = z / ray.z;');
    expect(HEAT_HAZE_GLSL).toContain('s1 = min(sc + chord, surface)');
    expect(HEAT_HAZE_GLSL).toContain('viewZAt(hazed) > z +');
  });

  it('places the outlet and a rearward axis in view space', () => {
    const haze = new HeatHaze();
    const cam = camera();
    const cars = [chassis(0, 0)];
    haze.update(frame([{ speed: 60, throttle: 1 }]), cam, cars, 1, 12.5, 1080);
    expect(haze.count).toBe(1);
    const u = haze.uniforms;
    // Outlet: 2.215 m behind the chassis origin, i.e. toward the camera (z -6),
    // so about 3.8 m in front of it.
    const o = u.hazeOrigin.value[0];
    expect(-o.z).toBeGreaterThan(3.5);
    expect(-o.z).toBeLessThan(4.2);
    expect(o.w).toBe(HEAT_HAZE.radius);
    // The axis points back at the camera: +z in view space (toward the eye).
    const a = u.hazeAxis.value[0];
    expect(Math.hypot(a.x, a.y, a.z)).toBeCloseTo(1, 5);
    expect(a.z).toBeGreaterThan(0.8);
    expect(a.w).toBeCloseTo(HEAT_HAZE.length + HEAT_HAZE.lengthPerSpeed * 60, 9);
    expect(u.hazeParam.value[0].x).toBeCloseTo(HEAT_HAZE.full, 9);
    expect(u.hazeTime.value).toBe(12.5);
    expect(u.hazePixels.value).toBeCloseTo(HEAT_HAZE.pixels, 9);
  });

  it('scales strength with throttle, amplitude with frame height, caps the length', () => {
    const haze = new HeatHaze();
    const cam = camera();
    haze.update(frame([{ speed: 300, throttle: 0 }]), cam, [chassis(0, 0)], 1, 0, 540);
    expect(haze.uniforms.hazeParam.value[0].x).toBeCloseTo(HEAT_HAZE.idle, 9);
    expect(haze.uniforms.hazeAxis.value[0].w).toBe(HEAT_HAZE.maxLength);
    expect(haze.uniforms.hazePixels.value).toBeCloseTo(HEAT_HAZE.pixels / 2, 9);
  });

  it('keeps the nearest sources, drops retired, far and non-finite cases', () => {
    const haze = new HeatHaze();
    const cam = camera();
    const count = HEAT_HAZE.maxSources + 3;
    const specs: Parameters<typeof frame>[0] = Array.from({ length: count }, () => ({
      speed: 50,
      throttle: 0.5,
    }));
    // Car 0 is retired; the rest sit at increasing distance down the straight.
    specs[0].retired = 1;
    const matrices = Array.from({ length: count }, (_, i) => chassis(0, 2 + i * 3));
    haze.update(frame(specs), cam, matrices, count, NaN, 1080);
    expect(haze.count).toBe(HEAT_HAZE.maxSources);
    // Nearest first: view-space depth of the sources increases.
    const depths = haze.uniforms.hazeOrigin.value.map((v) => -v.z);
    expect([...depths].sort((x, y) => x - y)).toEqual(depths);
    expect(haze.uniforms.hazeTime.value).toBe(0);
    // Beyond the far fade distance nothing is drawn.
    haze.update(frame([{ speed: 50, throttle: 1 }]), cam, [chassis(0, 200)], 1, 0, 1080);
    expect(haze.count).toBe(0);
    expect(haze.uniforms.hazeCount.value).toBe(0);
  });

  it('fades a distant plume out', () => {
    const haze = new HeatHaze();
    const cam = camera();
    haze.update(frame([{ speed: 50, throttle: 1 }]), cam, [chassis(0, 20)], 1, 0, 1080);
    const near = haze.uniforms.hazeParam.value[0].x;
    haze.update(frame([{ speed: 50, throttle: 1 }]), cam, [chassis(0, 45)], 1, 0, 1080);
    const far = haze.uniforms.hazeParam.value[0].x;
    expect(near).toBeCloseTo(1, 9);
    expect(far).toBeLessThan(0.5);
    expect(far).toBeGreaterThan(0);
  });

  it('clear() switches the composite branch off', () => {
    const haze = new HeatHaze();
    haze.update(frame([{ speed: 50, throttle: 1 }]), camera(), [chassis(0, 0)], 1, 0, 1080);
    haze.clear();
    expect(haze.uniforms.hazeCount.value).toBe(0);
    expect(createHeatHazeUniforms().hazeCount.value).toBe(0);
  });

  it('compiles into the scene composite only while attached', () => {
    const pass = new SceneAmbientPass(new T.Scene(), camera(), 0);
    const material = (pass as unknown as { compositeMaterial: T.ShaderMaterial }).compositeMaterial;
    expect(material.defines.HEAT_HAZE).toBeUndefined();
    expect(material.fragmentShader).toContain('#ifdef HEAT_HAZE');
    const haze = new HeatHaze();
    pass.setHeatHaze(haze);
    expect(material.defines.HEAT_HAZE).toBe('');
    expect(material.uniforms.hazeCount).toBe(haze.uniforms.hazeCount);
    pass.setHeatHaze(null);
    expect(material.defines.HEAT_HAZE).toBeUndefined();
    pass.dispose();
  });
});
