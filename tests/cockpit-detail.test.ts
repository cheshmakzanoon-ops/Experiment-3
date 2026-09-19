import { describe, expect, it } from 'vitest';
import * as T from 'three';
import {
  addMirrorHousing,
  apertureGeometry,
  controlAngles,
  controlPanelGeometry,
  roundedAperture,
  RotarySelectors,
  steeringFaceGeometry,
} from '../src/rendering/cockpit.ts';
import { driverMaterials, fabricPixels } from '../src/rendering/driver-materials.ts';
import { mergeStatic } from '../src/rendering/geometry.ts';
import { MirrorViews } from '../src/rendering/mirrors.ts';

function finiteGeometry(geometry: T.BufferGeometry) {
  const p = geometry.getAttribute('position'),
    normal = geometry.getAttribute('normal');
  for (let i = 0; i < p.count; i++) {
    expect([p.getX(i), p.getY(i), p.getZ(i)].every(Number.isFinite)).toBe(true);
    expect(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i))).toBeCloseTo(1, 4);
  }
  geometry.computeBoundingBox();
}
describe('physical cockpit apertures', () => {
  it.each([
    [0.192, 0.072, 0.018],
    [0.182, 0.09, 0.004],
  ])('fills a %s m aperture with one normalized image', (width, height, radius) => {
    const g = apertureGeometry(width, height, radius);
    finiteGeometry(g);
    const p = g.getAttribute('position'),
      uv = g.getAttribute('uv');
    for (let i = 0; i < p.count; i++) {
      expect(uv.getX(i)).toBeCloseTo(p.getX(i) / width + 0.5, 6);
      expect(uv.getY(i)).toBeCloseTo(p.getY(i) / height + 0.5, 6);
      expect(uv.getX(i)).toBeGreaterThanOrEqual(0);
      expect(uv.getX(i)).toBeLessThanOrEqual(1);
      expect(uv.getY(i)).toBeGreaterThanOrEqual(0);
      expect(uv.getY(i)).toBeLessThanOrEqual(1);
      expect(Math.abs(p.getX(i)) === width / 2 && Math.abs(p.getY(i)) === height / 2).toBe(false);
    }
    const size = g.boundingBox!.getSize(new T.Vector3());
    expect(size.x).toBeCloseTo(width, 6);
    expect(size.y).toBeCloseTo(height, 6);
    g.dispose();
  });
  it('rejects inverted, oversized and non-finite outlines', () => {
    for (const args of [
      [0, 1, 0],
      [1, -1, 0],
      [1, 1, -1],
      [1, 1, 0.6],
      [NaN, 1, 0],
    ])
      expect(() => roundedAperture(...(args as [number, number, number]))).toThrow();
  });
  it('contains both rounded feeds within real housings and matches the camera aspect', () => {
    const parent = new T.Group(),
      paint = new T.MeshStandardMaterial(),
      carbon = new T.MeshStandardMaterial();
    const surfaces = [-1, 1].map((side) => addMirrorHousing(parent, paint, carbon, side));
    const mirrors = new MirrorViews();
    mirrors.bind(surfaces);
    for (let i = 0; i < 2; i++) {
      const surface = surfaces[i],
        root = surface.parent!;
      parent.updateMatrixWorld(true);
      const shape = new T.Box3().setFromObject(root.children[0]);
      const glass = new T.Box3().setFromObject(surface);
      expect(glass.min.x).toBeGreaterThan(shape.min.x);
      expect(glass.max.x).toBeLessThan(shape.max.x);
      expect(glass.min.y).toBeGreaterThan(shape.min.y);
      expect(glass.max.y).toBeLessThan(shape.max.y);
      expect(glass.max.z).toBeLessThan(shape.min.z);
      const size = glass.getSize(new T.Vector3());
      expect(size.x / size.y).toBeCloseTo(mirrors.cameras[i].aspect, 5);
      const bezel = new T.Box3().setFromObject(root.children[1]);
      expect(glass.max.z).toBeLessThan(bezel.min.z - 0.0005);
      expect(surface.castShadow).toBe(false);
    }
    expect(() => addMirrorHousing(parent, paint, carbon, 0)).toThrow();
    mirrors.dispose();
  });
  it('uses a bevelled wheel and a shaped inset panel inside the established grip envelope', () => {
    const face = steeringFaceGeometry(),
      panel = controlPanelGeometry();
    finiteGeometry(face);
    finiteGeometry(panel);
    expect(face.boundingBox!.getSize(new T.Vector3()).x).toBeLessThan(0.34);
    expect(face.boundingBox!.getSize(new T.Vector3()).z).toBeGreaterThan(0.025);
    expect(panel.boundingBox!.getSize(new T.Vector3()).x).toBeLessThan(0.27);
    const p = panel.getAttribute('position');
    // Below the selector row the panel narrows instead of exposing square corners.
    for (let i = 0; i < p.count; i++)
      if (p.getY(i) < -0.03) expect(Math.abs(p.getX(i))).toBeLessThan(0.114);
    face.dispose();
    panel.dispose();
  });
});
describe('recorded cockpit controls', () => {
  it('maps actual bias, differential and ERS into bounded independent dial angles', () => {
    const out = new T.Vector3();
    expect(controlAngles(0.58, 0.5, 1, out)).toBe(out);
    expect(out.length()).toBeLessThan(1e-10);
    const first = controlAngles(0.56, 0.5, 0).clone();
    const bias = controlAngles(0.6, 0.5, 0);
    expect(bias.x).toBeGreaterThan(first.x);
    expect(bias.y).toBe(first.y);
    expect(bias.z).toBe(first.z);
    expect(controlAngles(0.56, 0.8, 0).z).toBeGreaterThan(first.z);
    expect(controlAngles(0.56, 0.5, 2).y).toBeGreaterThan(first.y);
    expect(controlAngles(-2, -2, -2).toArray()).toEqual(controlAngles(0.48, 0, 0).toArray());
    expect(controlAngles(2, 2, 5).toArray()).toEqual(controlAngles(0.68, 1, 2).toArray());
    expect(() => controlAngles(NaN, 0.5, 1)).toThrow();
  });
  it('is stateless through pauses, seeking backward and different render rates', () => {
    const expected = controlAngles(0.53, 0.74, 0).clone();
    for (let i = 0; i < 144; i++) controlAngles(0.63, 0.31, 2);
    expect(controlAngles(0.53, 0.74, 0)).toEqual(expected);
  });
});
describe('original driver fabric', () => {
  it('generates deterministic opaque linear maps with finite outward unit normals', () => {
    const a = fabricPixels(32),
      b = fabricPixels(32);
    expect(a).toEqual(b);
    for (let i = 0; i < a.normal.length; i += 4) {
      const n = [a.normal[i], a.normal[i + 1], a.normal[i + 2]].map((v) => (v / 255) * 2 - 1);
      expect(Math.hypot(...n)).toBeCloseTo(1, 2);
      expect(n[2]).toBeGreaterThan(0.85);
      expect(a.normal[i + 3]).toBe(255);
      expect(a.roughness[i + 3]).toBe(255);
      expect(a.roughness[i + 1]).toBeGreaterThan(220);
    }
    expect(new Set(a.normal).size).toBeGreaterThan(6);
    for (const size of [0, 31, 50, 512, Infinity]) expect(() => fabricPixels(size)).toThrow();
  });
  it('shares two small mipmapped data textures, never treating normal data as sRGB', () => {
    const m = driverMaterials();
    expect(m.suit.normalMap).toBe(m.glove.normalMap);
    expect(m.panel.roughnessMap).toBe(m.glove.roughnessMap);
    for (const texture of [m.suit.normalMap!, m.suit.roughnessMap!]) {
      expect(texture.colorSpace).toBe(T.NoColorSpace);
      expect(texture.generateMipmaps).toBe(true);
      expect(texture.minFilter).toBe(T.LinearMipmapLinearFilter);
      expect(texture.image.width * texture.image.height).toBe(128 * 128);
      texture.dispose();
    }
    Object.values(m).forEach((material) => material.dispose());
  });
});
it('applies the real filtering setting to small fabric maps without resampling simulation data', async () => {
  const { TextureBudget } = await import('../src/rendering/texture-budget.ts');
  const m = driverMaterials(),
    root = new T.Group(),
    budget = new TextureBudget();
  root.add(new T.Mesh(new T.BoxGeometry(), m.glove));
  const state = new T.DataTexture(new Float32Array(16), 2, 2);
  root.add(new T.Mesh(new T.BoxGeometry(), new T.MeshStandardMaterial({ map: state })));
  budget.register(root);
  for (let i = 0; i < 5; i++) {
    budget.configure(128, 1);
    expect(m.glove.normalMap!.anisotropy).toBe(1);
    budget.configure(1024, 16);
    expect(m.glove.roughnessMap!.anisotropy).toBe(16);
    expect(m.glove.normalMap!.image.width).toBe(128);
    expect(state.anisotropy).toBe(1);
    expect(state.image.width).toBe(2);
  }
  budget.dispose();
});

