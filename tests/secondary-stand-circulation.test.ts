import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { packSecondaryStandCirculation } from '../src/rendering/secondary-grandstand-detail.ts';
import {
  secondaryStandGeometry,
  SECONDARY_TIERS,
} from '../src/rendering/secondary-grandstand-assets.ts';

/** Flatten oriented corners, normals and UVs, not just an AABB or a count. */
function corners(geometry: T.BufferGeometry, z: number, start = 0, count = geometry.index!.count) {
  const result: number[] = [];
  const p = geometry.getAttribute('position');
  const n = geometry.getAttribute('normal');
  const uv = geometry.getAttribute('uv');
  for (let i = start; i < start + count; i++) {
    const v = geometry.index!.getX(i);
    result.push(
      p.getX(v),
      p.getY(v),
      p.getZ(v) + z,
      n.getX(v),
      n.getY(v),
      n.getZ(v),
      uv.getX(v),
      uv.getY(v),
    );
  }
  return result;
}

describe('A12 same-material circulation batching', () => {
  for (const mirror of [false, true])
    for (const [tier, name] of SECONDARY_TIERS.entries())
      it(`retains every oriented ${name} rail/aisle corner on ${mirror ? 'left' : 'right'} stands`, () => {
        const packed = packSecondaryStandCirculation(mirror);
        const rail = secondaryStandGeometry(`rails_${name}`, mirror);
        const aisle = secondaryStandGeometry(`aisle_${name}`, mirror);
        try {
          const range = packed.ranges[tier];
          expect(range.count).toBe(rail.index!.count * 3 + aisle.index!.count);
          for (const half of [-12, 12]) {
            const expected = [
              ...corners(rail, half - 8),
              ...corners(rail, half),
              ...corners(rail, half + 8),
              ...corners(aisle, half),
            ];
            const actual = corners(packed.geometry, half, range.start, range.count);
            expect(actual.length).toBe(expected.length);
            for (let i = 0; i < actual.length; i++)
              // A baked float32 translation can round by < 0.000005 m.
              expect(actual[i]).toBeCloseTo(expected[i], 5);
          }
          // The assembled batch covers exactly six original rail modules and
          // both original protected aisles, without creating duplicate triangles.
          expect(range.count * 2).toBe(rail.index!.count * 6 + aisle.index!.count * 2);
        } finally {
          packed.geometry.dispose();
          rail.dispose();
          aisle.dispose();
        }
      });

  it('retains index, vertex and instance storage through main/shadow/reflection cuts', () => {
    const packed = packSecondaryStandCirculation();
    const geometry = packed.geometry;
    const material = new T.MeshStandardMaterial();
    const mesh = new T.InstancedMesh(geometry, material, 2);
    mesh.setMatrixAt(0, new T.Matrix4().makeTranslation(0, 0, -12));
    mesh.setMatrixAt(1, new T.Matrix4().makeTranslation(0, 0, 12));
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    mesh.updateMatrixWorld(true);
    const before = mesh.onBeforeRender;
    const detach = packed.bind(mesh);
    const position = geometry.getAttribute('position');
    const index = geometry.index;
    const instances = mesh.instanceMatrix;
    let height = 720;
    const renderer = {
      getCurrentViewport: (v: T.Vector4) => v.set(0, 0, height === 720 ? 1280 : height, height),
      getDrawingBufferSize: (v: T.Vector2) => v.set(1280, 720),
    } as T.WebGLRenderer;
    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(58, 16 / 9, 0.1, 2000);
    const shadow = new T.OrthographicCamera(-300, 300, 300, -300, 0.1, 2000);
    const group = new T.Group();
    try {
      for (const distance of [30, 240, 550, 30, 550]) {
        camera.position.set(0, 5, distance);
        camera.updateMatrixWorld(true);
        height = 720;
        mesh.onBeforeRender(renderer, scene, camera, geometry, material, group);
        expect(geometry.drawRange.count).toBeGreaterThan(0);
        mesh.onAfterRender(renderer, scene, camera, geometry, material, group);
        expect(geometry.drawRange).toEqual(packed.ranges[0]);
        height = 512;
        shadow.position.z = 500;
        shadow.updateMatrixWorld(true);
        mesh.onBeforeShadow(renderer, scene, camera, shadow, geometry, material, group);
        expect(geometry.drawRange).toEqual(packed.ranges[2]);
        mesh.onAfterShadow(renderer, scene, camera, shadow, geometry, material, group);
        expect(geometry.drawRange).toEqual(packed.ranges[0]);
        expect(geometry.getAttribute('position')).toBe(position);
        expect(geometry.index).toBe(index);
        expect(mesh.instanceMatrix).toBe(instances);
      }
    } finally {
      detach();
      expect(mesh.onBeforeRender).toBe(before);
      mesh.dispose();
      geometry.dispose();
      material.dispose();
    }
  });

  it('owns separate packed buffers per scene and never mutates native prototypes', () => {
    const a = packSecondaryStandCirculation();
    const b = packSecondaryStandCirculation();
    try {
      expect(a.geometry).not.toBe(b.geometry);
      expect(a.geometry.getAttribute('position').array).not.toBe(
        b.geometry.getAttribute('position').array,
      );
      expect(a.geometry.index!.array).not.toBe(b.geometry.index!.array);
      for (const tier of [0, 1, 2, 0] as const) {
        a.select(tier);
        expect(b.geometry.drawRange).toEqual(b.ranges[0]);
      }
    } finally {
      a.geometry.dispose();
      b.geometry.dispose();
    }
  });
});
