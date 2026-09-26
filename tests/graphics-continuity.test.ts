import { describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { mergeStatic, batchScene } from '../src/rendering/geometry.ts';
import { ReducedCar, carLod } from '../src/rendering/lod.ts';
import { drawControlLegends, COCKPIT_LEGEND_FONT_PX } from '../src/rendering/cockpit.ts';
import { ROAD_FILM_F0, ROAD_FILM_IOR, installWetRoad } from '../src/rendering/materials.ts';
import { driverMaterials } from '../src/rendering/driver-materials.ts';

function triangles(g: T.BufferGeometry) {
  const count = g.index?.count ?? g.getAttribute('position').count;
  return Array.from({ length: count }, (_, corner) => {
    const i = g.index?.getX(corner) ?? corner;
    return Object.entries(g.attributes).flatMap(([name, a]) => [
      name,
      ...Array.from({ length: a.itemSize }, (_, c) => a.getComponent(i, c)),
    ]);
  });
}
function bytes(g: T.BufferGeometry) {
  return (
    Object.values(g.attributes).reduce((n, a) => n + a.array.byteLength, 0) +
    (g.index?.array.byteLength ?? 0)
  );
}
function release(root: T.Object3D) {
  const geometry = new Set<T.BufferGeometry>();
  root.traverse((o) => {
    if (o instanceof T.Mesh) geometry.add(o.geometry);
  });
  geometry.forEach((g) => g.dispose());
}

describe('graphics closure: indexed static batching', () => {
  it('preserves every expanded triangle, UV seam, normal, colour and transform', () => {
    const group = new T.Group(),
      parent = new T.Group(),
      material = new T.MeshStandardMaterial();
    parent.position.set(73, -2, 114);
    parent.rotation.y = 0.37;
    parent.add(group);
    group.position.set(1, 2, 3);
    group.rotation.x = 0.11;
    const a = new T.SphereGeometry(1, 24, 16),
      b = new T.BoxGeometry().toNonIndexed();
    for (const g of [a, b]) {
      const p = g.getAttribute('position');
      g.setAttribute(
        'color',
        new T.Float32BufferAttribute(
          Array.from({ length: p.count * 3 }, (_, i) => (i % 17) / 17),
          3,
        ),
      );
    }
    const first = new T.Mesh(a, material),
      second = new T.Mesh(b, material);
    first.position.set(-2, 0, 0);
    second.rotation.set(0.3, 0.1, -0.7);
    group.add(first, second);
    parent.updateMatrixWorld(true);
    const inverse = group.matrixWorld.clone().invert();
    const expected = [first, second].flatMap((o) => {
      const g = o.geometry.clone().applyMatrix4(inverse.clone().multiply(o.matrixWorld));
      const result = triangles(g);
      g.dispose();
      return result;
    });
    const oldExpandedBytes = expected.length * 11 * 4;
    const aDisposed = vi.fn(),
      bDisposed = vi.fn();
    a.addEventListener('dispose', aDisposed);
    b.addEventListener('dispose', bDisposed);
    mergeStatic(group);
    expect(group.children).toHaveLength(1);
    const result = group.children[0] as T.Mesh;
    expect(triangles(result.geometry)).toEqual(expected);
    expect(result.geometry.index).not.toBeNull();
    expect(bytes(result.geometry)).toBeLessThan(oldExpandedBytes * 0.5);
    expect(aDisposed).toHaveBeenCalledTimes(1);
    expect(bDisposed).toHaveBeenCalledTimes(1);
    expect(result.material).toBe(material);
    expect(result.geometry.boundingBox).not.toBeNull();
    expect(result.geometry.boundingSphere!.radius).toBeGreaterThan(0);
    release(group);
    material.dispose();
  });
  it('does not partially erase a scene when input attributes cannot be batched', () => {
    const group = new T.Group(),
      m = new T.MeshStandardMaterial();
    const a = new T.Mesh(new T.BoxGeometry(), m),
      b = new T.Mesh(new T.BoxGeometry(), m);
    b.geometry.deleteAttribute('uv');
    group.add(a, b);
    const dispose = vi.fn();
    a.geometry.addEventListener('dispose', dispose);
    const expectedError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(() => mergeStatic(group)).toThrow('incompatible attributes');
      expect(expectedError).toHaveBeenCalled();
      expect(group.children).toEqual([a, b]);
      expect(dispose).not.toHaveBeenCalled();
    } finally {
      expectedError.mockRestore();
      release(group);
      m.dispose();
    }
  });
  it('releases a shared original geometry only once', () => {
    const group = new T.Group(),
      m = new T.MeshStandardMaterial(),
      g = new T.BoxGeometry();
    const dispose = vi.fn();
    g.addEventListener('dispose', dispose);
    group.add(new T.Mesh(g, m), new T.Mesh(g, m));
    mergeStatic(group);
    expect(dispose).toHaveBeenCalledTimes(1);
    release(group);
    m.dispose();
  });
});

