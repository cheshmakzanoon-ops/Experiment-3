import { afterEach, expect, it, vi } from 'vitest';
import * as T from 'three';
import {
  PROBE_FACE_SIZE,
  PROBE_MOTION_REFRESH,
  ReflectionSystem,
} from '../src/rendering/reflections.ts';
import {
  installSpecularIBLMaterial,
  ownEnvMapUniform,
} from '../src/rendering/studio/ibl-energy.ts';
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
it('captures the dome at the specular sky gain and flags probe-owned materials without recompiles', () => {
  const reflection = new ReflectionSystem(),
    { gl } = fixture(),
    scene = new T.Scene();
  scene.environmentIntensity = 0.42;
  const car = new T.Group(),
    paint = new T.MeshPhysicalMaterial(),
    unhooked = new T.MeshPhysicalMaterial(),
    sky = { value: 1 };
  // Only the normalised material renders the sky at the specular gain; one
  // created after the installers records (and renders) the plain environment.
  reflection.setSkyIntensity([paint, unhooked], 0.42, 1 / 0.42);
  expect(paint.envMapIntensity).toBeCloseTo(0.42, 12);
  expect(unhooked.envMapIntensity).toBeCloseTo(0.42, 12);
  expect(installSpecularIBLMaterial(paint)).toBe(true);
  // Sky-lit reflective paint records its effective specular sky gain.
  reflection.setSkyIntensity([paint, unhooked], 0.42, 1 / 0.42);
  expect(paint.envMapIntensity).toBeCloseTo(1, 12);
  expect(unhooked.envMapIntensity).toBeCloseTo(0.42, 12);
  unhooked.dispose();
  const flags: number[] = [];
  const capture = vi.spyOn(T.CubeCamera.prototype, 'update').mockImplementation(function (
    this: T.CubeCamera,
  ) {
    expect(this.renderTarget.width).toBe(PROBE_FACE_SIZE);
    // The dome at the radiance sky-lit specular sees, not the diffuse share.
    expect(sky.value).toBeCloseTo(1, 12);
    flags.push(ownEnvMapUniform(paint).value);
  });
  reflection.beginFrame(10, false);
  reflection.updateProbe(gl, scene, car, [paint], true, 0.55, sky);
  const version = paint.version;
  expect(ownEnvMapUniform(paint).value).toBe(1);
  expect(sky.value).toBe(1);
  reflection.beginFrame(11, false);
  reflection.updateProbe(gl, scene, car, [paint], true, 0.55, sky);
  // While capturing, the owned material renders as sky-lit (no previous bounce).
  expect(flags).toEqual([0, 0]);
  expect(ownEnvMapUniform(paint).value).toBe(1);
  expect(paint.version).toBe(version);
  expect(capture).toHaveBeenCalledTimes(2);
  reflection.updateProbe(gl, scene, car, [paint], false);
  expect(ownEnvMapUniform(paint).value).toBe(0);
  expect(paint.envMap).toBe(null);
  expect(paint.envMapIntensity).toBeCloseTo(1, 12);
  for (const gain of [0.5, NaN])
    expect(() => reflection.setSkyIntensity([], 0.42, gain)).toThrow('Invalid sky specular gain');
  reflection.dispose();
  paint.dispose();
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
it('draws all scenery in the first capture, then omits sub-texel detail from each later one and restores it after a failed face', () => {
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
  const seen: boolean[][] = [];
  const update = vi.spyOn(T.CubeCamera.prototype, 'update').mockImplementation(function (
    this: T.CubeCamera,
  ) {
    seen.push([near.visible, far.visible, hiddenAlready.visible]);
    expect(this.position.toArray()).toEqual([10, 3.5, -4]);
  });
  // A failed first capture does not count as having drawn the scenery.
  update.mockImplementationOnce(() => {
    throw new Error('first face lost');
  });
  reflection.beginFrame(1, false);
  expect(() => reflection.updateProbe(gl, scene, car, [], true)).toThrow('first face lost');
  reflection.beginFrame(3, false);
  reflection.updateProbe(gl, scene, car, [], true);
  // The first complete capture uploads every static drawable.
  expect(seen).toEqual([[true, true, false]]);
  expect(reflection.probeDetailOmitted).toBe(0);
  expect(eyes).toHaveLength(0);
  reflection.beginFrame(5, false);
  reflection.updateProbe(gl, scene, car, [], true);
  expect(seen[1]).toEqual([true, false, false]);
  expect(eyes.every((eye) => eye.equals(new T.Vector3(10, 3.5, -4)))).toBe(true);
  expect(reflection.probeDetailOmitted).toBe(1);
  expect([near.visible, far.visible, hiddenAlready.visible]).toEqual([true, true, false]);
  update.mockImplementation(() => {
    throw new Error('face lost');
  });
  reflection.beginFrame(7, false);
  expect(() => reflection.updateProbe(gl, scene, car, [], true)).toThrow('face lost');
  expect([near.visible, far.visible, hiddenAlready.visible]).toEqual([true, true, false]);
  reflection.dispose();
});
function slicedFixture() {
  const base = fixture();
  const faces: { face: number; x: number; mipmaps: boolean; texture: T.Texture }[] = [];
  let target: T.WebGLCubeRenderTarget | null = null,
    face = 0;
  const renderer = Object.assign(base.renderer, {
    coordinateSystem: T.WebGLCoordinateSystem,
    setRenderTarget: vi.fn((t: T.WebGLCubeRenderTarget, f = 0) => {
      target = t;
      face = f;
    }),
    render: vi.fn((_scene: T.Scene, camera: T.Camera) => {
      faces.push({
        face,
        x: camera.getWorldPosition(new T.Vector3()).x,
        mipmaps: target!.texture.generateMipmaps,
        texture: target!.texture,
      });
    }),
  });
  return { ...base, renderer, gl: renderer as unknown as T.WebGLRenderer, faces };
}
it('spreads a periodic refresh over frames from one eye and publishes it only when complete', () => {
  const reflection = new ReflectionSystem(),
    { gl, faces } = slicedFixture();
  const scene = new T.Scene(),
    car = new T.Group(),
    material = new T.MeshStandardMaterial();
  const full = vi.spyOn(T.CubeCamera.prototype, 'update').mockImplementation(() => undefined);
  reflection.probeFacesPerFrame = 2;
  reflection.beginFrame(1, false);
  reflection.updateProbe(gl, scene, car, [material], true);
  // The first capture renders all six faces at once.
  expect(full).toHaveBeenCalledOnce();
  const first = material.envMap!;
  expect(faces).toHaveLength(0);
  car.position.x = 10;
  reflection.beginFrame(3, false);
  reflection.updateProbe(gl, scene, car, [material], true);
  const back = faces[0].texture,
    pmrem = back.pmremVersion;
  expect(back).not.toBe(first);
  expect(faces.map((f) => f.face)).toEqual([0, 1]);
  expect(car.visible).toBe(true);
  expect(material.envMap).toBe(first);
  expect(reflection.probeUpdates).toBe(1);
  // The car moves on; the refresh keeps the eye of its first face.
  car.position.x = 20;
  reflection.beginFrame(3.02, false);
  reflection.updateProbe(gl, scene, car, [material], true);
  expect(material.envMap).toBe(first);
  expect(back.pmremVersion).toBe(pmrem);
  reflection.beginFrame(3.04, false);
  reflection.updateProbe(gl, scene, car, [material], true);
  expect(full).toHaveBeenCalledOnce();
  expect(faces.map((f) => f.face)).toEqual([0, 1, 2, 3, 4, 5]);
  expect(faces.every((f) => f.x === 10 && f.texture === back)).toBe(true);
  // Mipmaps are generated once, after the sixth face, and PMREM refreshed.
  expect(faces.map((f) => f.mipmaps)).toEqual([false, false, false, false, false, true]);
  expect(back.generateMipmaps).toBe(true);
  expect(back.pmremVersion).toBe(pmrem + 1);
  expect(material.envMap).toBe(back);
  expect(reflection.probeUpdates).toBe(2);
  // The cadence runs from the refresh's first face (t = 3), not its last.
  reflection.beginFrame(4.49, false);
  reflection.updateProbe(gl, scene, car, [material], true);
  expect(faces).toHaveLength(6);
  reflection.beginFrame(4.5, false);
  reflection.updateProbe(gl, scene, car, [material], true);
  expect(faces).toHaveLength(8);
  expect(faces[6].texture).toBe(first);
  expect(faces[6].x).toBe(20);
  reflection.dispose();
});
it('keeps one reflection face per late live motocross frame and immediately resolves a replay cut', () => {
  const reflection = new ReflectionSystem();
  const { gl, faces } = slicedFixture();
  const scene = new T.Scene(), rider = new T.Group();
  const metal = new T.MeshStandardMaterial();
  reflection.probeFacesPerFrame = 1;
  const present = (seconds: number, live: boolean) => {
    reflection.beginFrame(seconds, false, live);
    reflection.updateProbe(gl, scene, rider, [metal], true);
  };
  try {
    present(0, true);
    const gateMap = metal.envMap;
    expect(faces).toHaveLength(6);
    for (let face = 0; face < 6; face++) {
      rider.position.z = 15 + face;
      present((face + 1) * 10, true);
      expect(faces).toHaveLength(7 + face);
      expect(faces.at(-1)!.face).toBe(face);
      if (face < 5) expect(metal.envMap).toBe(gateMap);
    }
    expect(metal.envMap).not.toBe(gateMap);
    expect(reflection.probeDiagnostics.starts.immediate).toBe(1);
    present(95, false);
    expect(faces).toHaveLength(18);
    present(30, true);
    expect(faces).toHaveLength(24);
  } finally {
    reflection.dispose();
    metal.dispose();
  }
});

it('paces stationary dry-race faces on a late GPU and keeps the complete reflection installed', () => {
  const reflection = new ReflectionSystem(), { gl, faces } = slicedFixture();
  const scene = new T.Scene(), bike = new T.Group(), metal = new T.MeshStandardMaterial();
  reflection.probeFacesPerFrame = 1;
  const present = (time: number, pace = true) => {
    reflection.beginFrame(time, false, true);
    reflection.updateProbe(gl, scene, bike, [metal], true, 1.5, undefined, pace);
  };
  try {
    present(0);
    const original = metal.envMap;
    bike.position.y = 0.006;
    for (let i = 0; i < 18; i++) {
      const time = 2 + i / 10;
      present(time);
      present(time);
      expect(faces).toHaveLength(6 + Math.floor((i + 1) / 3));
      if (i < 17) expect(metal.envMap).toBe(original);
    }
    expect(metal.envMap).not.toBe(original);
    expect(reflection.probeDiagnostics.deferredCadenceFaces).toBe(12);
    bike.position.z = 0.1;
    present(5.5);
    expect(faces).toHaveLength(13);
    reflection.invalidate();
    present(5.6);
    expect(faces).toHaveLength(19);
    reflection.sceneryChanged();
    present(6.2);
    expect(faces).toHaveLength(20);
    // All five remaining faces advance while the captured scenery is stale.
    for (let i = 1; i <= 5; i++) present(6.2 + i / 10);
    expect(faces).toHaveLength(25);
    present(8.5, false);
    expect(faces).toHaveLength(26);
  } finally {
    reflection.dispose();
    metal.dispose();
  }
});

it('drops a refresh in progress for a seek, subject or environment change and captures all six faces', () => {
  const reflection = new ReflectionSystem(),
    { gl, faces } = slicedFixture();
  const scene = new T.Scene(),
    car = new T.Group(),
    other = new T.Group(),
    material = new T.MeshStandardMaterial();
  const positions: number[] = [];
  const full = vi.spyOn(T.CubeCamera.prototype, 'update').mockImplementation(function (
    this: T.CubeCamera,
  ) {
    positions.push(this.position.x);
  });
  reflection.probeFacesPerFrame = 1;
  other.position.x = 50;
  let clock = 1;
  const frame = (subject = car) => {
    reflection.beginFrame(clock, false);
    reflection.updateProbe(gl, scene, subject, [material], true);
  };
  frame();
  const begin = () => {
    clock += 2;
    frame();
    expect(faces.at(-1)!.face).toBe(0);
  };
  begin();
  reflection.invalidate();
  frame();
  expect(full).toHaveBeenCalledTimes(2);
  begin();
  scene.environment = new T.Texture();
  frame();
  expect(full).toHaveBeenCalledTimes(3);
  begin();
  frame(other);
  expect(full).toHaveBeenCalledTimes(4);
  expect(positions).toEqual([0, 0, 0, 50]);
  // Switching local reflections off also drops it.
  clock += 2;
  frame(other);
  reflection.updateProbe(gl, scene, other, [material], false);
  reflection.updateProbe(gl, scene, other, [material], true);
  expect(full).toHaveBeenCalledTimes(5);
  // No refresh face is ever published on its own.
  expect(reflection.probeUpdates).toBe(5);
  scene.environment.dispose();
  reflection.dispose();
});
it('holds a refresh in progress while presentation time holds (pause), doing no probe work', () => {
  const reflection = new ReflectionSystem(),
    { gl, faces } = slicedFixture();
  const scene = new T.Scene(),
    car = new T.Group(),
    material = new T.MeshStandardMaterial();
  vi.spyOn(T.CubeCamera.prototype, 'update').mockImplementation(() => undefined);
  reflection.probeFacesPerFrame = 1;
  reflection.beginFrame(1, false);
  reflection.updateProbe(gl, scene, car, [material], true);
  const first = material.envMap;
  reflection.beginFrame(3, false);
  reflection.updateProbe(gl, scene, car, [material], true);
  expect(faces).toHaveLength(1);
  // Paused: the same presentation time on every frame.
  for (let i = 0; i < 10; i++) {
    reflection.beginFrame(3, false);
    reflection.updateProbe(gl, scene, car, [material], true);
  }
  expect(faces).toHaveLength(1);
  expect(material.envMap).toBe(first);
  // Resumed: one face per advancing frame, published after the sixth.
  for (let i = 1; i <= 5; i++) {
    reflection.beginFrame(3 + i / 60, false);
    reflection.updateProbe(gl, scene, car, [material], true);
  }
  expect(faces.map((f) => f.face)).toEqual([0, 1, 2, 3, 4, 5]);
  expect(material.envMap).not.toBe(first);
  reflection.dispose();
});
it('abandons a refresh after a failed face, restores state and restarts it from the first face', () => {
  const reflection = new ReflectionSystem(),
    { gl, faces, renderer } = slicedFixture();
  const scene = new T.Scene(),
    car = new T.Group(),
    rival = new T.Group(),
    material = new T.MeshStandardMaterial();
  vi.spyOn(T.CubeCamera.prototype, 'update').mockImplementation(() => undefined);
  reflection.probeExclusions = [rival];
  reflection.probeFacesPerFrame = 3;
  reflection.beginFrame(1, false);
  reflection.updateProbe(gl, scene, car, [material], true);
  const complete = material.envMap;
  reflection.beginFrame(3, false);
  reflection.updateProbe(gl, scene, car, [material], true);
  const render = renderer.render.getMockImplementation()!;
  renderer.render.mockImplementationOnce(() => {
    throw new Error('face lost');
  });
  reflection.beginFrame(3.02, false);
  expect(() => reflection.updateProbe(gl, scene, car, [material], true)).toThrow('face lost');
  expect([car.visible, rival.visible]).toEqual([true, true]);
  expect(faces[0].texture.generateMipmaps).toBe(true);
  expect(material.envMap).toBe(complete);
  renderer.render.mockImplementation(render);
  reflection.beginFrame(3.04, false);
  reflection.updateProbe(gl, scene, car, [material], true);
  expect(faces.map((f) => f.face)).toEqual([0, 1, 2]);
  expect(material.envMap).toBe(complete);
  // Failure must not bypass the minimum capture-start interval.
  reflection.beginFrame(3.5, false);
  reflection.updateProbe(gl, scene, car, [material], true);
  expect(faces.map((f) => f.face)).toEqual([0, 1, 2, 0, 1, 2]);
  expect(material.envMap).toBe(complete);
  reflection.beginFrame(3.52, false);
  reflection.updateProbe(gl, scene, car, [material], true);
  expect(material.envMap).toBe(faces[0].texture);
  expect(reflection.probeUpdates).toBe(2);
  for (const value of [0, 7, 1.5, NaN]) {
    reflection.probeFacesPerFrame = value;
    expect(() => reflection.updateProbe(gl, scene, car, [material], true)).toThrow(
      'Invalid probe faces per frame',
    );
  }
  reflection.dispose();
});
it('refreshes from world displacement after the minimum interval, without heading or held-time triggers', () => {
  const reflection = new ReflectionSystem(),
    { gl, faces } = slicedFixture(),
    scene = new T.Scene(),
    parent = new T.Group(),
    car = new T.Group(),
    material = new T.MeshStandardMaterial();
  reflection.probeFacesPerFrame = 1;
  parent.position.set(100, 8, -20);
  car.position.set(5, 2, 3);
  parent.add(car);
  scene.add(parent);
  const frame = (time: number) => {
    reflection.beginFrame(time, false);
    reflection.updateProbe(gl, scene, car, [material], true, 2);
  };
  frame(0);
  const complete = material.envMap;
  expect(faces).toHaveLength(6);
  expect(reflection.probeDiagnostics.origin).toEqual([105, 11.5, -17]);
  // Local car coordinates stay unchanged: its parent supplies the movement.
  parent.position.x += PROBE_MOTION_REFRESH.distance;
  frame(0.49);
  expect(faces).toHaveLength(6);
  parent.position.x -= 0.01;
  car.rotation.y = Math.PI;
  frame(0.5);
  expect(faces).toHaveLength(6);
  parent.position.x += 0.01;
  // Moving the subject at an already considered paused time does no work.
  frame(0.5);
  expect(faces).toHaveLength(6);
  frame(0.51);
  expect(faces).toHaveLength(7);
  expect(faces[6].face).toBe(0);
  expect(faces[6].x).toBe(117);
  expect(material.envMap).toBe(complete);
  expect(reflection.probeDiagnostics.pendingReason).toBe('motion');
  for (let i = 1; i < 6; i++) frame(0.51 + i / 60);
  expect(material.envMap).not.toBe(complete);
  expect(reflection.probeDiagnostics.origin).toEqual([117, 11.5, -17]);
  expect(reflection.probeDiagnostics.starts).toEqual({
    immediate: 1,
    motion: 1,
    scenery: 0,
    cadence: 0,
  });
  reflection.dispose();
  material.dispose();
});
it('completes coherent one-face refreshes during sustained fast travel without exceeding the start budget', () => {
  const reflection = new ReflectionSystem(),
    { gl, faces } = slicedFixture(),
    scene = new T.Scene(),
    car = new T.Group(),
    material = new T.MeshStandardMaterial();
  reflection.probeFacesPerFrame = 1;
  const frame = (time: number) => {
    car.position.x = time * 100;
    reflection.beginFrame(time, false);
    reflection.updateProbe(gl, scene, car, [material], true, 2);
  };
  frame(0);
  expect(faces.map((face) => face.face)).toEqual([0, 1, 2, 3, 4, 5]);
  const starts: number[] = [];
  let priorStart = 0,
    cycleEye = 0,
    published = material.envMap,
    completions = 0;
  // 300 m of travel: the old two-second cadence would first update near 200 m.
  for (let i = 1; i <= 180; i++) {
    const before = faces.length,
      time = i / 60;
    frame(time);
    const submitted = faces.slice(before),
      diagnostic = reflection.probeDiagnostics;
    expect(submitted.length).toBeLessThanOrEqual(1);
    if (diagnostic.lastStart !== priorStart) {
      expect(diagnostic.lastStart! - priorStart).toBeGreaterThanOrEqual(0.5);
      priorStart = diagnostic.lastStart!;
      starts.push(priorStart);
      cycleEye = car.position.x;
      expect(submitted[0].face).toBe(0);
    }
    for (const face of submitted) {
      expect(face.x).toBe(cycleEye);
      if (face.face === 5) {
        completions++;
        expect(material.envMap).toBe(face.texture);
        expect(material.envMap).not.toBe(published);
        expect(diagnostic.origin).toEqual([cycleEye, 1.5, 0]);
        published = material.envMap;
      } else expect(material.envMap).toBe(published);
    }
  }
  expect(starts).toEqual([0.5, 1, 1.5, 2, 2.5, 3]);
  expect(completions).toBe(5);
  expect(reflection.probeUpdates).toBe(6);
  expect(reflection.probeDiagnostics.starts).toEqual({
    immediate: 1,
    motion: 6,
    scenery: 0,
    cadence: 0,
  });
  expect(reflection.probeDiagnostics.immediateFaces).toBe(6);
  reflection.dispose();
  material.dispose();
});
it.each([0.55, 0.8, 1.5, 2])(
  'retains the stationary %s-second cadence and submits no faces on held frames',
  (interval) => {
    const reflection = new ReflectionSystem(),
      { gl, faces } = slicedFixture(),
      scene = new T.Scene(),
      car = new T.Group(),
      material = new T.MeshStandardMaterial();
    reflection.probeFacesPerFrame = 1;
    const frame = (time: number) => {
      reflection.beginFrame(time, false);
      reflection.updateProbe(gl, scene, car, [material], true, interval);
    };
    frame(0);
    const starts = [0];
    for (let i = 1; i <= 240; i++) {
      const before = faces.length,
        time = i / 60;
      car.rotation.y = time;
      frame(time);
      const count = faces.length;
      expect(count - before).toBeLessThanOrEqual(1);
      if (count > before && faces[count - 1].face === 0) starts.push(time);
      frame(time);
      expect(faces).toHaveLength(count);
    }
    expect(starts.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(interval);
      expect(starts[i] - starts[i - 1]).toBeLessThanOrEqual(interval + 1 / 60 + 1e-9);
    }
    expect(reflection.probeDiagnostics.starts).toEqual({
      immediate: 1,
      motion: 0,
      scenery: 0,
      cadence: starts.length - 1,
    });
    expect(faces.length).toBeLessThanOrEqual(6 + Math.floor(4 / interval) * 6);
    reflection.dispose();
    material.dispose();
  },
);
it('coalesces scenery revisions behind a fixed-origin cycle and holds them until presentation advances', () => {
  const reflection = new ReflectionSystem(),
    { gl, faces } = slicedFixture(),
    scene = new T.Scene(),
    car = new T.Group(),
    material = new T.MeshStandardMaterial();
  reflection.probeFacesPerFrame = 1;
  const frame = (time: number) => {
    reflection.beginFrame(time, false);
    reflection.updateProbe(gl, scene, car, [material], true, 2);
  };
  frame(0);
  frame(0.5);
  const first = material.envMap;
  reflection.setSceneryRevision(1);
  for (let i = 0; i < 5; i++) frame(0.5);
  expect(faces).toHaveLength(6);
  frame(0.51);
  expect(reflection.probeDiagnostics.pendingReason).toBe('scenery');
  for (let i = 1; i < 6; i++) {
    reflection.setSceneryRevision(i + 1);
    reflection.sceneryChanged(); // Authored asset arrivals use the same soft queue.
    frame(0.51 + i / 60);
  }
  expect(faces.slice(6).map((face) => face.face)).toEqual([0, 1, 2, 3, 4, 5]);
  expect(material.envMap).not.toBe(first);
  expect(reflection.probeUpdates).toBe(2);
  expect(reflection.probeDiagnostics.sceneryPending).toBe(true);
  frame(1);
  expect(faces).toHaveLength(12);
  for (let i = 0; i < 6; i++) frame(1.01 + i / 60);
  expect(faces.slice(12).map((face) => face.face)).toEqual([0, 1, 2, 3, 4, 5]);
  expect(reflection.probeUpdates).toBe(3);
  expect(reflection.probeDiagnostics.sceneryPending).toBe(false);
  // Repeating the same streamer revision never creates another dirty cycle.
  reflection.setSceneryRevision(6);
  frame(1.6);
  expect(faces).toHaveLength(18);
  expect(reflection.probeDiagnostics.starts).toEqual({
    immediate: 1,
    motion: 0,
    scenery: 2,
    cadence: 0,
  });
  for (const revision of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    expect(() => reflection.setSceneryRevision(revision)).toThrow(
      'Invalid reflection scenery revision',
    );
  reflection.dispose();
  material.dispose();
});
it('bounds failed initial and forced full-capture retries while allowing explicit new requests', () => {
  const reflection = new ReflectionSystem(),
    { gl, faces, renderer, previous } = slicedFixture(),
    scene = new T.Scene(),
    car = new T.Group(),
    rival = new T.Group(),
    original = new T.Texture(),
    material = new T.MeshStandardMaterial({ envMap: original, envMapIntensity: 0.7 }),
    sky = { value: 1 };
  reflection.probeFacesPerFrame = 1;
  reflection.probeExclusions = [rival];
  const render = renderer.render.getMockImplementation()!;
  let failedFaces = 0,
    failure = 'capture unavailable';
  const failLastFace = (scene: T.Scene, camera: T.Camera) => {
    expect(car.visible).toBe(false);
    expect(rival.visible).toBe(false);
    // Exercise the expensive failure case: five faces already submitted.
    if (++failedFaces % 6 === 0) throw new Error(failure);
    render(scene, camera);
  };
  renderer.render.mockImplementation(failLastFace);
  const frame = (time: number) => {
    reflection.beginFrame(time, false);
    reflection.updateProbe(gl, scene, car, [material], true, 2, sky);
  };
  expect(() => frame(0)).toThrow('capture unavailable');
  for (let i = 0; i < 30; i++) frame(i / 60);
  expect(renderer.render).toHaveBeenCalledTimes(6);
  expect(reflection.probeDiagnostics.immediateRetryPending).toBe(true);
  expect(reflection.localProbeActive).toBe(false);
  expect(material.envMap).toBe(original);
  expect(material.envMapIntensity).toBe(0.7);
  expect([car.visible, rival.visible]).toEqual([true, true]);
  expect(renderer.xr.enabled).toBe(true);
  expect(renderer.shadowMap.autoUpdate).toBe(true);
  expect(renderer.setRenderTarget).toHaveBeenLastCalledWith(previous, 2, 1);
  expect(renderer.setViewport).toHaveBeenLastCalledWith(new T.Vector4(3, 4, 800, 600));
  expect(renderer.setScissor).toHaveBeenLastCalledWith(new T.Vector4(5, 6, 700, 500));
  expect(renderer.setScissorTest).toHaveBeenLastCalledWith(true);
  expect(sky.value).toBe(1);
  expect(() => frame(0.5)).toThrow('capture unavailable');
  for (let i = 30; i < 60; i++) frame(i / 60);
  expect(renderer.render).toHaveBeenCalledTimes(12);
  expect(faces).toHaveLength(10);
  faces.length = 0;
  renderer.render.mockImplementation(render);
  frame(1);
  const complete = material.envMap;
  expect(faces.map((face) => face.face)).toEqual([0, 1, 2, 3, 4, 5]);
  expect(reflection.probeUpdates).toBe(1);
  expect(reflection.probeDiagnostics.immediateRetryPending).toBe(false);
  failure = 'forced capture unavailable';
  renderer.render.mockImplementation(failLastFace);
  car.position.x = 400;
  reflection.invalidate();
  expect(() => frame(1)).toThrow('forced capture unavailable');
  const calls = renderer.render.mock.calls.length;
  for (let i = 60; i < 90; i++) frame(i / 60);
  expect(renderer.render).toHaveBeenCalledTimes(calls);
  expect(material.envMap).toBe(complete);
  // A newly requested seek or new environment can retry at the held instant.
  reflection.invalidate();
  expect(() => frame(89 / 60)).toThrow('forced capture unavailable');
  renderer.render.mockImplementation(render);
  scene.environment = new T.Texture();
  frame(89 / 60);
  expect(reflection.probeUpdates).toBe(2);
  expect(material.envMap).not.toBe(complete);
  expect(reflection.probeDiagnostics.origin).toEqual([400, 1.5, 0]);
  expect(reflection.probeDiagnostics.immediateRetryPending).toBe(false);
  expect(reflection.probeDiagnostics.starts.immediate).toBe(6);
  reflection.dispose();
  expect(material.envMap).toBe(original);
  material.dispose();
  original.dispose();
  scene.environment.dispose();
});
it('replaces a pending cycle coherently for teleport and reverse seek even at a held instant', () => {
  const reflection = new ReflectionSystem(),
    { gl, faces } = slicedFixture(),
    scene = new T.Scene(),
    car = new T.Group(),
    material = new T.MeshStandardMaterial();
  reflection.probeFacesPerFrame = 1;
  const frame = (time: number) => {
    reflection.beginFrame(time, false);
    reflection.updateProbe(gl, scene, car, [material], true, 2);
  };
  frame(10);
  const first = material.envMap;
  car.position.x = 40;
  frame(10.5);
  expect(faces).toHaveLength(7);
  expect(material.envMap).toBe(first);
  car.position.x = 1000;
  reflection.invalidate();
  frame(10.5);
  const teleported = material.envMap;
  expect(teleported).not.toBe(first);
  expect(faces.slice(7).map((face) => [face.face, face.x])).toEqual(
    [0, 1, 2, 3, 4, 5].map((face) => [face, 1000]),
  );
  expect(reflection.probeDiagnostics.pendingFace).toBe(-1);
  frame(10.5);
  expect(faces).toHaveLength(13);
  car.position.x = -400;
  frame(4);
  expect(faces.slice(13).map((face) => [face.face, face.x])).toEqual(
    [0, 1, 2, 3, 4, 5].map((face) => [face, -400]),
  );
  expect(material.envMap).toBe(first);
  expect(reflection.probeUpdates).toBe(3);
  expect(reflection.probeDiagnostics.starts.immediate).toBe(3);
  expect(reflection.probeDiagnostics.origin).toEqual([-400, 1.5, 0]);
  reflection.dispose();
  material.dispose();
});
it('poses the mirror cameras on the car for profiling, wherever they were last rendered', () => {
  const reflection = new ReflectionSystem();
  const car = new T.Group();
  const surfaces = [-1, 1].map((side) => {
    const surface = new T.Mesh(new T.PlaneGeometry(0.18, 0.065), new T.MeshBasicMaterial());
    surface.position.set(side * 0.64, 0.3, 0.4);
    car.add(surface);
    return surface;
  });
  reflection.attachMirrors(surfaces);
  car.position.set(120, 0, -40);
  car.updateMatrixWorld(true);
  const cameras = reflection.poseMirrorCameras(car);
  cameras.forEach((camera, i) =>
    expect(camera.position.distanceTo(surfaces[i].getWorldPosition(new T.Vector3()))).toBeLessThan(
      1e-9,
    ),
  );
  reflection.dispose();
});
