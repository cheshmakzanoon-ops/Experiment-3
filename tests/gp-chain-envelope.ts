import * as T from 'three';
import { ChainLoop } from '../src/rendering/chain-geometry.ts';

/** Check actual closed structure against a continuous conservative chain
 * envelope: boxes join adjacent real path samples, with 16 mm axial and
 * 6 mm radial half extents plus 1 mm clearance. A nearest outward ray
 * exit also rejects a chain centre contained entirely inside a solid. */
export function measureChainEnvelope(root: T.Object3D, arm: number) {
  root.updateMatrixWorld(true);
  const surfaces: {
    bounds: T.Box3;
    faces: { triangle: T.Triangle; bounds: T.Box3; normalX: number }[];
  }[] = [];
  const normal = new T.Vector3();
  root.traverse((object) => {
    if (!(object instanceof T.Mesh)) return;
    const position = object.geometry.getAttribute('position'),
      index = object.geometry.index,
      vertices = Array.from({ length: position.count }, (_, i) =>
        new T.Vector3().fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld),
      ),
      faces = [];
    for (let i = 0; i < (index?.count ?? position.count); i += 3) {
      const a = vertices[index ? index.getX(i) : i],
        b = vertices[index ? index.getX(i + 1) : i + 1],
        c = vertices[index ? index.getX(i + 2) : i + 2],
        triangle = new T.Triangle(a, b, c);
      faces.push({
        triangle,
        bounds: new T.Box3().setFromPoints([a, b, c]),
        normalX: triangle.getNormal(normal).x,
      });
    }
    surfaces.push({ bounds: new T.Box3().setFromPoints(vertices), faces });
  });
  const loop = new ChainLoop(
      arm,
      0.015875 / (2 * Math.sin(Math.PI / 42)),
      0.015875 / (2 * Math.sin(Math.PI / 18)),
      0.115,
    ),
    point = new T.Vector3(),
    next = new T.Vector3(),
    hit = new T.Vector3(),
    ray = new T.Ray(point, new T.Vector3(1, 0, 0)),
    envelope = new T.Box3(),
    halfExtent = new T.Vector3(0.017, 0.007, 0.007);
  let intersections = 0,
    insideSamples = 0,
    testedTriangles = 0;
  for (let i = 0; i < 1600; i++) {
    loop.sample((i / 1600) * loop.length, point);
    loop.sample(((i + 1) / 1600) * loop.length, next);
    envelope.min.copy(point).min(next).sub(halfExtent);
    envelope.max.copy(point).max(next).add(halfExtent);
    for (const surface of surfaces) {
      const mayContain = surface.bounds.containsPoint(point);
      if (!mayContain && !surface.bounds.intersectsBox(envelope)) continue;
      let exitDistance = Infinity,
        exitNormalX = 0;
      for (const face of surface.faces) {
        if (face.bounds.intersectsBox(envelope)) {
          testedTriangles++;
          if (envelope.intersectsTriangle(face.triangle)) intersections++;
        }
        if (
          mayContain &&
          face.bounds.max.x >= point.x &&
          face.bounds.min.y <= point.y &&
          face.bounds.max.y >= point.y &&
          face.bounds.min.z <= point.z &&
          face.bounds.max.z >= point.z &&
          ray.intersectTriangle(face.triangle.a, face.triangle.b, face.triangle.c, false, hit)
        ) {
          const distance = hit.x - point.x;
          if (distance < exitDistance) {
            exitDistance = distance;
            exitNormalX = face.normalX;
          }
        }
      }
      if (exitNormalX > 1e-6) insideSamples++;
    }
  }
  return { intersections, insideSamples, testedTriangles, samples: 1600, meshes: surfaces.length };
}