describe('cockpit detail batching', () => {
  function bank() {
    const parent = new T.Group();
    const materials = [
      new T.MeshStandardMaterial(),
      new T.MeshStandardMaterial(),
      new T.MeshStandardMaterial(),
    ];
    const selectors = new RotarySelectors(parent, materials[0], materials[1], materials[2]);
    return {
      parent,
      selectors,
      cleanup: () => {
        selectors.meshes.forEach((m) => {
          m.dispose();
          m.geometry.dispose();
        });
        materials.forEach((m) => m.dispose());
      },
    };
  }
  it('retains independent recorded dial transforms in three actual GPU instance sets', () => {
    const { parent, selectors, cleanup } = bank();
    expect(selectors.meshes).toHaveLength(3);
    expect(parent.children.filter((o) => o instanceof T.Mesh)).toHaveLength(3);
    const matrix = new T.Matrix4();
    for (const a of [
      new T.Vector3(0, 0, 0),
      controlAngles(0.63, 0.8, 2),
      controlAngles(0.49, 0.1, 0),
    ]) {
      selectors.setAngles(a);
      for (const mesh of selectors.meshes) {
        expect(mesh.count).toBe(3);
        expect(mesh.instanceMatrix.usage).toBe(T.DynamicDrawUsage);
        for (let i = 0; i < 3; i++) {
          mesh.getMatrixAt(i, matrix);
          matrix.elements.forEach((v, j) =>
            expect(v).toBeCloseTo(selectors.selectors[i].matrix.elements[j], 6),
          );
        }
      }
    }
    expect(() => selectors.setAngles(new T.Vector3(NaN, 0, 0))).toThrow();
    cleanup();
  });
  it('encloses every selector vertex throughout rotation without disabling frustum culling', () => {
    const { selectors, cleanup } = bank(),
      point = new T.Vector3(),
      matrix = new T.Matrix4();
    for (let a = -Math.PI; a <= Math.PI; a += Math.PI / 8) {
      selectors.setAngles(new T.Vector3(a, -a, a * 0.5));
      for (const mesh of selectors.meshes) {
        expect(mesh.frustumCulled).toBe(true);
        const p = mesh.geometry.getAttribute('position');
        for (let i = 0; i < 3; i++) {
          mesh.getMatrixAt(i, matrix);
          for (let j = 0; j < p.count; j++) {
            point.fromBufferAttribute(p, j).applyMatrix4(matrix);
            expect(mesh.boundingSphere!.containsPoint(point)).toBe(true);
            expect(mesh.boundingBox!.containsPoint(point)).toBe(true);
          }
        }
      }
    }
    cleanup();
  });
  it('batches lit mirror shells without baking or moving the independent camera apertures', () => {
    const car = new T.Group(),
      body = new T.Group(),
      paint = new T.MeshStandardMaterial(),
      carbon = new T.MeshStandardMaterial();
    car.add(body);
    car.position.set(50, 2, -7);
    car.rotation.set(0.1, 0.4, -0.2);
    const glass = [-1, 1].map((side) => {
      const surface = addMirrorHousing(body, paint, carbon, side);
      surface.updateWorldMatrix(true, false);
      const before = surface.matrixWorld.clone();
      car.attach(surface);
      surface.updateWorldMatrix(true, false);
      surface.matrixWorld.elements.forEach((v, i) => expect(v).toBeCloseTo(before.elements[i], 10));
      return surface;
    });
    const positions = glass.map((m) => m.getWorldPosition(new T.Vector3()));
    mergeStatic(body);
    expect(body.children).toHaveLength(2);
    glass.forEach((m, i) => {
      expect(m.parent).toBe(car);
      expect(m.getWorldPosition(new T.Vector3()).distanceTo(positions[i])).toBeLessThan(1e-9);
      expect(m.castShadow).toBe(false);
    });
    car.traverse((o) => {
      if (o instanceof T.Mesh) o.geometry.dispose();
    });
    glass.forEach((m) => m.material.dispose());
    paint.dispose();
    carbon.dispose();
  });
});