describe('graphics closure: original livery at every distance', () => {
  it.each([1, 2] as const)(
    'shares both signed flank materials at LOD %s, without allocating replacement textures',
    (level) => {
      const paint = new T.MeshStandardMaterial(),
        carbon = new T.MeshStandardMaterial(),
        rubber = new T.MeshStandardMaterial();
      const left = new T.MeshStandardMaterial({ map: new T.DataTexture(new Uint8Array(16), 2, 2) });
      const right = new T.MeshStandardMaterial({
        map: new T.DataTexture(new Uint8Array(16), 2, 2),
      });
      const car = new ReducedCar(level, paint, carbon, rubber, [right, left]);
      const flanks: T.Mesh[] = [];
      car.root.traverse((o) => {
        if (o instanceof T.Mesh && [right, left].includes(o.material as T.MeshStandardMaterial))
          flanks.push(o);
      });
      expect(flanks).toHaveLength(2);
      car.root.updateMatrixWorld(true);
      for (const material of [right, left]) {
        const mesh = flanks.find((m) => m.material === material)!;
        const bounds = new T.Box3().setFromObject(mesh);
        expect(Math.sign(bounds.getCenter(new T.Vector3()).x)).toBe(material === right ? -1 : 1);
        const uv = mesh.geometry.getAttribute('uv');
        expect(uv).toBeDefined();
        for (let i = 0; i < uv.count; i++) {
          expect(uv.getX(i)).toBeGreaterThanOrEqual(0);
          expect(uv.getX(i)).toBeLessThanOrEqual(1);
          expect(uv.getY(i)).toBeGreaterThanOrEqual(0);
          expect(uv.getY(i)).toBeLessThanOrEqual(1);
        }
        const texture = material.map!,
          version = texture.version;
        texture.needsUpdate = true;
        expect((mesh.material as T.MeshStandardMaterial).map).toBe(texture);
        expect(texture.version).toBe(version + 1);
      }
      expect(car.wheels).toHaveLength(4);
      expect(car.spins).toHaveLength(4);
      release(car.root);
      for (const m of [paint, carbon, rubber, right, left]) m.dispose();
      right.map!.dispose();
      left.map!.dispose();
    },
  );
  it('retains the original near/far hysteresis and never reduces the followed car', () => {
    expect(carLod(60, 0, 'medium', false)).toBe(0);
    expect(carLod(64, 0, 'medium', false)).toBe(1);
    expect(carLod(133, 1, 'medium', false)).toBe(1);
    expect(carLod(139, 1, 'medium', false)).toBe(2);
    expect(carLod(130, 2, 'medium', false)).toBe(2);
    expect(carLod(1000, 2, 'low', true)).toBe(0);
  });
});

describe('graphics closure: tactile cockpit material separation', () => {
  it('retains exactly two shared texture resources but distinct glove/suit surface responses', () => {
    const m = driverMaterials();
    expect(m.suit.normalMap).toBe(m.glove.normalMap);
    expect(m.glove.normalMap).toBe(m.panel.normalMap);
    expect(m.suit.roughnessMap).toBe(m.glove.roughnessMap);
    expect(m.suit.roughness).toBeGreaterThan(m.glove.roughness);
    expect(m.suit.normalScale.x).toBeGreaterThan(m.glove.normalScale.x);
    expect(m.glove.normalScale.x).toBeGreaterThan(m.panel.normalScale.x);
    expect(m.glove.emissive.getHex()).toBe(0);
    expect(m.glove.metalness).toBe(0);
    for (const material of Object.values(m)) material.dispose();
    m.suit.normalMap!.dispose();
    m.suit.roughnessMap!.dispose();
  });
});

