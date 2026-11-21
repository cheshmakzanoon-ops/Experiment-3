import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** The three lenses share one casting, spaced along its local X axis. */
export const MX_LAMP_OPTICS = Object.freeze({
  pitch: 0.37, radius: 0.128, radiance: 18,
  belowRoof: 3.36, focusHeight: 0.5, inwardAim: 0.22,
});

function combine(parts: T.BufferGeometry[]) {
  const result = mergeGeometries(parts)!;
  for (const part of parts) part.dispose();
  return result;
}

/** Front datum at the mouth of the three reflectors, with -Y along the beam.
 * Make one casting for the whole roof and place copies in its existing batches. */
export function mxFloodlightHead() {
  const body: T.BufferGeometry[] = [new T.BoxGeometry(1.16, 0.18, 0.49).translate(0, 0.18, 0)];
  const metal: T.BufferGeometry[] = [];
  const glass: T.BufferGeometry[] = [];
  // Cooling ribs stand clear of the solid casting, so the silhouette reads
  // from the floor. The plain centre is the driver's sealed service cover.
  for (const z of [-0.2, -0.14, -0.08, 0.08, 0.14, 0.2])
    body.push(new T.BoxGeometry(0.98, 0.06, 0.019).translate(0, 0.293, z));
  for (const side of [-1, 1])
    metal.push(
      new T.CylinderGeometry(0.058, 0.058, 0.105, 8)
        .rotateZ(Math.PI / 2)
        .translate(side * 0.598, 0.188, 0),
    );
  for (const x of [-MX_LAMP_OPTICS.pitch, 0, MX_LAMP_OPTICS.pitch]) {
    // Spun reflector narrows toward the emitter; the rolled lip catches
    // light at oblique angles while the recessed glass faces the floor.
    metal.push(
      new T.LatheGeometry(
        [
          new T.Vector2(0.082, 0.096),
          new T.Vector2(0.124, 0.043),
          new T.Vector2(0.155, 0.006),
          new T.Vector2(0.166, 0.004),
          new T.Vector2(0.174, 0.015),
          new T.Vector2(0.174, 0.034),
        ],
        16,
      ).translate(x, 0, 0),
    );
    glass.push(
      new T.LatheGeometry(
        [
          new T.Vector2(0, 0.023),
          new T.Vector2(0.072, 0.027),
          new T.Vector2(0.117, 0.039),
          new T.Vector2(MX_LAMP_OPTICS.radius, 0.046),
        ],
        16,
      ).translate(x, 0, 0),
    );
    body.push(new T.CylinderGeometry(0.167, 0.18, 0.094, 16, 1, true).translate(x, 0.072, 0));
  }
  return { body: combine(body), metal: combine(metal), glass: combine(glass) };
}

const DOWN = new T.Vector3(0, -1, 0);
const ONE = new T.Vector3(1, 1, 1);

/** A single optical axis for the physical lenses, yoke and visible dust shaft. */
export function mxFloodlightMount(origin: T.Vector3, target: T.Vector3) {
  const aim = new T.Quaternion().setFromUnitVectors(DOWN, target.clone().sub(origin).normalize());
  return new T.Matrix4().compose(origin, aim, ONE);
}
