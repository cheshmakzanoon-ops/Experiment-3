import { afterEach, expect, it, vi } from 'vitest';
import * as T from 'three';
import { ReflectionSystem } from '../src/rendering/reflections.ts';
import { PhotoStage, STUDIO_REFLECTION_LAYER } from '../src/rendering/photo-stage.ts';

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

it('keeps studio softboxes in every probe face but out of all ordinary camera views', () => {
  const stage = new PhotoStage(),
    view = new T.PerspectiveCamera();
  const cards = stage.root.children.filter((o) => o.name === 'Reflection-only studio softbox');
  expect(cards).toHaveLength(2);
  for (const card of cards) {
    expect(card.layers.isEnabled(STUDIO_REFLECTION_LAYER)).toBe(true);
    expect(view.layers.test(card.layers)).toBe(false);
  }
  // Lights and podium still appear on the ordinary scene layer.
  for (const child of stage.root.children.filter((o) => !cards.includes(o)))
    expect(view.layers.test(child.layers)).toBe(true);
  const reflection = new ReflectionSystem(),
    { gl } = fixture();
  const update = vi.spyOn(T.CubeCamera.prototype, 'update').mockImplementation(function (
    this: T.CubeCamera,
  ) {
    expect(this.children).toHaveLength(6);
    for (const face of this.children) {
      expect(face.layers.test(view.layers)).toBe(true);
      for (const card of cards) expect(face.layers.test(card.layers)).toBe(true);
    }
  });
  reflection.beginFrame(1, false);
  reflection.updateProbe(gl, new T.Scene(), new T.Group(), [], true);
  expect(update).toHaveBeenCalledOnce();
  reflection.dispose();
  stage.root.traverse((o) => {
    if (o instanceof T.Mesh) {
      o.geometry.dispose();
      (o.material as T.Material).dispose();
    }
  });
});