describe('graphics closure: spatial scene batching', () => {
  it('preserves static triangles, source flags, spatial cells and animated roots', () => {
    const root = new T.Group(),
      parent = new T.Group(),
      material = new T.MeshStandardMaterial();
    const preserved = new T.Group(),
      hidden = new T.Group();
    hidden.visible = false;
    const animated = new T.Mesh(new T.BoxGeometry(), material);
    const hiddenChild = new T.Mesh(new T.BoxGeometry(), material);
    preserved.add(animated);
    hidden.add(hiddenChild);
    const a = new T.Mesh(new T.SphereGeometry(1, 20, 12), material);
    const b = new T.Mesh(new T.BoxGeometry().toNonIndexed(), material);
    const far = new T.Mesh(new T.BoxGeometry(), material);
    a.position.set(15, 2, 15);
    b.position.set(18, 3, 18);
    far.position.set(150, 0, 150);
    a.castShadow = b.castShadow = true;
    a.receiveShadow = b.receiveShadow = true;
    a.renderOrder = b.renderOrder = 2;
    a.layers.set(2);
    b.layers.set(2);
    parent.add(a, b, far);
    root.add(parent, preserved, hidden);
    root.position.set(20, 0, -10);
    root.updateMatrixWorld(true);
    const inverse = root.matrixWorld.clone().invert();
    const expanded = (objects: T.Mesh[]) =>
      objects.flatMap((o) => {
        const geometry = o.geometry.clone().applyMatrix4(inverse.clone().multiply(o.matrixWorld));
        const data = triangles(geometry);
        geometry.dispose();
        return data;
      });
    const nearTriangles = expanded([a, b]),
      farTriangles = expanded([far]);
    batchScene(root, new Set([preserved]));
    const batches = root.children.filter((o): o is T.Mesh => o instanceof T.Mesh);
    expect(batches).toHaveLength(2);
    const nearBatch = batches.find((o) => o.castShadow)!;
    expect(triangles(nearBatch.geometry)).toEqual(nearTriangles);
    expect(triangles(batches.find((o) => !o.castShadow)!.geometry)).toEqual(farTriangles);
    expect(nearBatch.receiveShadow).toBe(true);
    expect(nearBatch.renderOrder).toBe(2);
    expect(nearBatch.layers.mask).toBe(a.layers.mask);
    expect(nearBatch.geometry.index).not.toBeNull();
    expect(animated.parent).toBe(preserved);
    expect(hiddenChild.parent).toBe(hidden);
    expect(hidden.visible).toBe(false);
    release(root);
    material.dispose();
  });
  it('keeps originals on incompatible input, rather than silently dropping scenery', () => {
    const root = new T.Group(),
      material = new T.MeshStandardMaterial();
    const a = new T.Mesh(new T.BoxGeometry(), material),
      b = new T.Mesh(new T.BoxGeometry(), material);
    b.geometry.deleteAttribute('normal');
    root.add(a, b);
    const disposed = vi.fn();
    a.geometry.addEventListener('dispose', disposed);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(() => batchScene(root, new Set())).toThrow('incompatible attributes');
      expect(root.children).toEqual([a, b]);
      expect(disposed).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      release(root);
      material.dispose();
    }
  });
});

it('keeps readable selector labels in the existing bounded atlas, without changing dial state', () => {
  const labels: { text: string; x: number; y: number; font: string }[] = [];
  const context = {
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    textAlign: '',
    textBaseline: '',
    fillRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    fillText(text: string, x: number, y: number) {
      labels.push({ text, x, y, font: this.font });
    },
  };
  drawControlLegends(context as unknown as CanvasRenderingContext2D);
  expect(labels.slice(0, 3).map((x) => x.text)).toEqual(['BIAS', '−', '+']);
  const headings = labels.filter((x) => ['BIAS', 'ENERGY', 'DIFF'].includes(x.text));
  expect(headings).toHaveLength(3);
  for (const heading of headings)
    expect(heading.font).toBe(`700 ${COCKPIT_LEGEND_FONT_PX}px Arial`);
  for (const label of labels) {
    expect(label.x).toBeGreaterThan(0);
    expect(label.x).toBeLessThan(1024);
    expect(label.y).toBeGreaterThan(0);
    expect(label.y).toBeLessThan(384);
  }
});

it('uses a named water Fresnel approximation and retains prior surface shader ownership', () => {
  expect(ROAD_FILM_IOR).toBe(1.333);
  expect(ROAD_FILM_F0).toBeCloseTo(((1.333 - 1) / (1.333 + 1)) ** 2, 12);
  expect(ROAD_FILM_F0).toBeGreaterThan(0.02);
  expect(ROAD_FILM_F0).toBeLessThan(0.021);
  const material = new T.MeshPhysicalMaterial(),
    texture = new T.DataTexture(new Uint8Array(4), 1, 1);
  const prior = vi.fn();
  material.onBeforeCompile = prior;
  material.customProgramCacheKey = () => 'prior-surface';
  installWetRoad(material, texture, true);
  const shader = {
    uniforms: {},
    vertexShader: T.ShaderLib.physical.vertexShader,
    fragmentShader: T.ShaderLib.physical.fragmentShader,
  };
  material.onBeforeCompile(shader as T.WebGLProgramParametersWithUniforms, {} as T.WebGLRenderer);
  expect(prior).toHaveBeenCalledTimes(1);
  expect(material.customProgramCacheKey()).toContain('prior-surface');
  expect(shader.fragmentShader).toContain('material.clearcoatF0');
  expect(shader.fragmentShader.replace(/\s/g, '')).toContain(
    'material.clearcoatRoughness+geometryRoughness',
  );
  expect(shader.fragmentShader).toContain('dFdx(clearcoatNormal)');
  material.dispose();
  texture.dispose();
});
