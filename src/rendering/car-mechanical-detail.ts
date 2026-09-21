import { helmetShell, helmetPatch, helmetPoint } from './helmet-shell.ts';
import * as T from 'three';
import { sculptedLoft } from './bodywork.ts';
import { mesh, mergeStatic, rod } from './geometry.ts';

export interface MechanicalMaterials {
  carbon: T.Material;
  dark: T.Material;
  metal: T.Material;
  paint: T.Material;
}

/** Rigid parts are attached to their actual carrier: the brake duct/upright
 * steer and heave, while the centre lock rotates and leaves with the wheel.
 * None is parented to the deformable tyre, and none changes vehicle forces. */
export function addWheelMechanicalDetail(
  carrier: T.Group,
  rotatingWheel: T.Group,
  side: number,
  halfWidth: number,
  m: MechanicalMaterials,
) {
  if ((side !== -1 && side !== 1) || !Number.isFinite(halfWidth) || halfWidth <= 0)
    throw new Error('Invalid wheel-detail dimensions');
  const upright = new T.Group();
  upright.name = 'Steering upright and brake cooling duct';
  const x = -side * (halfWidth + 0.014);
  rod(upright, m.metal, new T.Vector3(x, -0.077, -0.005), new T.Vector3(x, 0.069, 0.014), 0.019);
  for (const y of [-0.077, 0.069]) {
    mesh(upright, new T.SphereGeometry(0.022, 12, 8), m.dark, x, y, y < 0 ? -0.005 : 0.014);
    const pin = mesh(upright, new T.CylinderGeometry(0.008, 0.008, 0.048, 8), m.metal, x, y, 0.006);
    pin.rotation.z = Math.PI / 2;
  }
  const duct = mesh(upright, new T.TorusGeometry(0.047, 0.008, 8, 20), m.carbon, x, 0.015, 0.137);
  duct.scale.set(0.48, 1, 0.6);
  const mouth = mesh(upright, new T.CircleGeometry(0.044, 20), m.dark, x, 0.015, 0.132);
  mouth.scale.x = 0.48;
  rod(upright, m.carbon, new T.Vector3(x, 0.01, 0.105), new T.Vector3(x, -0.011, 0.012), 0.018);
  mergeStatic(upright);
  carrier.add(upright);

  const lock = new T.Group();
  lock.name = 'Rotating centre lock';
  const nut = mesh(
    lock,
    new T.CylinderGeometry(0.029, 0.031, 0.02, 6),
    m.metal,
    side * (halfWidth + 0.029),
    0,
    0,
  );
  nut.rotation.z = Math.PI / 2;
  const bore = mesh(lock, new T.CircleGeometry(0.013, 16), m.dark, side * (halfWidth + 0.04), 0, 0);
  bore.rotation.y = (side * Math.PI) / 2;
  mergeStatic(lock);
  rotatingWheel.add(lock);
  return { upright, lock };
}

/** Original tail hardware fits inside the existing car silhouette. Exhaust
 * colour is an authored material, not an invented temperature/engine state. */
export function addTailMechanicalDetail(parent: T.Group, m: MechanicalMaterials) {
  const tail = new T.Group();
  tail.name = 'Rear crash structure and exhaust outlet';
  mesh(
    tail,
    sculptedLoft(
      [
        [-2.27, -0.205, 0.047, 0.039],
        [-2.1, -0.195, 0.074, 0.052],
        [-1.83, -0.18, 0.095, 0.065],
      ],
      0.6,
      0.6,
    ),
    m.carbon,
  );
  const outlet = mesh(
    tail,
    new T.CylinderGeometry(0.038, 0.035, 0.15, 24, 1, true),
    m.metal,
    0,
    -0.015,
    -2.117,
  );
  outlet.rotation.x = Math.PI / 2;
  mesh(tail, new T.TorusGeometry(0.037, 0.003, 6, 24), m.metal, 0, -0.015, -2.193);
  const interior = mesh(tail, new T.CircleGeometry(0.034, 24), m.dark, 0, -0.015, -2.1);
  interior.rotation.y = Math.PI;
  mergeStatic(tail);
  parent.add(tail);
  return tail;
}

/** The neck pivot is independent from the shell centre, so load-induced nods
 * rotate about the neck instead of swinging the head around the car origin. */
