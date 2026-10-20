import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Original 340 mm solid carbon assembly, aligned to the wheel's X axle.
 * REF003/060/086 show the separate carrier, friction band and stationary
 * caliper. The 8 mm band thickness follows Brembo's 2024 MotoGP technical
 * release; carrier/web dimensions are authored, not measured from photographs.
 * This is presentation geometry: the existing brake/thermal simulation owns
 * braking torque and temperature. Non-GP machines retain their original discs.
 */
export const GP_FRONT_DISC = Object.freeze({
  outerRadius: 0.17,
  innerRadius: 0.115,
  thickness: 0.008,
  sideOffset: 0.066,
  carrierOuterRadius: 0.119,
  carrierThickness: 0.006,
  bobbinRadius: 0.113,
  bobbins: 6,
});

interface RotorMaterials {
  disc: T.Material;
  aluminium: T.Material;
  steel: T.Material;
}

/** True open annulus. Carbon friction faces have no road-bike drilled holes. */
function annulus(outer: number, inner: number, depth: number, curves: number) {
  const outline = new T.Shape();
  outline.absarc(0, 0, outer, 0, Math.PI * 2, false);
  const bore = new T.Path();
  bore.absarc(0, 0, inner, 0, Math.PI * 2, true);
  outline.holes.push(bore);
  const geometry = new T.ExtrudeGeometry(outline, {
    depth,
    steps: 1,
    bevelEnabled: false,
    curveSegments: curves,
  });
  geometry.translate(0, 0, -depth / 2);
  geometry.rotateY(Math.PI / 2);
  return geometry;
}

/** One connected six-web carrier with open windows and a real axle bore. */
function carrier(curves: number) {
  const outline = new T.Shape();
  outline.absarc(0, 0, GP_FRONT_DISC.carrierOuterRadius, 0, Math.PI * 2, false);
  const axle = new T.Path();
  axle.absarc(0, 0, 0.028, 0, Math.PI * 2, true);
  outline.holes.push(axle);
  const pitch = (Math.PI * 2) / GP_FRONT_DISC.bobbins;
  for (let i = 0; i < GP_FRONT_DISC.bobbins; i++) {
    // Extrusion XY maps to wheel YZ. Put each web on a bobbin's radial axis.
    const a = i * pitch + 0.085;
    const b = (i + 1) * pitch - 0.085;
    const window = new T.Path();
    window.moveTo(Math.cos(a) * 0.049, Math.sin(a) * 0.049);
    const steps = curves >= 12 ? 3 : 2;
    for (let k = 1; k <= steps; k++) {
      const t = a + ((b - a) * k) / steps;
      window.lineTo(Math.cos(t) * 0.049, Math.sin(t) * 0.049);
    }
    for (let k = 0; k <= steps; k++) {
      const t = b - ((b - a) * k) / steps;
      window.lineTo(Math.cos(t) * 0.104, Math.sin(t) * 0.104);
    }
    window.closePath();
    outline.holes.push(window);
  }
  const geometry = new T.ExtrudeGeometry(outline, {
    depth: GP_FRONT_DISC.carrierThickness,
    steps: 1,
    bevelEnabled: true,
    bevelSize: 0.0005,
    bevelThickness: 0.0005,
    bevelSegments: 1,
    curveSegments: curves,
  });
  geometry.translate(0, 0, -GP_FRONT_DISC.carrierThickness / 2);
  geometry.rotateY(Math.PI / 2);
  return geometry;
}

/** Direct meshes can join the existing wheel/material batches. No new
 * material, texture, per-frame update, or independent animation clock. */
export function gpBrakeRotor(
  detail: 'high' | 'mid' | 'far',
  materials: RotorMaterials,
): T.Mesh[] {
  const curves = detail === 'high' ? 32 : detail === 'mid' ? 16 : 8;
  const mesh = (geometry: T.BufferGeometry, material: T.Material, name: string) => {
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const result = new T.Mesh(geometry, material);
    result.name = name;
    result.castShadow = result.receiveShadow = true;
    return result;
  };
  const meshes = [
    mesh(
      annulus(
        GP_FRONT_DISC.outerRadius,
        GP_FRONT_DISC.innerRadius,
        GP_FRONT_DISC.thickness,
        curves,
      ),
      materials.disc,
      'GP 340 mm carbon friction band (8 mm)',
    ),
  ];
  if (detail === 'far') return meshes;
  meshes.push(
    mesh(
      carrier(detail === 'high' ? 12 : 6),
      materials.aluminium,
      'GP open six-web disc carrier',
    ),
  );
  const pieces: T.BufferGeometry[] = [];
  for (let i = 0; i < GP_FRONT_DISC.bobbins; i++) {
    // Match the extrusion's rotation: original XY becomes (-Z,Y).
    const a = (i / GP_FRONT_DISC.bobbins) * Math.PI * 2;
    const y = Math.sin(a),
      z = -Math.cos(a);
    const bobbin = annulus(0.008, 0.0032, 0.010, detail === 'high' ? 6 : 4);
    bobbin.translate(0, y * GP_FRONT_DISC.bobbinRadius, z * GP_FRONT_DISC.bobbinRadius);
    pieces.push(bobbin);
    const bolt = new T.CylinderGeometry(0.0038, 0.0038, 0.009, 6);
    bolt.rotateZ(Math.PI / 2);
    bolt.translate(0, y * 0.037, z * 0.037);
    pieces.push(bolt.toNonIndexed());
    bolt.dispose();
  }
  const hardware = mergeGeometries(pieces, false);
  for (const piece of pieces) piece.dispose();
  if (!hardware) throw new Error('Could not assemble GP rotor floating hardware');
  meshes.push(mesh(hardware, materials.steel, 'GP floating bobbins and hub fixings'));
  return meshes;
}
