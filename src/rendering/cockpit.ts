import * as T from 'three';
import { clamp } from '../core/math.ts';
import { F } from '../simulation/protocol.ts';
import { box, canvasTexture, mesh, mergeStatic, tube } from './geometry.ts';

/** Rounded planar apertures use normalized UVs, not ShapeGeometry's metre UVs.
 * A render-target image must fill the aperture exactly once at every quality. */
export function roundedAperture(width: number, height: number, radius: number) {
  if (
    ![width, height, radius].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0 ||
    radius < 0 ||
    radius > Math.min(width, height) / 2
  )
    throw new Error('Invalid cockpit aperture');
  const x = width / 2,
    y = height / 2,
    r = radius;
  const shape = new T.Shape();
  shape.moveTo(-x + r, -y);
  shape.lineTo(x - r, -y);
  shape.quadraticCurveTo(x, -y, x, -y + r);
  shape.lineTo(x, y - r);
  shape.quadraticCurveTo(x, y, x - r, y);
  shape.lineTo(-x + r, y);
  shape.quadraticCurveTo(-x, y, -x, y - r);
  shape.lineTo(-x, -y + r);
  shape.quadraticCurveTo(-x, -y, -x + r, -y);
  shape.closePath();
  return shape;
}
export function apertureGeometry(width: number, height: number, radius: number) {
  const geometry = new T.ShapeGeometry(roundedAperture(width, height, radius), 10);
  const p = geometry.getAttribute('position'),
    uv = geometry.getAttribute('uv');
  for (let i = 0; i < p.count; i++)
    uv.setXY(i, clamp(p.getX(i) / width + 0.5, 0, 1), clamp(p.getY(i) / height + 0.5, 0, 1));
  geometry.computeBoundingBox();
  return geometry;
}
function plate(shape: T.Shape, depth: number, bevel: number) {
  const g = new T.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSegments: 3,
    bevelSize: bevel,
    bevelThickness: bevel,
    curveSegments: 10,
    steps: 1,
  });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** A flat rear aperture with its own raised bezel; unlike an ellipsoid housing,
 * every corner of the glass is supported rather than floating outside the shell. */
export function addMirrorHousing(
  parent: T.Group,
  paint: T.Material,
  carbon: T.Material,
  side: number,
) {
  if (side !== -1 && side !== 1) throw new Error('Invalid mirror side');
  const root = new T.Group();
  root.name = side < 0 ? 'Right mirror housing' : 'Left mirror housing';
  root.position.set(side * 0.64, 0.3, 0.43);
  parent.add(root);
  mesh(root, plate(roundedAperture(0.235, 0.096, 0.03), 0.062, 0.004), paint);
  mesh(root, plate(roundedAperture(0.219, 0.08, 0.023), 0.006, 0.002), carbon, 0, 0, -0.036);
  const surface = mesh(
    root,
    apertureGeometry(0.192, 0.072, 0.018),
    new T.MeshBasicMaterial({ color: 0xd4dde0 }),
    0,
    0,
    -0.042,
  );
  surface.rotation.y = Math.PI;
  surface.name = side < 0 ? 'Right rear-view mirror' : 'Left rear-view mirror';
  surface.castShadow = false;
  surface.receiveShadow = false;
  return surface;
}

/** Original butterfly wheel outline, authored in metres. It stays inside the
 * established grip envelope, so the existing hand/wrist IK needs no fake offsets. */
export function steeringFaceGeometry() {
  const s = new T.Shape();
  s.moveTo(-0.154, 0.063);
  s.quadraticCurveTo(-0.148, 0.083, -0.117, 0.083);
  s.lineTo(0.117, 0.083);
  s.quadraticCurveTo(0.148, 0.083, 0.154, 0.063);
  s.lineTo(0.157, 0.001);
  s.quadraticCurveTo(0.137, -0.01, 0.135, -0.039);
  s.lineTo(0.15, -0.073);
  s.quadraticCurveTo(0.146, -0.105, 0.113, -0.112);
  s.lineTo(0.062, -0.112);
  s.quadraticCurveTo(0.033, -0.12, 0, -0.125);
  s.quadraticCurveTo(-0.033, -0.12, -0.062, -0.112);
  s.lineTo(-0.113, -0.112);
  s.quadraticCurveTo(-0.146, -0.105, -0.15, -0.073);
  s.lineTo(-0.135, -0.039);
  s.quadraticCurveTo(-0.137, -0.01, -0.157, 0.001);
  s.closePath();
  return plate(s, 0.026, 0.003);
}

/** Opaque labels are part of an original machined faceplate, not a cloned game
 * UI. A single atlas is shared by the static legends and the knob tick scales. */
