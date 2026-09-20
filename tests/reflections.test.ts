import { afterEach, expect, it, vi } from 'vitest';
import * as T from 'three';
import { ReflectionSystem } from '../src/rendering/reflections.ts';

afterEach(() => vi.restoreAllMocks());
function fixture() {
  const previous = new T.WebGLRenderTarget(4, 4);
  const renderer = {
    shadowMap: { autoUpdate: true },
    xr: { enabled: true },
    getRenderTarget: () => previous,
    getActiveCubeFace: () => 2,
    getActiveMipmapLevel: () => 1,
    getViewport: (v: T.Vector4) => v.set(3, 4, 800, 600),
    getScissor: (v: T.Vector4) => v.set(5, 6, 700, 500),
    getScissorTest: () => true,
    setRenderTarget: vi.fn(),
    setViewport: vi.fn(),
    setScissor: vi.fn(),
    setScissorTest: vi.fn(),
  };
  return { renderer, previous, gl: renderer as unknown as T.WebGLRenderer };
}
it('alternates completed cubemaps without read/write feedback or repeated material recompiles', () => {
  const reflection = new ReflectionSystem(),
    { gl } = fixture();
  const scene = new T.Scene(),
    car = new T.Group(),
    material = new T.MeshStandardMaterial();
  const captures: T.Texture[] = [];
  vi.spyOn(T.CubeCamera.prototype, 'update').mockImplementation(function (this: T.CubeCamera) {
    expect(car.visible).toBe(false);
    expect(this.renderTarget.texture).not.toBe(material.envMap);
    captures.push(this.renderTarget.texture);
  });
  reflection.beginFrame(1, false);
  reflection.updateProbe(gl, scene, car, [material], true);
  const version = material.version;
  expect(material.envMap).toBe(captures[0]);
  reflection.beginFrame(3, false);
  reflection.updateProbe(gl, scene, car, [material], true);
  expect(material.envMap).toBe(captures[1]);
  expect(captures[1]).not.toBe(captures[0]);
  expect(material.version).toBe(version);
  reflection.beginFrame(5, false);
  reflection.updateProbe(gl, scene, car, [material], true);
  expect(captures[2]).toBe(captures[0]);
  reflection.dispose();
});
it('restores the original environment when local reflections are switched off', () => {
  const reflection = new ReflectionSystem(),
    { gl } = fixture();
  const scene = new T.Scene(),
    car = new T.Group(),
    original = new T.Texture();
  const material = new T.MeshStandardMaterial({ envMap: original });
  vi.spyOn(T.CubeCamera.prototype, 'update').mockImplementation(() => undefined);
  reflection.beginFrame(1, false);
  reflection.updateProbe(gl, scene, car, [material], true);
  expect(material.envMap).not.toBe(original);
  reflection.updateProbe(gl, scene, car, [material], false);
  expect(material.envMap).toBe(original);
  expect(reflection.localProbeActive).toBe(false);
  reflection.updateProbe(gl, scene, car, [material], true);
  expect(reflection.localProbeActive).toBe(true);
  reflection.dispose();
  expect(material.envMap).toBe(original);
});
it('restores renderer state on failed capture and never publishes an incomplete reflection', () => {
  const reflection = new ReflectionSystem(),
    { renderer, gl, previous } = fixture();
  const material = new T.MeshStandardMaterial(),
    scene = new T.Scene(),
    car = new T.Group();
  const update = vi.spyOn(T.CubeCamera.prototype, 'update').mockImplementation(() => undefined);
  reflection.beginFrame(1, false);
  reflection.updateProbe(gl, scene, car, [material], true);
  const complete = material.envMap;
  update.mockImplementation(() => {
    renderer.xr.enabled = false;
    throw new Error('GPU failure');
  });
  reflection.beginFrame(3, false);
  expect(() => reflection.updateProbe(gl, scene, car, [material], true)).toThrow('GPU failure');
  expect(material.envMap).toBe(complete);
  expect(car.visible).toBe(true);
  expect(renderer.xr.enabled).toBe(true);
  expect(renderer.shadowMap.autoUpdate).toBe(true);
  expect(renderer.setRenderTarget).toHaveBeenLastCalledWith(previous, 2, 1);
  expect(renderer.setViewport).toHaveBeenLastCalledWith(new T.Vector4(3, 4, 800, 600));
  expect(renderer.setScissor).toHaveBeenLastCalledWith(new T.Vector4(5, 6, 700, 500));
  expect(renderer.setScissorTest).toHaveBeenLastCalledWith(true);
  expect(reflection.probeUpdates).toBe(1);
  reflection.dispose();
});
it('recaptures a backward seek immediately instead of keeping a future-lap environment', () => {
  const reflection = new ReflectionSystem(),
    { gl } = fixture();
  const scene = new T.Scene(),
    car = new T.Group(),
    material = new T.MeshStandardMaterial();
  const capture = vi.spyOn(T.CubeCamera.prototype, 'update').mockImplementation(() => undefined);
  reflection.beginFrame(120, true);
  reflection.updateProbe(gl, scene, car, [material], true);
  const future = material.envMap,
    version = material.version;
  reflection.beginFrame(20, true);
  reflection.updateProbe(gl, scene, car, [material], true);
  expect(capture).toHaveBeenCalledTimes(2);
  expect(material.envMap).not.toBe(future);
  expect(material.version).toBe(version);
  reflection.beginFrame(20, true);
  reflection.updateProbe(gl, scene, car, [material], true);
  expect(capture).toHaveBeenCalledTimes(2);
  reflection.invalidate(); // Explicit same-timestamp reset or source change.
  reflection.updateProbe(gl, scene, car, [material], true);
  expect(capture).toHaveBeenCalledTimes(3);
  expect(() => reflection.beginFrame(NaN, true)).toThrow('Invalid reflection');
  reflection.dispose();
});

it('uses a faster bounded local-probe cadence for wet presentation without unbounded recapture', () => {
  const reflection = new ReflectionSystem(),
    { gl } = fixture(),
    scene = new T.Scene(),
    car = new T.Group(),
    material = new T.MeshStandardMaterial(),
    capture = vi.spyOn(T.CubeCamera.prototype, 'update').mockImplementation(() => undefined);
  reflection.beginFrame(1, false);
  reflection.updateProbe(gl, scene, car, [material], true, 0.55);
  reflection.beginFrame(1.4, false);
  reflection.updateProbe(gl, scene, car, [material], true, 0.55);
  expect(capture).toHaveBeenCalledTimes(1);
  reflection.beginFrame(1.56, false);
  reflection.updateProbe(gl, scene, car, [material], true, 0.55);
  expect(capture).toHaveBeenCalledTimes(2);
  expect(() => reflection.updateProbe(gl, scene, car, [material], true, 0.1)).toThrow(
    'Invalid reflection probe interval',
  );
  reflection.dispose();
});
