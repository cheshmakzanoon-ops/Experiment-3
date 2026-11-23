import * as T from 'three';
import { sculptedLoft, type BodySection } from './bodywork.ts';
import { bodySurface, ENGINE_SECTIONS } from './car-surfaces.ts';
import { mesh } from './geometry.ts';

type Detail = 'high' | 'mid' | 'far';
/** Centre of the forward optical window, in APX-01 chassis coordinates. */
export const POD_EYE = Object.freeze({ y: 0.87, z: -0.78 });

/** Manufacture the roll-hoop camera in the same material batches as the body.
 * Stations run across the car. A narrower section at each end rounds the silhouette. */
const HOUSING: BodySection[] = [
  [-0.14, -0.003, 0.025, 0.012],
  [-0.121, 0, 0.047, 0.024],
  [-0.068, 0.001, 0.052, 0.027],
  [0, 0.002, 0.061, 0.032],
  [0.068, 0.001, 0.052, 0.027],
  [0.121, 0, 0.047, 0.024],
  [0.14, -0.003, 0.025, 0.012],
];
export function mountFormulaCameraPod(
  parent: T.Group,
  paint: T.Material,
  carbon: T.Material,
  dark: T.Material,
  detail: Detail,
) {
  const z = -0.645;
  const crown = bodySurface(ENGINE_SECTIONS, z, 0.5).y;
  const foot = new T.Vector3(0, crown - 0.033, z);
  const head = new T.Vector3(0, POD_EYE.y - 0.013, POD_EYE.z - 0.066);
  const axis = head.clone().sub(foot);
  const pedestal = new T.CylinderGeometry(0.037, 0.052, axis.length(), detail === 'far' ? 6 : 12);
  pedestal.scale(0.49, 1, 1);
  pedestal.applyQuaternion(
    new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), axis.normalize()),
  );
  pedestal.translate((foot.x + head.x) / 2, (foot.y + head.y) / 2, (foot.z + head.z) / 2);
  mesh(parent, pedestal, carbon);
  const shell = sculptedLoft(HOUSING, 0, 0.38, [], detail === 'high' ? 'mid' : 'far');
  shell.rotateY(Math.PI / 2);
  mesh(parent, shell, paint, 0, POD_EYE.y, POD_EYE.z - 0.064);
  if (detail === 'far') return;
  // Both ends carry a real aperture. The forward glass sits just behind the eye.
  for (const side of [-1, 1]) {
    const zFace = POD_EYE.z - 0.064 + side * 0.058;
    const port = new T.CylinderGeometry(0.017, 0.021, 0.01, detail === 'high' ? 20 : 10);
    port.rotateX((side * Math.PI) / 2);
    mesh(parent, port, carbon, 0, POD_EYE.y, zFace);
    const glass = new T.SphereGeometry(0.013, 12, 6).scale(1, 1, 0.18);
    mesh(parent, glass, dark, 0, POD_EYE.y, zFace + side * 0.004);
  }
}