export function buildHelmet(parent: T.Group, m: MechanicalMaterials) {
  parent.name = 'Original helmet with neck-centred articulation';
  parent.position.set(0, 0.17, -0.4);
  const shellGeometry = helmetShell();
  const helmetPaint = m.paint.clone();
  helmetPaint.onBeforeCompile = (shader) => {
    shader.vertexShader =
      'varying vec3 vHelmetLocal;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvHelmetLocal = position - vec3(0.0,0.12,0.02);',
      );
    shader.fragmentShader =
      'varying vec3 vHelmetLocal;\n' +
      shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
      float edge = abs(vHelmetLocal.x);
      float aa = max(fwidth(edge), 0.00012);
      float crown = smoothstep(0.008, 0.025, vHelmetLocal.y) + step(vHelmetLocal.z, 0.0);
      float stripe = (1.0 - smoothstep(0.027-aa,0.027+aa,edge)) * min(crown,1.0);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.014,0.045,0.057), stripe);
      vec2 ventUV = vec2((abs(vHelmetLocal.x)-0.032)/0.014, (vHelmetLocal.y+0.057)/0.0032);
      float vent = (1.0-smoothstep(0.85,1.10,length(ventUV))) * step(0.085,vHelmetLocal.z);
      diffuseColor.rgb = mix(diffuseColor.rgb,vec3(0.007,0.011,0.014),vent);
      `,
      );
  };
  helmetPaint.customProgramCacheKey = () => 'original-helmet-crown-v2';
  mesh(parent, shellGeometry, helmetPaint, 0, 0.12, 0.02);
  const visorMaterial = new T.MeshPhysicalMaterial({
    name: 'Original smoked visor',
    color: 0x253b45,
    metalness: 0.35,
    roughness: 0.13,
    clearcoat: 1,
    clearcoatRoughness: 0.07,
  });
  // Raised brow and a tapered visor follow the same shell rather than a
  // circular band. Gaskets remain separated by only millimetres at the cheeks.
  mesh(
    parent,
    helmetPatch(-0.033, 0.043, 0.095, Math.PI - 0.095, 0.003),
    visorMaterial,
    0,
    0.12,
    0.02,
  );
  for (const y of [-0.033, 0.043]) {
    const points = Array.from({ length: 33 }, (_, j) =>
      helmetPoint(y, 0.095 + (j / 32) * (Math.PI - 0.19), 0.0038).add(new T.Vector3(0, 0.12, 0.02)),
    );
    mesh(parent, new T.TubeGeometry(new T.CatmullRomCurve3(points), 32, 0.0018, 6, false), m.dark);
  }
  mesh(parent, helmetPatch(0.046, 0.053, 0.1, Math.PI - 0.1, 0.0012, 2, 32), m.dark, 0, 0.12, 0.02);
  for (const side of [-1, 1]) {
    const hinge = mesh(
      parent,
      new T.CylinderGeometry(0.011, 0.011, 0.006, 12),
      m.metal,
      side * 0.142,
      0.124,
      0.025,
    );
    hinge.rotation.z = Math.PI / 2;
  }
  const seal = mesh(parent, new T.TorusGeometry(0.073, 0.012, 8, 24), m.dark, 0, 0.005, 0.006);
  seal.rotation.x = Math.PI / 2;
  mergeStatic(parent);
}

/** Remove only the terminal cap from a closed loft. The UV seam and all skin
 * vertices/normals remain unchanged; a separately modelled duct closes the inlet. */
export function openFrontCap(geometry: T.BufferGeometry) {
  const position = geometry.getAttribute('position'),
    index = geometry.getIndex();
  if (!position || !index) throw new Error('Expected indexed sidepod geometry');
  geometry.computeBoundingBox();
  const front = geometry.boundingBox!.max.z,
    next: number[] = [];
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i),
      b = index.getX(i + 1),
      c = index.getX(i + 2);
    if (
      Math.abs(position.getZ(a) - front) < 1e-6 &&
      Math.abs(position.getZ(b) - front) < 1e-6 &&
      Math.abs(position.getZ(c) - front) < 1e-6
    )
      continue;
    next.push(a, b, c);
  }
  geometry.setIndex(next);
  return geometry;
}

export function addSidepodDuct(parent: T.Group, side: number, m: MechanicalMaterials) {
  const root = new T.Group();
  root.name = 'Recessed original sidepod inlet';
  root.position.set(side * 0.53, 0, 0);
  root.rotation.z = side * -0.08;
  const inner = m.dark.clone();
  inner.side = T.BackSide;
  const duct = new T.CylinderGeometry(1, 0.84, 0.17, 32, 1, true);
  duct.rotateX(Math.PI / 2);
  duct.scale(0.216, 0.065, 1);
  mesh(root, duct, inner, 0, 0.025, 0.306);
  const lip = mesh(root, new T.TorusGeometry(1, 0.031, 8, 40), m.carbon, 0, 0.025, 0.394);
  lip.scale.set(0.222, 0.072, 0.032);
  const radiator = mesh(root, new T.CircleGeometry(1, 32), m.dark, 0, 0.025, 0.224);
  radiator.scale.set(0.186, 0.056, 1);
  for (let i = -2; i <= 2; i++) {
    const extent = 0.33 * Math.sqrt(1 - (i / 3) ** 2);
    const fin = mesh(
      root,
      new T.BoxGeometry(extent, 0.003, 0.005),
      m.metal,
      0,
      0.025 + i * 0.017,
      0.229,
    );
    fin.name = 'Recessed cooling matrix';
  }
  const divider = mesh(root, new T.BoxGeometry(0.42, 0.008, 0.1), m.carbon, 0, 0.025, 0.353);
  divider.name = 'Inlet divider';
  mergeStatic(root);
  parent.add(root);
  return root;
}
