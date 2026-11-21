import * as T from 'three';
import { describe, it, expect } from 'vitest';
import { installGpKerbDetail } from '../src/rendering/gp-kerb-detail.ts';

function grid(ascending: boolean, opening: boolean) {
  const rows = 90,
    cols = 6,
    indices: number[] = [],
    points: number[] = [];
  for (let row = 0; row <= rows; row++) {
    for (let col = 0; col <= cols; col++) {
      points.push(((ascending ? 1 : -1) * col) / cols, 0.018 * Math.sin(row * 1.5), row * 0.16);
      if (row === rows || col === cols || (opening && row >= 38 && row < 45 && col >= 2)) continue;
      const a = row * (cols + 1) + col,
        b = a + cols + 1;
      if (ascending) indices.push(a, b, a + 1, b, b + 1, a + 1);
      else indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const geo = new T.BufferGeometry().setAttribute(
    'position',
    new T.Float32BufferAttribute(points, 3),
  );
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const object = new T.Mesh(geo, new T.MeshBasicMaterial());
  const fine = indices.slice();
  installGpKerbDetail(object, indices, rows, cols, ascending);
  const draw = (z: number, fov = 58, aspect = 1.6, ortho = false) => {
    const camera = ortho ? new T.OrthographicCamera() : new T.PerspectiveCamera(fov, aspect);
    camera.position.set(0, 1, z);
    camera.updateMatrixWorld();
    object.updateMatrixWorld();
    object.onBeforeRender(
      {} as T.WebGLRenderer,
      new T.Scene(),
      camera,
      geo,
      object.material,
      null as unknown as T.Group,
    );
    const { start, count } = geo.drawRange;
    return Array.from(geo.index!.array.slice(start, start + count));
  };
  return { fine, geo, object, draw };
}

describe('GP kerb detail at racing, photo and reflection distances', () => {
  it.each([true, false])(
    'preserves winding, paint vertices and every pit gap (ascending %s)',
    (ascending) => {
      const { fine, geo, draw } = grid(ascending, true);
      const indices = geo.index,
        uvSpace = geo.getAttribute('position'),
        normals = geo.getAttribute('normal');
      const near = draw(4),
        mid = draw(55),
        far = draw(240);
      expect(near).toEqual(fine);
      expect(mid.length).toBeLessThan(near.length * 0.42);
      expect(far.length).toBeLessThan(near.length * 0.2);
      for (const range of [mid, far]) {
        const cells = new Set<string>();
        for (let i = 0; i < range.length; i += 6) {
          const a = range[i],
            b = range[i + (ascending ? 1 : 2)],
            col = a % 7;
          for (let row = Math.floor(a / 7); row < Math.floor(b / 7); row++)
            cells.add(row + ',' + col);
          expect(range.slice(i, i + 6)).toEqual(
            ascending ? [a, b, a + 1, b, b + 1, a + 1] : [a, a + 1, b, b, a + 1, b + 1],
          );
        }
        const keep = new Set<string>();
        for (let i = 0; i < fine.length; i += 6)
          keep.add(Math.floor(fine[i] / 7) + ',' + (fine[i] % 7));
        expect(cells).toEqual(keep);
      }
      expect(geo.index).toBe(indices);
      expect(geo.getAttribute('position')).toBe(uvSpace);
      expect(geo.getAttribute('normal')).toBe(normals);
      expect(draw(4)).toEqual(fine);
    },
  );
  it('restores physical detail for telephoto, orthographic and transformed close views', () => {
    const { fine, object, draw } = grid(true, false);
    expect(draw(130).length).toBeLessThan(fine.length * 0.15);
    expect(draw(130, 9)).toEqual(fine);
    expect(draw(130, 58, 0.12)).toEqual(fine);
    expect(draw(130, 58, 1.6, true)).toEqual(fine);
    object.position.z = 120;
    expect(draw(130)).toEqual(fine);
  });
});
