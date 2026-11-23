import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Local X is the axle. Survey the bare inner rim, clear of the disc, tyre
 * and chain. The valve points to the service side; adhesive wheel weights
 * follow the opposite barrel arc. All distances are metres. */
export function gpWheelHardware(rim: number, halfWidth: number, front: boolean) {
  const barrel = rim - 0.026,
    side = front ? 1 : -1;
  const pieces: T.BufferGeometry[] = [];
  const angle = front ? 0.56 : -0.68;
  const foot = new T.CylinderGeometry(0.0083, 0.0083, 0.004, 6, 1, false).translate(
    0,
    barrel - 0.0015,
    0,
  );
  const elbow = new T.TubeGeometry(
    new T.CubicBezierCurve3(
      new T.Vector3(0, barrel - 0.002, 0),
      new T.Vector3(0, barrel - 0.018, 0),
      new T.Vector3(side * 0.01, barrel - 0.017, 0),
      new T.Vector3(side * 0.019, barrel - 0.017, 0),
    ),
    4,
    0.0038,
    6,
    false,
  );
  // The hollow stem is covered by a closed hexagonal alloy dust cap.
  const cap = new T.CylinderGeometry(0.005, 0.0061, 0.009, 6, 1, false)
    .rotateZ((-side * Math.PI) / 2)
    .translate(side * 0.021, barrel - 0.017, 0);
  for (const geometry of [foot, elbow, cap]) pieces.push(geometry.rotateX(angle));
  const blocks = front ? 2 : 3,
    width = 0.01,
    arc = 0.061;
  const belt = side * halfWidth * 0.17;
  for (let i = 0; i < blocks; i++) {
    const centre = angle + Math.PI + (i - (blocks - 1) / 2) * (arc + 0.009);
    const positions: number[] = [],
      uv: number[] = [],
      index: number[] = [];
    // Trapezoidal section with chamfered visible shoulders and a buried back.
    const cross = [
      [belt - width * 0.5, barrel + 0.00025],
      [belt - width * 0.5, barrel - 0.0019],
      [belt - width * 0.34, barrel - 0.0032],
      [belt + width * 0.34, barrel - 0.0032],
      [belt + width * 0.5, barrel - 0.0019],
      [belt + width * 0.5, barrel + 0.00025],
    ];
    for (const end of [-1, 1]) {
      const a = centre + (end * arc) / 2;
      for (const [x, r] of cross) {
        positions.push(x, r * Math.cos(a), r * Math.sin(a));
        uv.push(x / width, end * 0.5 + 0.5);
      }
    }
    for (let j = 0; j < cross.length - 1; j++) index.push(j, j + 1, j + 6, j + 6, j + 1, j + 7);
    for (let j = 1; j < cross.length - 1; j++) index.push(0, j + 1, j, 6, 6 + j, 7 + j);
    const block = new T.BufferGeometry();
    block.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    block.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    block.setIndex(index);
    block.computeVertexNormals();
    pieces.push(block);
  }
  const geometry = mergeGeometries(pieces);
  for (const piece of pieces) piece.dispose();
  if (!geometry) throw new Error('Could not assemble GP wheel service hardware');
  geometry.name = 'GP forged wheel valve and balance weights';
  geometry.computeBoundingBox();
  return geometry;
}