function controlLegends() {
  return canvasTexture(1024, 384, (c) => {
    c.fillStyle = '#151e22';
    c.fillRect(0, 0, 1024, 384);
    c.strokeStyle = '#91a09f';
    c.lineWidth = 2;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (const [x, label] of [
      [237, 'BIAS'],
      [512, 'ENERGY'],
      [787, 'DIFF'],
    ] as const) {
      c.font = '600 18px Arial';
      c.fillStyle = '#cad2ca';
      c.fillText(label, x, 25);
      for (let i = 0; i <= 10; i++) {
        const a = Math.PI * (0.75 + i * 0.15);
        const r = 70,
          outer = i % 5 === 0 ? 85 : 79;
        c.beginPath();
        c.moveTo(x + Math.cos(a) * r, 119 + Math.sin(a) * r);
        c.lineTo(x + Math.cos(a) * outer, 119 + Math.sin(a) * outer);
        c.stroke();
      }
      c.font = '15px monospace';
      c.fillText('−', x - 74, 184);
      c.fillText('+', x + 74, 184);
    }
    c.fillStyle = '#9db2ae';
    c.font = '600 22px Arial';
    c.fillText('APEX  /  RACE SYSTEMS', 512, 269);
    c.font = '15px monospace';
    c.fillText('A-07   •   CONTROL UNIT', 512, 308);
    c.strokeStyle = '#bd8056';
    c.beginPath();
    c.moveTo(215, 231);
    c.lineTo(809, 231);
    c.stroke();
  });
}
/** The printed panel follows the lower wheel silhouette. A rectangular decal
 * would extend beyond its curved corners and turn the outline into a slab. */
export function controlPanelGeometry() {
  const shape = new T.Shape();
  shape.moveTo(-0.131, 0.039);
  shape.lineTo(0.131, 0.039);
  shape.lineTo(0.119, 0.011);
  shape.quadraticCurveTo(0.121, 0, 0.132, -0.004);
  shape.quadraticCurveTo(0.124, -0.029, 0.099, -0.033);
  shape.lineTo(0.056, -0.033);
  shape.lineTo(0, -0.042);
  shape.lineTo(-0.056, -0.033);
  shape.lineTo(-0.099, -0.033);
  shape.quadraticCurveTo(-0.124, -0.029, -0.132, -0.004);
  shape.quadraticCurveTo(-0.121, 0, -0.119, 0.011);
  shape.closePath();
  const geometry = new T.ShapeGeometry(shape, 10);
  const p = geometry.getAttribute('position'),
    uv = geometry.getAttribute('uv');
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 0.272 + 0.5, p.getY(i) / 0.086 + 0.5);
  return geometry;
}
export function controlAngles(
  bias: number,
  differential: number,
  ers: number,
  out = new T.Vector3(),
) {
  if (!Number.isFinite(bias) || !Number.isFinite(differential) || !Number.isFinite(ers))
    throw new Error('Invalid cockpit controls');
  // Viewed from behind (-Z), a positive local Z rotation is clockwise.
  return out.set(
    (clamp((bias - 0.48) / 0.2, 0, 1) - 0.5) * Math.PI * 1.5,
    (clamp(ers, 0, 2) - 1) * Math.PI * 0.6,
    (clamp(differential, 0, 1) - 0.5) * Math.PI * 1.5,
  );
}
/** Three independently rotating dials share three material draw calls. Logical
 * frames are retained for articulation; the GPU instances consume those same
 * matrices. Bounds include every permitted Z rotation, not just the rest pose. */
