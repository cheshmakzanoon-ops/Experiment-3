import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const drivingGloveMaterial = new T.MeshStandardMaterial({
  name: 'Cabin stitched driving leather',
  vertexColors: true,
  roughness: 0.78,
  metalness: 0,
});

/** A glove in polar wheel coordinates. +X points out from the hub and +Z
 * towards the dashboard. Curled fingers wrap around the rim cross-section.
 * Mirroring the thumb and finger register keeps left and right hands distinct. */
export function steeringGlove(side: -1 | 1) {
  const pieces: T.BufferGeometry[] = [];
  const fabric = 0x313640,
    grip = 0x20252a,
    pad = 0x505865,
    binding = 0x88909a;
  function add(geometry: T.BufferGeometry, color: number) {
    const c = new T.Color(color);
    const count = geometry.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) c.toArray(colors, i * 3);
    geometry.setAttribute('color', new T.BufferAttribute(colors, 3));
    pieces.push(geometry);
  }
  function padAt(
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    color: number,
  ) {
    add(new T.SphereGeometry(1, 12, 8).scale(sx, sy, sz).translate(x, side * y, z), color);
  }
  padAt(0.32, 0, -0.48, 0.68, 1, 0.45, fabric);
  padAt(0.39, -0.09, -0.76, 0.5, 0.78, 0.22, pad);
  // The open cuff narrows into the moving sleeve. An open, raked cuff
  // prevents a solid cylinder cap facing the driver's eye and hiding the palm.
  const cuff = new T.CylinderGeometry(0.63, 0.55, 0.62, 16, 1, true)
    .rotateX(Math.PI * 0.35)
    .scale(0.88, 1.04, 1)
    .translate(0.05, -0.33 * side, -0.84);
  add(cuff, fabric);
  for (const y of [-0.46, -0.07, 0.31]) {
    const path = new T.CatmullRomCurve3([
      new T.Vector3(-0.08, side * y, -0.88),
      new T.Vector3(0.18, side * (y + 0.05), -0.98),
      new T.Vector3(0.43, side * (y + 0.1), -0.96),
      new T.Vector3(0.66, side * (y + 0.13), -0.87),
    ]);
    add(new T.TubeGeometry(path, 6, 0.034, 5, false), binding);
  }
  for (let i = 0; i < 4; i++) {
    const y = (0.65 - i * 0.405) * side;
    const size = i === 3 ? 0.165 : 0.205;
    const end = i === 3 ? 1.8 : 2.07;
    const points = [];
    for (let j = 0; j <= 6; j++) {
      const phi = -0.91 + ((end + 0.91) * j) / 6;
      points.push(new T.Vector3(0.61 * Math.cos(phi), y, 0.57 * Math.sin(phi)));
    }
    const path = new T.CatmullRomCurve3(points);
    add(new T.TubeGeometry(path, 9, size, 7, false), grip);
    const tip = points[points.length - 1];
    padAt(tip.x, y * side, tip.z, size, size, size, grip);
    padAt(0.55, y * side, -0.34, 0.28, size * 1.02, 0.23, pad);
  }
  const thumb = new T.CatmullRomCurve3([
    new T.Vector3(0.19, 0.54 * side, -0.62),
    new T.Vector3(-0.25, 0.74 * side, -0.54),
    new T.Vector3(-0.57, 0.78 * side, -0.25),
    new T.Vector3(-0.61, 0.64 * side, 0.02),
  ]);
  add(new T.TubeGeometry(thumb, 8, 0.245, 8, false), fabric);
  padAt(-0.61, 0.64, 0.02, 0.25, 0.235, 0.24, grip);
  const geometry = mergeGeometries(pieces)!;
  for (const piece of pieces) piece.dispose();
  geometry.name = 'Palm, bound cuff, wrapped fingers and thumb';
  return geometry;
}
