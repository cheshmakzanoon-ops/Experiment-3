import * as T from 'three';
export interface SurveySamples {
  positions: Float32Array;
  colors: Float32Array;
  count: number;
  candidates: number;
}

/** Deterministic bounded sampling of ACTUAL rendered vertex positions, including
 * instance transforms. This is a diagnostic point-cloud view, never imported
 * or measured LiDAR. No randomness, simulation writes or duplicated mesh trees. */
export function sampleGeometry(
  roots: readonly T.Object3D[],
  centre: T.Vector3,
  limit = 60000,
  radius = 180,
): SurveySamples {
  const capacity = Number.isFinite(limit) ? Math.max(1, Math.min(80000, Math.floor(limit))) : 60000;
  radius = Number.isFinite(radius) ? Math.max(1, Math.min(500, radius)) : 180;
  const positions = new Float32Array(capacity * 3),
    colors = new Float32Array(capacity * 3);
  if (![centre.x, centre.y, centre.z].every(Number.isFinite))
    return {
      positions: positions.slice(0, 0),
      colors: colors.slice(0, 0),
      count: 0,
      candidates: 0,
    };
  const meshes: T.Mesh[] = [];
  for (const root of roots) {
    root.updateWorldMatrix(true, true);
    root.traverseVisible((node) => {
      if (
        node instanceof T.Mesh &&
        node.geometry.getAttribute('position') &&
        !node.userData.excludeSurvey
      )
        meshes.push(node);
    });
  }
  const point = new T.Vector3(),
    instance = new T.Matrix4(),
    world = new T.Matrix4(),
    color = new T.Color();
  let count = 0,
    candidates = 0;
  // Per-mesh quotas stop one huge ribbon or grandstand starving later objects.
  const quota = Math.max(1, Math.floor(capacity / Math.max(1, meshes.length)));
  for (const mesh of meshes) {
    const attribute = mesh.geometry.getAttribute('position');
    const instances =
      mesh instanceof T.InstancedMesh
        ? Math.max(0, Math.min(mesh.count, mesh.instanceMatrix.count))
        : 1;
    const total = attribute.count * instances;
    if (!total) continue;
    const step = Math.max(1, Math.ceil(total / (quota * 3)));
    let accepted = 0;
    for (let n = 0; n < total && accepted < quota && count < capacity; n += step) {
      candidates++;
      const index = n % attribute.count;
      if (mesh instanceof T.InstancedMesh) {
        mesh.getMatrixAt(Math.floor(n / attribute.count), instance);
        world.multiplyMatrices(mesh.matrixWorld, instance);
      } else world.copy(mesh.matrixWorld);
      point.fromBufferAttribute(attribute, index).applyMatrix4(world);
      if (
        ![point.x, point.y, point.z].every(Number.isFinite) ||
        point.distanceToSquared(centre) > radius * radius
      )
        continue;
      positions.set([point.x, point.y, point.z], count * 3);
      // False colour highlights height; it does not pretend to be scan intensity.
      color.setHSL(0.56 - Math.min(0.48, Math.max(0, point.y - centre.y + 2) / 80), 0.8, 0.62);
      colors.set([color.r, color.g, color.b], count * 3);
      count++;
      accepted++;
    }
  }
  return {
    positions: positions.slice(0, count * 3),
    colors: colors.slice(0, count * 3),
    count,
    candidates,
  };
}
export class GeometrySurvey {
  readonly scene = new T.Scene();
  readonly points = new T.Points(
    new T.BufferGeometry(),
    new T.PointsMaterial({ size: 0.065, vertexColors: true, sizeAttenuation: true }),
  );
  count = 0;
  candidates = 0;
  dirty = true;
  constructor() {
    this.scene.name = 'Geometry-derived point cloud · references 001 / 046 · NOT LiDAR';
    this.scene.background = new T.Color(0x07121c);
    this.scene.add(this.points);
  }
  rebuild(roots: readonly T.Object3D[], centre: T.Vector3) {
    const samples = sampleGeometry(roots, centre);
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.BufferAttribute(samples.positions, 3));
    geometry.setAttribute('color', new T.BufferAttribute(samples.colors, 3));
    geometry.computeBoundingSphere();
    this.points.geometry.dispose();
    this.points.geometry = geometry;
    this.count = samples.count;
    this.candidates = samples.candidates;
    this.dirty = false;
  }
  /** Full-size viewport + partial scissor preserves pixel alignment with the
   * normal camera. Every renderer state change is restored, including failure. */
  render(renderer: T.WebGLRenderer, camera: T.Camera, fraction: number) {
    const target = renderer.getRenderTarget(),
      viewport = renderer.getViewport(new T.Vector4()),
      scissor = renderer.getScissor(new T.Vector4()),
      test = renderer.getScissorTest(),
      autoClear = renderer.autoClear,
      color = renderer.getClearColor(new T.Color()),
      alpha = renderer.getClearAlpha(),
      size = renderer.getSize(new T.Vector2());
    try {
      renderer.setRenderTarget(null);
      renderer.setViewport(0, 0, size.x, size.y);
      renderer.setScissor(0, 0, Math.round(size.x * Math.max(0, Math.min(1, fraction))), size.y);
      renderer.setScissorTest(true);
      renderer.autoClear = true;
      renderer.render(this.scene, camera);
    } finally {
      renderer.setRenderTarget(target);
      renderer.setViewport(viewport);
      renderer.setScissor(scissor);
      renderer.setScissorTest(test);
      renderer.setClearColor(color, alpha);
      renderer.autoClear = autoClear;
    }
  }
  dispose() {
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}
