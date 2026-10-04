import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { StaticInstanceShadowBounds } from '../src/rendering/static-instance-shadow-bounds.ts';

function fixture() {
  const geometry = new T.BoxGeometry(0.5, 0.5, 80);
  const mesh = new T.InstancedMesh(geometry, new T.MeshStandardMaterial(), 2);
  mesh.setMatrixAt(0, new T.Matrix4());
  mesh.setMatrixAt(1, new T.Matrix4().makeTranslation(0, 1, 0));
  mesh.position.x = 20;
  mesh.castShadow = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  mesh.updateMatrixWorld(true);
  const view = new T.PerspectiveCamera(58, 16 / 9);
  view.position.set(20, 0, 10);
  view.lookAt(20, 0, 0);
  view.updateMatrixWorld();
  const shadow = new T.OrthographicCamera(-5, 5, 5, -5, 0.1, 200);
  shadow.position.z = 100;
  shadow.updateMatrixWorld();
  const depth = new T.MeshDepthMaterial();
  const renderer = {} as T.WebGLRenderer;
  const before = mesh.onBeforeShadow,
    after = mesh.onAfterShadow,
    render = mesh.onBeforeRender;
  const guard = new StaticInstanceShadowBounds(mesh);
  const args = () =>
    [
      renderer,
      mesh as unknown as T.Scene,
      view,
      shadow,
      geometry,
      depth,
      null as unknown as T.Group,
    ] as const;
  return {
    geometry,
    mesh,
    view,
    shadow,
    depth,
    renderer,
    guard,
    before,
    after,
    render,
    begin: () => mesh.onBeforeShadow(...args()),
    end: () => mesh.onAfterShadow(...args()),
    dispose: () => {
      mesh.dispose();
      geometry.dispose();
      (mesh.material as T.Material).dispose();
      depth.dispose();
    },
  };
}

describe('rigid instance shadow AABB rejection', () => {
  it('uses the fourth camera, retains visible geometry and restores exact finite caller ranges', () => {
    const f = fixture();
    try {
      const frustum = new T.Frustum().setFromProjectionMatrix(
        new T.Matrix4().multiplyMatrices(f.shadow.projectionMatrix, f.shadow.matrixWorldInverse),
      );
      expect(frustum.intersectsObject(f.mesh)).toBe(true);
      f.geometry.setDrawRange(6, 18);
      f.mesh.count = 1;
      f.begin();
      expect(f.geometry.drawRange).toEqual({ start: 6, count: 0 });
      expect(f.mesh.count).toBe(0);
      f.end();
      expect(f.geometry.drawRange).toEqual({ start: 6, count: 18 });
      expect(f.mesh.count).toBe(1);
      f.shadow.position.x = 20;
      f.shadow.updateMatrixWorld();
      f.begin();
      expect(f.geometry.drawRange).toEqual({ start: 6, count: 18 });
      expect(f.mesh.count).toBe(1);
      f.end();
      expect(f.guard.diagnostics()).toEqual({ tested: 2, rejected: 1 });
      expect(f.mesh.castShadow).toBe(true);
    } finally {
      f.dispose();
    }
  });
  it('retains a boundary silhouette and honours transformed parents without changing buffers', () => {
    const f = fixture();
    try {
      const ids = [
        f.mesh.geometry,
        f.geometry.index,
        f.geometry.getAttribute('position'),
        f.mesh.instanceMatrix,
        f.mesh.instanceMatrix.array,
      ];
      for (const x of [5.2499, 5.2501, 5.2509]) {
        f.mesh.position.x = x;
        f.mesh.updateMatrixWorld();
        f.begin();
        expect(f.geometry.drawRange.count).toBe(Infinity);
        f.end();
      }
      const parent = new T.Group();
      parent.position.x = -20;
      parent.add(f.mesh);
      f.mesh.position.x = 20;
      parent.rotation.y = Math.PI / 4;
      parent.scale.set(2, 1, -1);
      parent.updateMatrixWorld(true);
      for (let i = 0; i < 50; i++) {
        f.shadow.position.x = i - 25;
        f.shadow.updateMatrixWorld();
        f.begin();
        f.end();
      }
      expect([
        f.mesh.geometry,
        f.geometry.index,
        f.geometry.getAttribute('position'),
        f.mesh.instanceMatrix,
        f.mesh.instanceMatrix.array,
      ]).toEqual(ids);
    } finally {
      f.dispose();
    }
  });
  it('restores after an interrupted shadow draw and removes all hooks on disposal', () => {
    const f = fixture();
    try {
      f.geometry.setDrawRange(3, 12);
      f.begin();
      expect(f.geometry.drawRange.count).toBe(0);
      expect(f.mesh.count).toBe(0);
      f.mesh.onBeforeRender(
        f.renderer,
        new T.Scene(),
        f.view,
        f.geometry,
        f.mesh.material as T.Material,
        null as unknown as T.Group,
      );
      expect(f.geometry.drawRange).toEqual({ start: 3, count: 12 });
      expect(f.mesh.count).toBe(2);
      f.begin();
      f.guard.dispose();
      f.guard.dispose();
      expect(f.geometry.drawRange).toEqual({ start: 3, count: 12 });
      expect(f.mesh.count).toBe(2);
      expect(f.mesh.onBeforeShadow).toBe(f.before);
      expect(f.mesh.onAfterShadow).toBe(f.after);
      expect(f.mesh.onBeforeRender).toBe(f.render);
    } finally {
      f.dispose();
    }
  });
  const changes: Record<string, (f: ReturnType<typeof fixture>) => void> = {
    'disabled control': (f) => {
      f.guard.enabled = false;
    },
    'instance upload': (f) => {
      f.mesh.instanceMatrix.needsUpdate = true;
    },
    'vertex upload': (f) => {
      (f.geometry.getAttribute('position') as T.BufferAttribute).needsUpdate = true;
    },
    'index upload': (f) => {
      f.geometry.index!.needsUpdate = true;
    },
    'replacement instances': (f) => {
      f.mesh.instanceMatrix = new T.InstancedBufferAttribute(
        new Float32Array(f.mesh.instanceMatrix.array),
        16,
      );
    },
    'replacement bound': (f) => {
      f.mesh.boundingBox = f.mesh.boundingBox!.clone();
    },
    'custom depth vertex program': (f) => {
      f.depth.onBeforeCompile = () => {};
    },
    wireframe: (f) => {
      f.depth.wireframe = true;
    },
    'morph targets': (f) => {
      f.geometry.morphAttributes.position = [f.geometry.getAttribute('position')];
    },
    'singular projection': (f) => {
      f.shadow.projectionMatrix.elements.fill(0);
    },
    'nonfinite projection': (f) => {
      f.shadow.projectionMatrix.elements[0] = NaN;
    },
  };
  for (const [name, change] of Object.entries(changes))
    it(`keeps the original full submission for ${name}`, () => {
      const f = fixture();
      try {
        change(f);
        f.begin();
        expect(f.geometry.drawRange.count).toBe(Infinity);
        f.end();
      } finally {
        f.dispose();
      }
    });
  it('rejects uncomputed authoring bounds rather than assuming an empty batch', () => {
    const mesh = new T.InstancedMesh(new T.BoxGeometry(), new T.MeshStandardMaterial(), 1);
    try {
      expect(() => new StaticInstanceShadowBounds(mesh)).toThrow('finite authored batch');
    } finally {
      mesh.dispose();
      mesh.geometry.dispose();
      (mesh.material as T.Material).dispose();
    }
  });
});
