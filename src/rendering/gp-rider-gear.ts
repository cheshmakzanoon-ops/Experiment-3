import * as T from 'three';
import { batchBikeRigidMeshes } from './bike-rigid-batch.ts';
import { sampleProfile } from './profile-sampling.ts';
import { chainShaderHook, injectAfter, injectDeclarations } from './studio/shader-hooks.ts';
import type { RiderDetail } from './rider.ts';
import { GP_BOOT_ANKLE } from './gp-rider-contact.ts';

/** Metres in the existing ankle frame: +Y points down the shin, +Z to the toe.
 * A shaped forefoot, Achilles volume and calf cuff replace the rounded-box
 * shoe. The mesh changes no skeleton, peg, grip, collision or recovery anchor. */
type Section = readonly [number, number, number, number, number];
function loft(
  sections: readonly Section[],
  axis: 'y' | 'z',
  rows: number,
  sides: number,
  roundness = 1,
  capped = false,
  footbed?: number,
) {
  const stations = sections.map((s) => s[0]);
  const p: number[] = [],
    uv: number[] = [],
    index: number[] = [];
  for (let i = 0; i <= rows; i++) {
    const along = T.MathUtils.lerp(stations[0], stations[stations.length - 1], i / rows);
    const [centre, width, up, down] = [1, 2, 3, 4].map((k) =>
      sampleProfile(
        stations,
        sections.map((s) => s[k]),
        along,
      ),
    );
    for (let j = 0; j <= sides; j++) {
      const a = (j / sides) * Math.PI * 2,
        c = Math.cos(a),
        s = Math.sin(a);
      const shape = (v: number) => (roundness === 1 ? v : Math.sign(v) * Math.abs(v) ** roundness);
      const x = shape(c) * width,
        // A boot upper has sidewalls down to a footbed. An elliptical lower
        // half makes a floating capsule above the sole instead.
        depth =
          footbed !== undefined && s >= 0
            ? centre + (footbed - centre) * (1 - (1 - s) ** 6)
            : centre + shape(s) * (s >= 0 ? up : down);
      p.push(x, axis === 'y' ? along : depth, axis === 'y' ? depth : along);
      uv.push(j / sides, i / rows);
    }
  }
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < sides; j++) {
      const a = i * (sides + 1) + j,
        b = a + sides + 1;
      if (axis === 'z') index.push(a, a + 1, b, a + 1, b + 1, b);
      else index.push(a, b, a + 1, a + 1, b, b + 1);
    }
  if (capped) {
    // A reinforced toe/heel ends in a rounded face, not a pinched ellipsoid.
    // Callers trade one longitudinal row for these two fans: same triangles,
    // fewer vertices, and no new draw or separate toe-box object.
    const first = p.length / 3,
      last = first + 1,
      end = rows * (sides + 1);
    for (const section of [sections[0], sections[sections.length - 1]]) {
      p.push(0, axis === 'y' ? section[0] : section[1], axis === 'y' ? section[1] : section[0]);
      uv.push(0.5, section === sections[0] ? 0 : 1);
    }
    for (let j = 0; j < sides; j++) {
      if (axis === 'z') index.push(first, j + 1, j, last, end + j, end + j + 1);
      else index.push(first, j, j + 1, last, end + j + 1, end + j);
    }
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  if (roundness !== 1 || capped) {
    // UV duplication must not split the highlight down one side of the boot.
    const normal = g.getAttribute('normal'),
      average = new T.Vector3();
    for (let row = 0; row <= rows; row++) {
      const first = row * (sides + 1),
        last = first + sides;
      average
        .set(
          normal.getX(first) + normal.getX(last),
          normal.getY(first) + normal.getY(last),
          normal.getZ(first) + normal.getZ(last),
        )
        .normalize();
      normal.setXYZ(first, average.x, average.y, average.z);
      normal.setXYZ(last, average.x, average.y, average.z);
    }
  }
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

const FOOT: readonly Section[] = [
  [-0.094, -0.013, 0.002, 0.003, 0.003],
  [-0.076, -0.015, 0.032, 0.037, 0.04],
  [-0.041, -0.015, 0.041, 0.039, 0.051],
  [0.014, -0.014, 0.042, 0.039, 0.05],
  [0.075, -0.007, 0.046, 0.032, 0.043],
  [0.135, -0.001, 0.047, 0.026, 0.035],
  [0.178, 0.004, 0.035, 0.02, 0.023],
  [0.198, 0.006, 0.003, 0.003, 0.003],
];
const CUFF: readonly Section[] = [
  [-0.225, -0.035, 0.035, 0.032, 0.036],
  [-0.21, -0.035, 0.047, 0.039, 0.043],
  [-0.155, -0.032, 0.046, 0.037, 0.046],
  [-0.095, -0.026, 0.04, 0.035, 0.039],
  [-0.052, -0.024, 0.035, 0.04, 0.036],
  [-0.014, -0.018, 0.029, 0.05, 0.032],
];

/** REF018/071: a blunt reinforced toe, thin nearly straight sole, and a raised
 * instep that enters the tapered shaft. These are authored metre dimensions,
 * not measurements from the photographs. Only the GP contact-pose kit uses
 * this profile; the other road boots retain their existing construction. */
const GP_FOOT: readonly Section[] = [
  [-0.094, -0.013, 0.025, 0.036, 0.038],
  [-0.076, -0.017, 0.034, 0.041, 0.047],
  [-0.041, -0.019, 0.041, 0.043, 0.057],
  [0.014, -0.017, 0.043, 0.041, 0.056],
  [0.075, -0.007, 0.046, 0.032, 0.043],
  [0.135, -0.001, 0.047, 0.026, 0.035],
  [0.178, 0.003, 0.039, 0.022, 0.025],
  [0.198, 0.005, 0.025, 0.019, 0.019],
];
const GP_CUFF: readonly Section[] = [...CUFF.slice(0, -1), [-0.014, -0.018, 0.033, 0.047, 0.034]];
const GP_BOOT_ROUNDNESS = 0.72;

export const GP_BOOT_ENVELOPE = Object.freeze({ width: 0.116, length: 0.3, height: 0.27 });
export function gpRacingBoot(
  detail: RiderDetail,
  side: -1 | 1,
  materials: {
    leather: T.Material;
    panel: T.Material;
    sole: T.Material;
    armour: T.Material;
    slider: T.Material;
  },
  contactPose = false,
) {
  if (side !== -1 && side !== 1) throw new RangeError('Invalid racing boot side');
  const root = new T.Group();
  root.name = `GP ${side > 0 ? 'left' : 'right'} articulated racing boot`;
  const close = detail === 'high',
    sides = close ? 16 : detail === 'mid' ? 10 : 8;
  const add = (g: T.BufferGeometry, m: T.Material, name: string, parent = root) => {
    const mesh = new T.Mesh(g, m);
    mesh.name = name;
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const cuffRoot = contactPose ? new T.Group() : root;
  if (contactPose) {
    cuffRoot.name = 'GP ankle-hinged boot cuff';
    cuffRoot.position.fromArray(GP_BOOT_ANKLE);
    root.add(cuffRoot);
  }
  const footProfile = contactPose ? GP_FOOT : FOOT;
  add(
    loft(
      footProfile,
      'z',
      (close ? 19 : 10) - Number(contactPose),
      sides,
      contactPose ? GP_BOOT_ROUNDNESS : 1,
      contactPose,
      contactPose ? 0.0275 : undefined,
    ),
    // One finish across the reinforced upper and articulated cuff. The GP
    // forefoot no longer reads as a black seat-textured glove beneath a shaft.
    contactPose ? materials.panel : materials.leather,
    'Anatomical forefoot and heel',
  );
  const cuffGeometry = loft(
    contactPose ? GP_CUFF : CUFF,
    'y',
    close ? 14 : 8,
    sides,
    contactPose ? 0.78 : 1,
  );
  if (contactPose) cuffGeometry.translate(-GP_BOOT_ANKLE[0], -GP_BOOT_ANKLE[1], -GP_BOOT_ANKLE[2]);
  add(cuffGeometry, materials.panel, 'Tapered calf and Achilles cuff', cuffRoot);
  // Retain the exact sole height/cross-section at the peg: only its plan-view
  // outline and closed end faces follow the reinforced upper.
  const sole = footProfile.map(
    ([z, , w], i) =>
      [
        // A 1 mm end lip keeps the sole and upper caps out of the same plane.
        z + (contactPose ? (i === 0 ? -0.001 : i === footProfile.length - 1 ? 0.001 : 0) : 0),
        0.028,
        w * 1.02,
        0.0045,
        0.005,
      ] as const,
  );
  add(
    loft(sole, 'z', (close ? 15 : 8) - Number(contactPose), sides, 1, contactPose),
    materials.sole,
    'Thin shaped traction sole',
  );
  if (detail === 'far') {
    batchBikeRigidMeshes(root);
    return root;
  }
  // Conformal ankle protection is a shallow cap, never a spherical joint.
  const ankle = add(
    new T.SphereGeometry(0.022, close ? 12 : 8, 6),
    materials.armour,
    'External ankle protection',
  );
  ankle.scale.set(contactPose ? 0.13 : 0.16, contactPose ? 0.85 : 1, contactPose ? 0.9 : 0.88);
  // In the planted GP foot frame, +Y is down and +Z is forward, so +X
  // points to bike right. Keep the external protection on the outside.
  const footSide = contactPose ? -side : side;
  ankle.position.set(
    footSide * (contactPose ? 0.0415 : 0.044),
    contactPose ? -0.039 : -0.083,
    -0.037,
  );
  const toe = add(
    new T.SphereGeometry(0.023, close ? 12 : 8, 6),
    materials.slider,
    'Replaceable toe slider',
  );
  toe.scale.set(contactPose ? 0.14 : 0.22, contactPose ? 0.28 : 0.34, contactPose ? 1.15 : 1.4);
  toe.position.set(footSide * (contactPose ? 0.044 : 0.046), -0.013, 0.144);
  const heel = add(
    loft(
      contactPose
        ? [
            [-0.096, -0.013, 0.0265, 0.0375, 0.0395],
            [-0.078, -0.017, 0.0355, 0.0425, 0.0485],
            [-0.06, -0.018, 0.0395, 0.0435, 0.0555],
            [-0.044, -0.019, 0.0383, 0.04, 0.054],
          ]
        : [
            [-0.091, -0.004, 0.001, 0.003, 0.003],
            [-0.078, -0.014, 0.035, 0.026, 0.027],
            [-0.06, -0.02, 0.038, 0.024, 0.032],
            [-0.044, -0.022, 0.027, 0.017, 0.025],
          ],
      'z',
      contactPose ? 4 : 5,
      sides,
      contactPose ? GP_BOOT_ROUNDNESS : 1,
      contactPose,
      contactPose ? 0.029 : undefined,
    ),
    materials.armour,
    'Moulded heel counter',
  );
  heel.position.z = contactPose ? 0 : -0.001;
  if (close) {
    // The instep folds span the foot, following its actual upper profile.
    for (let rib = 0; rib < 5; rib++) {
      const z = -0.01 + rib * 0.02,
        points: T.Vector3[] = [];
      for (let j = 0; j <= 6; j++) {
        const x = ((j / 6) * 2 - 1) * 0.036;
        let y = -0.051 + (x / 0.041) ** 2 * 0.026 + rib * 0.004;
        if (contactPose) {
          const stations = GP_FOOT.map((s) => s[0]),
            centre = sampleProfile(
              stations,
              GP_FOOT.map((s) => s[1]),
              z,
            ),
            width = sampleProfile(
              stations,
              GP_FOOT.map((s) => s[2]),
              z,
            ),
            top = sampleProfile(
              stations,
              GP_FOOT.map((s) => s[4]),
              z,
            ),
            cosine = (Math.abs(x) / width) ** (1 / GP_BOOT_ROUNDNESS),
            sine = Math.sqrt(Math.max(0, 1 - cosine * cosine));
          y = centre - top * sine ** GP_BOOT_ROUNDNESS - 0.0013;
        }
        points.push(new T.Vector3(x, y, z));
      }
      add(
        new T.TubeGeometry(new T.CatmullRomCurve3(points), 6, 0.0018, 4, false),
        materials.sole,
        'Moulded instep flex rib',
      );
    }
    const seam = new T.CatmullRomCurve3([
      new T.Vector3(-side * 0.039, -0.207, -0.035),
      new T.Vector3(-side * 0.044, -0.15, -0.035),
      new T.Vector3(-side * 0.038, -0.085, -0.03),
      new T.Vector3(-side * 0.032, -0.04, -0.016),
    ]);
    const seamGeometry = new T.TubeGeometry(seam, 10, 0.0013, 4, false);
    if (contactPose)
      seamGeometry.translate(-GP_BOOT_ANKLE[0], -GP_BOOT_ANKLE[1], -GP_BOOT_ANKLE[2]);
    // Keep the cuff's existing seam in its batch, avoiding another material
    // submission while the ankle articulates. Other road kits retain theirs.
    add(
      seamGeometry,
      contactPose ? materials.panel : materials.sole,
      'Recessed inner boot closure',
      cuffRoot,
    );
  }
  if (contactPose) batchBikeRigidMeshes(cuffRoot);
  batchBikeRigidMeshes(root);
  return root;
}

/** Original object-space leather grain: actual millimetre scale rather than
 * large UV-stretched perforation dots. Derivative attenuation prevents crawl
 * and the normal gradient is bounded. Install after cloning suit materials;
 * the weather hook chains afterward without replacing this shader. */
export function installGpLeatherFinish(material: T.MeshPhysicalMaterial) {
  chainShaderHook(material, 'gp-leathers-metre-grain-v1', (shader) => {
    injectDeclarations(shader, 'common', 'varying vec3 vGpLeatherBind;', 'vertex');
    injectAfter(shader, 'begin_vertex', 'vGpLeatherBind = position;', 'vertex');
    injectDeclarations(
      shader,
      'common',
      `
varying vec3 vGpLeatherBind;
float gpLeatherHeight;
float gpLeatherHash(vec3 p) { return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453); }
float gpLeatherNoise(vec3 p) {
  vec3 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(mix(gpLeatherHash(i),gpLeatherHash(i+vec3(1,0,0)),f.x),
    mix(gpLeatherHash(i+vec3(0,1,0)),gpLeatherHash(i+vec3(1,1,0)),f.x),f.y),
    mix(mix(gpLeatherHash(i+vec3(0,0,1)),gpLeatherHash(i+vec3(1,0,1)),f.x),
    mix(gpLeatherHash(i+vec3(0,1,1)),gpLeatherHash(i+vec3(1,1,1)),f.x),f.y),f.z);
}`,
      'fragment',
    );
    injectAfter(
      shader,
      'color_fragment',
      `
{
  float px = length(fwidth(vGpLeatherBind));
  float fine = 1. - smoothstep(.0012,.005,px);
  float meso = 1. - smoothstep(.009,.035,px);
  float grain = gpLeatherNoise(vGpLeatherBind*510.);
  float drape = sin(vGpLeatherBind.y*180. + gpLeatherNoise(vGpLeatherBind*22.)*5.);
  gpLeatherHeight = (grain-.5)*.00007*fine + drape*.00032*meso;
  diffuseColor.rgb *= 1. + (grain-.5)*.045*fine;
}`,
      'fragment',
    );
    injectAfter(
      shader,
      'normal_fragment_maps',
      `
{
  vec3 dx=dFdx(-vViewPosition), dy=dFdy(-vViewPosition);
  vec3 r1=cross(dy,normal), r2=cross(normal,dx);
  float det=dot(dx,r1);
  vec3 gradient=sign(det)*(dFdx(gpLeatherHeight)*r1+dFdy(gpLeatherHeight)*r2);
  normal=normalize(max(abs(det),1.e-10)*normal-gradient);
}`,
      'fragment',
    );
  });
  return material;
}