it('preserves completed scene radiance and restores the latest sky fallback gain', () => {
  const reflection = new ReflectionSystem(),
    { gl } = fixture(),
    scene = new T.Scene();
  const car = new T.Group(),
    original = new T.Texture();
  const material = new T.MeshStandardMaterial({ envMap: original, envMapIntensity: 0.08 });
  vi.spyOn(T.CubeCamera.prototype, 'update').mockImplementation(() => undefined);
  reflection.beginFrame(10, false);
  reflection.setSkyIntensity([material], 0.08);
  reflection.updateProbe(gl, scene, car, [material], true);
  const map = material.envMap;
  expect(material.envMapIntensity).toBe(1);
  reflection.setSkyIntensity([material], 0.07);
  expect(material.envMapIntensity).toBe(1);
  expect(material.envMap).toBe(map);
  reflection.updateProbe(gl, scene, car, [material], false);
  expect(material.envMap).toBe(original);
  expect(material.envMapIntensity).toBe(0.07);
  reflection.dispose();
  material.dispose();
  original.dispose();
});
it('captures no previous local bounce and restores sky, maps and mipmaps after a failed face', () => {
  const reflection = new ReflectionSystem(),
    { gl } = fixture(),
    scene = new T.Scene();
  scene.environmentIntensity = 0.08;
  const car = new T.Group(),
    material = new T.MeshStandardMaterial({ envMapIntensity: 0.08 });
  const sky = { value: 1 };
  let broken: T.Texture | undefined;
  const capture = vi.spyOn(T.CubeCamera.prototype, 'update').mockImplementation(function (
    this: T.CubeCamera,
  ) {
    expect(sky.value).toBe(0.08);
    expect(material.envMap).toBe(null);
    expect(material.envMapIntensity).toBe(0.08);
  });
  reflection.beginFrame(10, false);
  reflection.updateProbe(gl, scene, car, [material], true, 0.55, sky);
  const complete = material.envMap;
  expect(sky.value).toBe(1);
  capture.mockImplementation(function (this: T.CubeCamera) {
    expect(material.envMap).toBe(null);
    expect(sky.value).toBe(0.08);
    broken = this.renderTarget.texture;
    this.renderTarget.texture.generateMipmaps = false;
    throw new Error('partial cube');
  });
  reflection.beginFrame(11, false);
  expect(() => reflection.updateProbe(gl, scene, car, [material], true, 0.55, sky)).toThrow(
    'partial cube',
  );
  expect(material.envMap).toBe(complete);
  expect(material.envMapIntensity).toBe(1);
  expect(sky.value).toBe(1);
  expect(broken!.generateMipmaps).toBe(true);
  expect(car.visible).toBe(true);
  expect(reflection.probeUpdates).toBe(1);
  reflection.dispose();
  material.dispose();
});
it('transfers the real probe subject at a held instant and releases former material owners', () => {
  const reflection = new ReflectionSystem(),
    { gl } = fixture(),
    scene = new T.Scene();
  const a = new T.Group(),
    b = new T.Group(),
    ma = new T.MeshStandardMaterial(),
    mb = new T.MeshStandardMaterial(),
    road = new T.MeshStandardMaterial();
  const positions: number[] = [];
  a.position.x = 5;
  b.position.x = 50;
  vi.spyOn(T.CubeCamera.prototype, 'update').mockImplementation(function (this: T.CubeCamera) {
    positions.push(this.position.x);
  });
  reflection.beginFrame(10, false);
  reflection.setSkyIntensity([ma, road], 0.08);
  reflection.updateProbe(gl, scene, a, [ma, road], true);
  reflection.setSkyIntensity([mb, road], 0.07);
  reflection.updateProbe(gl, scene, b, [mb, road], true);
  expect(positions).toEqual([5, 50]);
  expect(ma.envMap).toBe(null);
  expect(ma.envMapIntensity).toBe(0.08);
  expect(mb.envMap).not.toBe(null);
  expect(road.envMap).toBe(mb.envMap);
  expect(mb.envMapIntensity).toBe(1);
  expect(road.envMapIntensity).toBe(1);
  reflection.updateProbe(gl, scene, b, [mb, road], true);
  expect(positions).toHaveLength(2);
  reflection.dispose();
  expect(mb.envMapIntensity).toBe(0.07);
  expect(road.envMapIntensity).toBe(0.07);
  for (const material of [ma, mb, road]) material.dispose();
});
it('rejects invalid gains and restores original mirrors when their real owner changes', () => {
  const reflection = new ReflectionSystem(),
    { gl } = fixture(),
    scene = new T.Scene();
  const make = () => [new T.Mesh(), new T.Mesh()],
    a = make(),
    b = make();
  const originals = a.map((m) => m.material);
  reflection.attachMirrors(a);
  reflection.beginFrame(10, true);
  reflection.attachMirrors(b);
  for (let i = 0; i < 2; i++) {
    expect(a[i].material).toBe(originals[i]);
    expect(a[i].visible).toBe(false);
  }
  expect(reflection.mirrors).toEqual(b);
  for (const gain of [-1, NaN, Infinity])
    expect(() => reflection.setSkyIntensity([], gain)).toThrow('Invalid sky environment intensity');
  expect(() =>
    reflection.updateProbe(gl, scene, new T.Group(), [], true, 0.55, { value: NaN }),
  ).toThrow('Invalid probe sky radiance');
  reflection.dispose();
  for (const mesh of [...a, ...b]) {
    mesh.geometry.dispose();
    (mesh.material as T.Material).dispose();
  }
});
it('omits excluded roots from every probe face and restores them, even after a failed face', () => {
  const reflection = new ReflectionSystem(),
    { gl } = fixture();
  const scene = new T.Scene(),
    car = new T.Group(),
    rival = new T.Group(),
    crowd = new T.Group(),
    hiddenAlready = new T.Group();
  hiddenAlready.visible = false;
  reflection.probeExclusions = [rival, crowd, hiddenAlready];
  const update = vi.spyOn(T.CubeCamera.prototype, 'update').mockImplementation(() => {
    expect([car.visible, rival.visible, crowd.visible, hiddenAlready.visible]).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });
  reflection.beginFrame(1, false);
  reflection.updateProbe(gl, scene, car, [], true);
  expect(update).toHaveBeenCalledOnce();
  expect([car.visible, rival.visible, crowd.visible, hiddenAlready.visible]).toEqual([
    true,
    true,
    true,
    false,
  ]);
  update.mockImplementation(() => {
    throw new Error('face lost');
  });
  reflection.beginFrame(3, false);
  expect(() => reflection.updateProbe(gl, scene, car, [], true)).toThrow('face lost');
  expect([rival.visible, crowd.visible, hiddenAlready.visible]).toEqual([true, true, false]);
  reflection.dispose();
});
it('omits sub-texel scenery from one capture only, measured from the probe, and restores it after a failed face', () => {
  const reflection = new ReflectionSystem(),
    { gl } = fixture();
  const scene = new T.Scene(),
    car = new T.Group(),
    near = new T.Group(),
    far = new T.Group(),
    hiddenAlready = new T.Group();
  hiddenAlready.visible = false;
  car.position.set(10, 2, -4);
  const eyes: T.Vector3[] = [];
  const size = (object: T.Object3D, angle: number) => ({
    object,
    angularSize: (eye: T.Vector3) => {
      eyes.push(eye.clone());
      return angle;
    },
  });
  // One texel of the 128 px face is pi / 256 rad.
  reflection.probeDetail = [
    size(near, Math.PI / 256),
    size(far, Math.PI / 256 - 1e-6),
    size(hiddenAlready, 0),
  ];
  const update = vi.spyOn(T.CubeCamera.prototype, 'update').mockImplementation(function (
    this: T.CubeCamera,
  ) {
    expect([near.visible, far.visible, hiddenAlready.visible]).toEqual([true, false, false]);
    expect(this.position.toArray()).toEqual([10, 3.5, -4]);
  });
  reflection.beginFrame(1, false);
  reflection.updateProbe(gl, scene, car, [], true);
  expect(update).toHaveBeenCalledOnce();
  expect(eyes.every((eye) => eye.equals(new T.Vector3(10, 3.5, -4)))).toBe(true);
  expect(reflection.probeDetailOmitted).toBe(1);
  expect([near.visible, far.visible, hiddenAlready.visible]).toEqual([true, true, false]);
  update.mockImplementation(() => {
    throw new Error('face lost');
  });
  reflection.beginFrame(3, false);
  expect(() => reflection.updateProbe(gl, scene, car, [], true)).toThrow('face lost');
  expect([near.visible, far.visible, hiddenAlready.visible]).toEqual([true, true, false]);
  reflection.dispose();
});
