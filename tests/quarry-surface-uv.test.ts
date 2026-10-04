import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

it('every nondegenerate limestone triangle has two-dimensional texture coordinates', async () => {
  const data = readFileSync('public/models/aurel-quarry.glb');
  const loader = new GLTFLoader().register(() => ({
    name: 'CPU_texture_coordinate_check',
    loadTexture: () =>
      Promise.resolve(new T.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1)),
  }));
  const asset = await loader.parseAsync(
    data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    '',
  );
  const collapsed: { mesh: string; triangle: number }[] = [];
  let triangles = 0;
  const a = new T.Vector3(),
    ab = new T.Vector3(),
    ac = new T.Vector3();
  const geometries = new Set<T.BufferGeometry>(),
    materials = new Set<T.Material>(),
    textures = new Set<T.Texture>();
  try {
    asset.scene.traverse((o) => {
      if (!(o instanceof T.Mesh)) return;
      geometries.add(o.geometry);
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        materials.add(m);
        for (const value of Object.values(m)) if (value instanceof T.Texture) textures.add(value);
      }
      if (o.material.name !== 'A55_A60_LIMESTONE') return;
      const p = o.geometry.getAttribute('position'),
        uv = o.geometry.getAttribute('uv'),
        index = o.geometry.index!;
      for (let i = 0; i < index.count; i += 3) {
        const ia = index.getX(i),
          ib = index.getX(i + 1),
          ic = index.getX(i + 2);
        a.fromBufferAttribute(p, ia);
        ab.fromBufferAttribute(p, ib).sub(a);
        ac.fromBufferAttribute(p, ic).sub(a);
        if (ab.cross(ac).length() < 1e-7) continue;
        triangles++;
        const area = Math.abs(
          (uv.getX(ib) - uv.getX(ia)) * (uv.getY(ic) - uv.getY(ia)) -
            (uv.getX(ic) - uv.getX(ia)) * (uv.getY(ib) - uv.getY(ia)),
        );
        if (!Number.isFinite(area) || area < 1e-10)
          collapsed.push({ mesh: o.name, triangle: i / 3 });
      }
    });
    expect(triangles).toBeGreaterThan(4000);
    expect(collapsed).toEqual([]);
  } finally {
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    textures.forEach((t) => t.dispose());
  }
});
