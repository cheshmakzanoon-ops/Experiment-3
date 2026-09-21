import { afterEach, expect, it, vi } from 'vitest';
import * as T from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { installPaintObservation, setPaintObservation } from '../src/rendering/paint-finish.ts';
import { installManufacturingFinish } from '../src/rendering/manufacturing.ts';
import {
  SkyEnvironment,
  configureSky,
  circuitLightState,
  lightingDirection,
  SUNSET_OFFSET,
  shadowAnchor,
} from '../src/rendering/daylight.ts';
import { PhotoStage } from '../src/rendering/photo-stage.ts';
import { photoSubject } from '../src/rendering/photo-subject.ts';
import { DEFAULT_PHOTO, validatePhoto } from '../src/rendering/photo-camera.ts';
afterEach(() => vi.restoreAllMocks());
const compile = (m: T.MeshStandardMaterial) => {
  const s = {
    uniforms: {},
    vertexShader: T.ShaderLib.physical.vertexShader,
    fragmentShader: T.ShaderLib.physical.fragmentShader,
  } as T.WebGLProgramParametersWithUniforms;
  m.onBeforeCompile(s, {} as T.WebGLRenderer);
  return s;
};
it('keeps wet/damage observations per material, idempotent, finite and clone-safe', () => {
  const m = new T.MeshPhysicalMaterial(),
    previous = vi.fn();
  m.onBeforeCompile = previous;
  installPaintObservation(m);
  installPaintObservation(m);
  const s = compile(m);
  expect(previous).toHaveBeenCalledTimes(1);
  expect(s.fragmentShader.match(/uniform vec3 paintObservation/g)).toHaveLength(1);
  setPaintObservation(m, 0.7, 0.4, 0.9);
  expect((s.uniforms.paintObservation.value as T.Vector3).toArray()).toEqual([0.7, 0.6, 1 - 0.9]);
  const clone = installPaintObservation(m.clone()),
    other = compile(clone);
  expect(other.uniforms.paintObservation).not.toBe(s.uniforms.paintObservation);
  setPaintObservation(clone, 9, -5, 9);
  expect(other.uniforms.paintObservation.value.toArray()).toEqual([1, 1, 0]);
  expect(s.uniforms.paintObservation.value.x).toBe(0.7);
  expect(() => setPaintObservation(m, NaN, 1, 1)).toThrow();
  m.dispose();
  clone.dispose();
});
it('reinstalls manufacturing shaders on clones instead of trusting copied userData', () => {
  const m = installManufacturingFinish(new T.MeshStandardMaterial(), 'turned-alloy');
  const clone = installManufacturingFinish(m.clone(), 'turned-alloy');
  installManufacturingFinish(m, 'turned-alloy');
  for (const material of [m, clone]) {
    const s = compile(material);
    expect(s.vertexShader.match(/varying vec3 vManufacture/g)).toHaveLength(1);
    expect(s.fragmentShader).toContain('fwidth(machinePhase)');
  }
  expect(() => installManufacturingFinish(m, 'suede')).toThrow();
  m.dispose();
  clone.dispose();
});
it('ties sunset sky, direct light and shadow grid to the same low sun', () => {
  expect(lightingDirection('sunset')).toBe(SUNSET_OFFSET);
  const light = circuitLightState(0.2, 0, 'sunset'),
    cloud = circuitLightState(0.9, 10, 'sunset');
  expect(light.sun).toBeGreaterThan(cloud.sun);
  expect(light.exposure).toBeGreaterThan(0);
  const p = new T.Vector3(13, 1, -5),
    anchor = shadowAnchor(p, 2048, 75, new T.Vector3(), 'sunset');
  expect(anchor.distanceTo(p)).toBeLessThan(0.1);
  expect(Object.values(light).every(Number.isFinite)).toBe(true);
});
it('separates day/sunset/night environment identities and restores live uniforms on errors', () => {
  const sky = new Sky();
  configureSky(sky);
  sky.material.uniforms.sunsetAmount.value = 0.6;
  sky.material.uniforms.sunPosition.value.set(1, 2, 3);
  const modes: number[][] = [],
    outputs: T.WebGLRenderTarget[] = [];
  const cap = vi.spyOn(T.PMREMGenerator.prototype, 'fromScene').mockImplementation(() => {
    modes.push([sky.material.uniforms.nightAmount.value, sky.material.uniforms.sunsetAmount.value]);
    const out = new T.WebGLRenderTarget(2, 2);
    outputs.push(out);
    return out;
  });
  vi.spyOn(T.PMREMGenerator.prototype, 'dispose').mockImplementation(() => {});
  const env = new SkyEnvironment(sky),
    renderer = { compile: vi.fn() } as unknown as T.WebGLRenderer,
    scene = new T.Scene();
  for (const mode of ['day', 'sunset', 'night', 'sunset'] as const)
    expect(env.update(renderer, scene, 0.5, mode)).toBe(true);
  expect(modes).toEqual([
    [0, 0],
    [0, 1],
    [1, 0],
    [0, 1],
  ]);
  expect(sky.material.uniforms.sunPosition.value.toArray()).toEqual([1, 2, 3]);
  expect(sky.material.uniforms.sunsetAmount.value).toBe(0.6);
  const texture = scene.environment;
  cap.mockImplementationOnce(() => {
    throw new Error('GPU failure');
  });
  expect(() => env.update(renderer, scene, 0.8, 'day')).toThrow('GPU failure');
  expect(scene.environment).toBe(texture);
  expect(env.captures).toBe(4);
  expect(sky.material.uniforms.sunsetAmount.value).toBe(0.6);
  env.dispose();
  sky.geometry.dispose();
  sky.material.dispose();
});
it('focuses actual articulated parts under translated/rotated parents without changing the car', () => {
  const root = new T.Group(),
    helmet = new T.Group(),
    steering = new T.Group(),
    wheel = new T.Group();
  root.position.set(100, 4, -20);
  root.rotation.y = 0.7;
  helmet.position.set(0, 0.17, -0.4);
  helmet.rotation.z = 0.05;
  steering.position.set(0, 0.115, 0.22);
  steering.rotation.z = 0.35;
  wheel.position.set(-0.83, -0.15, 1.72);
  root.add(helmet, steering, wheel);
  const car = { root, helmet, steering, wheelPivots: [wheel] },
    matrix = root.matrix.clone();
  const head = photoSubject(car, 1, new T.Vector3()),
    expected = helmet.localToWorld(new T.Vector3(0, 0.12, 0.02));
  expect(head.distanceTo(expected)).toBeLessThan(1e-10);
  expect(head.distanceTo(photoSubject(car, 0, new T.Vector3()))).toBeGreaterThan(0.3);
  expect(
    photoSubject(car, 3, new T.Vector3()).distanceTo(wheel.getWorldPosition(new T.Vector3())),
  ).toBeLessThan(1e-10);
  expect(root.position.toArray()).toEqual([100, 4, -20]);
  expect(root.matrix.equals(matrix)).toBe(false); // only normal matrix refresh, not a pose edit
  expect(() => photoSubject(car, NaN, new T.Vector3())).toThrow();
  expect(validatePhoto({ focusSubject: 999 }).focusSubject).toBe(6);
  expect(validatePhoto({ focusSubject: NaN }).focusSubject).toBe(DEFAULT_PHOTO.focusSubject);
});

it('separates the showroom ground from the podium instead of depth fighting at y=0', () => {
  const stage = new PhotoStage();
  const floor = stage.root.children.find(
    (o) => o instanceof T.Mesh && o.geometry instanceof T.CircleGeometry,
  ) as T.Mesh;
  const podium = stage.root.children.find(
    (o) => o instanceof T.Mesh && o.geometry instanceof T.CylinderGeometry,
  ) as T.Mesh;
  stage.root.updateMatrixWorld(true);
  const floorBounds = new T.Box3().setFromObject(floor);
  const podiumBounds = new T.Box3().setFromObject(podium);
  expect(floorBounds.max.y).toBeLessThan(podiumBounds.min.y - 0.001);
  expect(podiumBounds.max.y).toBeCloseTo(0, 8);
  stage.root.traverse((o) => {
    if (o instanceof T.Mesh) {
      o.geometry.dispose();
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
    }
  });
});
