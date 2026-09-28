import { describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { SuppliedDrawRanges } from '../src/rendering/supplied-draw-ranges.ts';

const scene = new T.Scene();
const renderer = {} as T.WebGLRenderer;
function fixture() {
  const geometry = new T.BufferGeometry();
  const positions: number[] = [],
    indices: number[] = [];
  for (const z of [4, -4, 4])
    for (let i = 0; i < 128; i++) {
      const n = positions.length / 3;
      positions.push(-0.2, -0.2, z, 0.2, -0.2, z, 0, 0.2, z);
      indices.push(n, n + 1, n + 2);
    }
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  const material = new T.MeshStandardMaterial({ side: T.DoubleSide, transparent: true });
  const mesh = new T.Mesh(geometry, material);
  mesh.updateMatrixWorld(true);
  const camera = new T.PerspectiveCamera(60, 1, 0.01, 100);
  camera.updateMatrixWorld(true);
  const ranges = new SuppliedDrawRanges([{ mesh, geometries: [geometry] }]);
  const before = (c = camera, g = mesh.geometry, m: T.Material = material) =>
    mesh.onBeforeRender(renderer, scene, c, g, m, null as unknown as T.Group);
  const after = () =>
    mesh.onAfterRender(
      renderer,
      scene,
      camera,
      mesh.geometry,
      material,
      null as unknown as T.Group,
    );
  return { mesh, geometry, camera, material, ranges, before, after };
}

describe('source-preserving supplied draw ranges', () => {
  it('trims only invisible contiguous ends and restores exact indices and range after submission', () => {
    const f = fixture(),
      index = f.geometry.index!,
      values = index.array.slice();
    const position = f.geometry.attributes.position;
    f.before();
    expect(f.geometry.drawRange).toEqual({ start: 384, count: 384 });
    expect(f.geometry.index).toBe(index);
    expect(f.geometry.attributes.position).toBe(position);
    expect(f.geometry.index!.array).toEqual(values);
    expect(f.material.side).toBe(T.DoubleSide);
    expect(f.material.transparent).toBe(true);
    f.after();
    expect(f.geometry.drawRange).toEqual({ start: 0, count: Infinity });
    expect(f.ranges.diagnostics().omittedTriangles).toBe(256);
    f.ranges.dispose();
  });
  it('retains off-screen interior blocks rather than reordering transparent triangles', () => {
    const f = fixture();
    f.camera.lookAt(0, 0, 5);
    f.camera.updateMatrixWorld(true);
    f.before();
    expect(f.geometry.drawRange).toEqual({ start: 0, count: Infinity });
    f.after();
    f.ranges.dispose();
  });
  it('uses each actual shadow and mirror camera instead of a cached forward-view range', () => {
    const f = fixture();
    f.before();
    f.after();
    const shadow = new T.PerspectiveCamera(60, 1, 0.01, 100);
    shadow.lookAt(0, 0, 5);
    shadow.updateMatrixWorld(true);
    const depth = new T.MeshDepthMaterial();
    f.mesh.onBeforeShadow(
      renderer,
      scene,
      f.camera,
      shadow,
      f.geometry,
      depth,
      null as unknown as T.Group,
    );
    expect(f.geometry.drawRange).toEqual({ start: 0, count: Infinity });
    f.mesh.onAfterShadow(
      renderer,
      scene,
      f.camera,
      shadow,
      f.geometry,
      depth,
      null as unknown as T.Group,
    );
    f.before(shadow);
    f.after();
    f.before();
    expect(f.geometry.drawRange.count).toBe(384);
    f.after();
    f.ranges.dispose();
  });
  it('keeps authored ranges, changed indices, changed positions and deformation on the original path', () => {
    for (const mutate of [
      (f: ReturnType<typeof fixture>) => f.geometry.setDrawRange(3, 600),
      (f: ReturnType<typeof fixture>) => {
        f.geometry.index!.needsUpdate = true;
      },
      (f: ReturnType<typeof fixture>) => {
        f.geometry.attributes.position.needsUpdate = true;
      },
      (f: ReturnType<typeof fixture>) => f.geometry.setIndex(f.geometry.index!.clone()),
      (f: ReturnType<typeof fixture>) =>
        f.geometry.setAttribute('position', f.geometry.attributes.position.clone()),
      (f: ReturnType<typeof fixture>) => {
        f.geometry.morphAttributes.position = [f.geometry.attributes.position];
      },
      (f: ReturnType<typeof fixture>) => {
        f.material.displacementMap = new T.Texture();
      },
      (f: ReturnType<typeof fixture>) => {
        f.material.wireframe = true;
      },
    ]) {
      const f = fixture();
      mutate(f);
      const old = { ...f.geometry.drawRange };
      f.before();
      expect(f.geometry.drawRange).toEqual(old);
      f.after();
      f.ranges.dispose();
    }
    const f = fixture();
    f.before(f.camera, f.geometry, new T.ShaderMaterial());
    expect(f.geometry.drawRange.count).toBe(Infinity);
    f.ranges.dispose();
  });
  it('falls back for unknown geometry, nonfinite or singular transforms and disabled culling', () => {
    const f = fixture(),
      other = f.geometry.clone();
    f.before(f.camera, other);
    expect(other.drawRange.count).toBe(Infinity);
    f.ranges.enabled = false;
    f.before();
    expect(f.geometry.drawRange.count).toBe(Infinity);
    f.ranges.enabled = true;
    f.mesh.matrixWorld.makeScale(0, 0, 0);
    f.before();
    expect(f.geometry.drawRange.count).toBe(Infinity);
    f.mesh.matrixWorld.elements[0] = NaN;
    f.before();
    expect(f.geometry.drawRange.count).toBe(Infinity);
    f.ranges.dispose();
  });
  it('preserves intersecting near-plane blocks and handles transformed source coordinates', () => {
    const f = fixture();
    f.mesh.position.z = 3.99;
    f.mesh.rotation.y = Math.PI;
    f.mesh.scale.x = -1;
    f.mesh.updateMatrixWorld(true);
    f.before();
    expect(f.geometry.drawRange.count).toBe(Infinity);
    f.after();
    f.ranges.dispose();
  });
  it('restores callbacks and even an interrupted submission exactly once without disposing geometry', () => {
    const f = fixture();
    f.ranges.dispose();
    const before = vi.fn(),
      after = vi.fn(),
      beforeShadow = vi.fn(),
      afterShadow = vi.fn();
    f.mesh.onBeforeRender = before;
    f.mesh.onAfterRender = after;
    f.mesh.onBeforeShadow = beforeShadow;
    f.mesh.onAfterShadow = afterShadow;
    const dispose = vi.fn();
    f.geometry.addEventListener('dispose', dispose);
    const ranges = new SuppliedDrawRanges([{ mesh: f.mesh, geometries: [f.geometry] }]);
    f.before();
    expect(before).toHaveBeenCalledOnce();
    f.after();
    expect(after).toHaveBeenCalledOnce();
    f.before();
    ranges.dispose();
    ranges.dispose();
    expect(f.geometry.drawRange).toEqual({ start: 0, count: Infinity });
    expect(f.mesh.onBeforeRender).toBe(before);
    expect(f.mesh.onAfterRender).toBe(after);
    expect(f.mesh.onBeforeShadow).toBe(beforeShadow);
    expect(f.mesh.onAfterShadow).toBe(afterShadow);
    expect(dispose).not.toHaveBeenCalled();
  });
  it('does not install static culling on skinning, instancing or grouped triangle streams', () => {
    const f = fixture();
    f.ranges.dispose();
    const meshes = [
      new T.SkinnedMesh(f.geometry, f.material),
      new T.InstancedMesh(f.geometry, f.material, 1),
    ];
    const ranges = new SuppliedDrawRanges(
      meshes.map((mesh) => ({ mesh, geometries: [f.geometry] })),
    );
    expect(ranges.diagnostics().meshes).toBe(0);
    ranges.dispose();
    f.geometry.addGroup(0, 384, 0);
    const groups = new SuppliedDrawRanges([{ mesh: f.mesh, geometries: [f.geometry] }]);
    expect(groups.diagnostics().meshes).toBe(0);
    groups.dispose();
  });
});
