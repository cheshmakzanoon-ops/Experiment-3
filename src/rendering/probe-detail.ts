import * as T from 'three';

/** Static scenery the local reflection probe may leave out of one capture
 * because, seen from the probe, it cannot cover a single cube-face texel.
 * Every test is an upper bound on the drawable's narrowest projected size,
 * so anything that could fill a texel is always drawn. */
export interface ProbeDetail {
  readonly object: T.Object3D;
  /** Upper bound (radians) of the narrowest projected dimension from `eye`. */
  angularSize(eye: T.Vector3): number;
}

/** Angle subtended by one texel at the centre of a 90-degree cube face. */
export function cubeTexelAngle(faceSize: number) {
  if (!Number.isInteger(faceSize) || faceSize < 1) throw new Error('Invalid cube face size');
  return Math.PI / 2 / faceSize;
}

/** A compact drawable: the angle its world bounding sphere subtends. */
export function sphereDetail(object: T.Mesh | T.InstancedMesh): ProbeDetail {
  object.updateWorldMatrix(true, false);
  let local: T.Sphere | null;
  if (object instanceof T.InstancedMesh) {
    if (!object.boundingSphere) object.computeBoundingSphere();
    local = object.boundingSphere;
  } else {
    if (!object.geometry.boundingSphere) object.geometry.computeBoundingSphere();
    local = object.geometry.boundingSphere;
  }
  if (!local || !Number.isFinite(local.radius)) throw new Error('Probe detail without bounds');
  const sphere = local.clone().applyMatrix4(object.matrixWorld);
  return {
    object,
    angularSize: (eye) => {
      const d = eye.distanceTo(sphere.center);
      return d <= sphere.radius ? Infinity : 2 * Math.asin(sphere.radius / d);
    },
  };
}

const segment = new T.Line3(),
  closest = new T.Vector3();
/** A strip of at most `width` metres along a centreline (painted lines,
 * kerbs). Seen end-on, along or across, its narrowest projected dimension is
 * at most width / distance. `tolerance` covers the chords between the
 * centreline samples. */
export function stripDetail(
  object: T.Object3D,
  centreline: readonly T.Vector3[],
  width: number,
  tolerance = 0.25,
): ProbeDetail {
  if (centreline.length < 2 || !(width > 0) || !(tolerance >= 0))
    throw new Error('Invalid strip detail');
  const points = centreline.map((p) => p.clone());
  return {
    object,
    angularSize: (eye) => {
      let nearest = Infinity;
      for (let i = 1; i < points.length; i++) {
        segment.set(points[i - 1], points[i]).closestPointToPoint(eye, true, closest);
        nearest = Math.min(nearest, closest.distanceTo(eye));
      }
      const d = nearest - width / 2 - tolerance;
      return d <= 0 ? Infinity : width / d;
    },
  };
}

/** Instanced thin vertical parts (tree trunks and their limbs). Each
 * instance's thickest cross-section and axis come from its matrix and the
 * shared geometry; the widest-looking instance decides. */
export function trunkDetail(object: T.InstancedMesh): ProbeDetail {
  const position = object.geometry.getAttribute('position');
  if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
  const box = object.geometry.boundingBox!,
    height = box.max.y - box.min.y;
  // The trunk base is the widest section; every limb is thinner.
  let radius = 0;
  for (let i = 0; i < position.count; i++)
    if (position.getY(i) <= box.min.y + height * 0.05)
      radius = Math.max(radius, Math.hypot(position.getX(i), position.getZ(i)));
  // Limbs reach out from the axis: distance is measured to a cylinder
  // enclosing the whole part, so no limb is ever nearer than assumed.
  const reach = Math.max(
    Math.abs(box.min.x),
    Math.abs(box.max.x),
    Math.abs(box.min.z),
    Math.abs(box.max.z),
  );
  object.updateWorldMatrix(true, false);
  // Every allocated instance: quality settings may change the drawn count.
  const count = object.instanceMatrix.count,
    axes = new Float64Array(count * 8),
    m = new T.Matrix4(),
    base = new T.Vector3(),
    top = new T.Vector3(),
    scale = new T.Vector3(),
    q = new T.Quaternion();
  for (let i = 0; i < count; i++) {
    object.getMatrixAt(i, m);
    m.premultiply(object.matrixWorld);
    m.decompose(base, q, scale);
    base.set(0, box.min.y, 0).applyMatrix4(m);
    top.set(0, box.max.y, 0).applyMatrix4(m);
    const horizontal = Math.max(Math.abs(scale.x), Math.abs(scale.z));
    axes.set(
      [base.x, base.y, base.z, top.x, top.y, top.z, 2 * radius * horizontal, reach * horizontal],
      i * 8,
    );
  }
  const a = new T.Vector3(),
    b = new T.Vector3();
  return {
    object,
    angularSize: (eye) => {
      let widest = 0;
      for (let i = 0; i < count; i++) {
        const o = i * 8;
        segment
          .set(
            a.set(axes[o], axes[o + 1], axes[o + 2]),
            b.set(axes[o + 3], axes[o + 4], axes[o + 5]),
          )
          .closestPointToPoint(eye, true, closest);
        const d = closest.distanceTo(eye) - axes[o + 7];
        if (d <= 0) return Infinity;
        widest = Math.max(widest, axes[o + 6] / d);
      }
      return widest;
    },
  };
}

/** Hide (for one capture) every visible detail that cannot cover one texel
 * of a `faceSize` cube face from `eye`. Returns the hidden objects; the caller
 * restores them. */
export function cullProbeDetail(
  details: readonly ProbeDetail[],
  eye: T.Vector3,
  faceSize: number,
  hidden: T.Object3D[],
) {
  const texel = cubeTexelAngle(faceSize);
  for (const detail of details)
    if (detail.object.visible && detail.angularSize(eye) < texel) {
      detail.object.visible = false;
      hidden.push(detail.object);
    }
  return hidden;
}
