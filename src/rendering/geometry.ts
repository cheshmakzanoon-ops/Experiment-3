import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
/** Closed elliptical sections along +Z. Original, smooth bodywork rather than box primitives. */
export function loft(sections: readonly (readonly [number, number, number, number])[], sides = 32) {
  const p: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  for (let i = 0; i < sections.length; i++) {
    const [z, y, w, h] = sections[i];
    for (let j = 0; j <= sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      p.push(Math.cos(a) * w, y + Math.sin(a) * h, z);
      uv.push(j / sides, i / (sections.length - 1));
    }
  }
  for (let i = 0; i < sections.length - 1; i++)
    for (let j = 0; j < sides; j++) {
      const a = i * (sides + 1) + j,
        b = a + sides + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}
export function mesh(parent: T.Object3D, g: T.BufferGeometry, m: T.Material, x = 0, y = 0, z = 0) {
  const o = new T.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  o.receiveShadow = true;
  parent.add(o);
  return o;
}
export function box(
  parent: T.Object3D,
  m: T.Material,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
) {
  return mesh(parent, new T.BoxGeometry(w, h, d), m, x, y, z);
}
export function rod(parent: T.Object3D, m: T.Material, a: T.Vector3, b: T.Vector3, r = 0.016) {
  const o = mesh(parent, new T.CylinderGeometry(r, r, a.distanceTo(b), 10), m);
  o.position.copy(a).add(b).multiplyScalar(0.5);
  o.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return o;
}
export function tube(parent: T.Object3D, m: T.Material, points: number[][], r = 0.025) {
  return mesh(
    parent,
    new T.TubeGeometry(
      new T.CatmullRomCurve3(points.map((p) => new T.Vector3(...(p as [number, number, number])))),
      48,
      r,
      10,
      false,
    ),
    m,
  );
}
/** Merge only a deliberately static group; preserve every articulated part outside it. */
export function mergeStatic(group: T.Group) {
  group.updateMatrixWorld(true);
  const inverse = group.matrixWorld.clone().invert();
  const groups = new Map<T.Material, T.BufferGeometry[]>();
  group.traverse((o) => {
    if (o instanceof T.Mesh && !Array.isArray(o.material)) {
      const g = o.geometry.clone().applyMatrix4(inverse.clone().multiply(o.matrixWorld));
      const list = groups.get(o.material);
      if (list) list.push(g);
      else groups.set(o.material, [g]);
    }
  });
  const original = [...group.children];
  group.clear();
  for (const [m, geometries] of groups) {
    const merged = mergeGeometries(
      geometries.map((g) => (g.index ? g.toNonIndexed() : g)),
      false,
    );
    if (merged) mesh(group, merged, m);
    for (const g of geometries) g.dispose();
  }
  for (const o of original)
    o.traverse((n) => {
      if (n instanceof T.Mesh) n.geometry.dispose();
    });
}
export function canvasTexture(
  width: number,
  height: number,
  draw: (c: CanvasRenderingContext2D) => void,
) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const c = canvas.getContext('2d');
  if (!c) throw new Error('Canvas 2D unavailable');
  draw(c);
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}
export function label(text: string, bg = '#171d21', fg = '#f5eee2', w = 512, h = 128) {
  return canvasTexture(w, h, (c) => {
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);
    c.fillStyle = fg;
    c.font = `700 ${h * 0.52}px Arial`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(text, w / 2, h / 2, w * 0.94);
  });
}

/** Batch static scene meshes while retaining instances and explicitly articulated roots. */
export function batchScene(root: T.Group, preserve: Set<T.Object3D>) {
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert(),
    groups = new Map<T.Material, T.BufferGeometry[]>(),
    remove: T.Mesh[] = [];
  root.traverse((o) => {
    if (!(o instanceof T.Mesh) || o instanceof T.InstancedMesh || Array.isArray(o.material)) return;
    for (let p: T.Object3D | null = o; p; p = p.parent) if (preserve.has(p)) return;
    const geometry = o.geometry.clone().applyMatrix4(inverse.clone().multiply(o.matrixWorld));
    const list = groups.get(o.material);
    if (list) list.push(geometry);
    else groups.set(o.material, [geometry]);
    remove.push(o);
  });
  for (const o of remove) {
    o.removeFromParent();
    o.geometry.dispose();
  }
  for (const [material, geometries] of groups) {
    const normalized = geometries.map((g) => {
      const out = g.index ? g.toNonIndexed() : g;
      for (const key of Object.keys(out.attributes))
        if (!['position', 'normal', 'uv'].includes(key)) out.deleteAttribute(key);
      return out;
    });
    const merged = mergeGeometries(normalized, false);
    if (merged) mesh(root, merged, material);
    for (const g of normalized) g.dispose();
    for (const g of geometries) g.dispose();
  }
}