export class RotarySelectors {
  readonly selectors: T.Group[] = [];
  readonly meshes: T.InstancedMesh[] = [];
  constructor(parent: T.Group, knurl: T.Material, rubber: T.Material, marker: T.Material) {
    const template = new T.Group();
    const cap = mesh(template, new T.CylinderGeometry(0.015, 0.018, 0.014, 24), knurl);
    cap.rotation.x = Math.PI / 2;
    for (let tooth = 0; tooth < 16; tooth++) {
      const a = (tooth / 16) * Math.PI * 2;
      const ridge = box(
        template,
        rubber,
        Math.sin(a) * 0.017,
        Math.cos(a) * 0.017,
        0,
        0.003,
        0.004,
        0.012,
      );
      ridge.rotation.z = -a;
    }
    box(template, marker, 0, 0.008, -0.008, 0.0025, 0.009, 0.001);
    mergeStatic(template);
    for (let i = 0; i < 3; i++) {
      const knob = new T.Group();
      knob.name = ['Brake bias selector', 'ERS selector', 'Differential selector'][i];
      knob.position.set((i - 1) * -0.073, -0.056, -0.025);
      parent.add(knob);
      this.selectors.push(knob);
    }
    for (const child of template.children) {
      const source = child as T.Mesh<T.BufferGeometry, T.Material>;
      const instanced = new T.InstancedMesh(source.geometry, source.material, 3);
      instanced.name = 'Instanced rotary-selector detail';
      instanced.castShadow = instanced.receiveShadow = true;
      instanced.instanceMatrix.setUsage(T.DynamicDrawUsage);
      source.geometry.computeBoundingSphere();
      const local = source.geometry.boundingSphere!;
      // The geometry's off-centre indicator also orbits. Enclose the full orbit
      // plus the outer dial spacing to keep both view and shadow culling valid.
      instanced.boundingSphere = new T.Sphere(
        new T.Vector3(0, -0.056, -0.025),
        0.073 + local.center.length() + local.radius,
      );
      instanced.boundingBox = instanced.boundingSphere.getBoundingBox(new T.Box3());
      parent.add(instanced);
      this.meshes.push(instanced);
    }
    template.clear(); // Geometry ownership moved to the instances; do not dispose it here.
    this.setAngles(new T.Vector3());
  }
  setAngles(angles: T.Vector3) {
    if (!Number.isFinite(angles.x) || !Number.isFinite(angles.y) || !Number.isFinite(angles.z))
      throw new Error('Invalid rotary-selector angles');
    for (let i = 0; i < this.selectors.length; i++) {
      const selector = this.selectors[i];
      selector.rotation.z = angles.getComponent(i);
      selector.updateMatrix();
      for (const instance of this.meshes) instance.setMatrixAt(i, selector.matrix);
    }
    for (const instance of this.meshes) instance.instanceMatrix.needsUpdate = true;
  }
}
export class CockpitControls {
  readonly selectors: T.Group[];
  readonly selectorBank: RotarySelectors;
  private angles = new T.Vector3();
  constructor(steering: T.Group, carbon: T.Material) {
    const staticParts = new T.Group();
    steering.add(staticParts);
    const face = mesh(staticParts, steeringFaceGeometry(), carbon);
    face.name = 'Bevelled butterfly steering body';
    const alloy = new T.MeshStandardMaterial({ color: 0x909a9e, metalness: 0.86, roughness: 0.34 });
    const rubber = new T.MeshStandardMaterial({ color: 0x131a1d, roughness: 0.91 });
    const knurl = new T.MeshStandardMaterial({ color: 0x38494e, metalness: 0.6, roughness: 0.43 });
    const marker = new T.MeshStandardMaterial({ color: 0xe2ddc6, roughness: 0.58 });
    const label = mesh(
      staticParts,
      controlPanelGeometry(),
      new T.MeshStandardMaterial({ map: controlLegends(), roughness: 0.68 }),
      0,
      -0.072,
      -0.017,
    );
    label.rotation.y = Math.PI;
    // Display surround has a three-dimensional rubber seal, recessed screen and screws.
    mesh(
      staticParts,
      plate(roundedAperture(0.199, 0.107, 0.009), 0.011, 0.002),
      rubber,
      0,
      0.014,
      -0.02,
    );
    for (const x of [-0.089, 0.089])
      for (const y of [-0.035, 0.063]) {
        const bolt = mesh(
          staticParts,
          new T.CylinderGeometry(0.0023, 0.0023, 0.0018, 8),
          alloy,
          x,
          y,
          -0.027,
        );
        bolt.rotation.x = Math.PI / 2;
      }
    this.selectorBank = new RotarySelectors(steering, knurl, rubber, marker);
    this.selectors = this.selectorBank.selectors;
    for (const side of [-1, 1]) {
      const grip = tube(
        staticParts,
        rubber,
        [
          [side * 0.17, 0.05, 0],
          [side * 0.185, 0.011, -0.002],
          [side * 0.18, -0.046, 0],
          [side * 0.154, -0.081, 0],
        ],
        0.023,
      );
      grip.name = 'Ergonomic suede wheel grip';
      // TubeGeometry has open ends. Close the grip with rounded suede caps,
      // rather than exposing a sliced pipe in the driver's close-up view.
      for (const [x, y] of [[side * 0.17, 0.05], [side * 0.154, -0.081]])
        mesh(staticParts, new T.SphereGeometry(0.023, 16, 10), rubber, x, y, 0);
      for (let j = 0; j < 3; j++) {
        const bezel = mesh(
          staticParts,
          new T.TorusGeometry(0.0105, 0.0016, 6, 24),
          alloy,
          side * (0.117 + (j % 2) * 0.026),
          0.037 - j * 0.028,
          -0.027,
        );
        bezel.rotation.y = Math.PI;
      }
    }
    mergeStatic(staticParts);
  }
  update(frame: Float32Array, base: number) {
    const a = controlAngles(
      frame[base + F.BRAKE_BIAS],
      frame[base + F.DIFF_POWER],
      frame[base + F.ERS_MODE],
      this.angles,
    );
    this.selectorBank.setAngles(a);
  }
}
