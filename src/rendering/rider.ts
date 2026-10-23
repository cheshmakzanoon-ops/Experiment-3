import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { tagWeatherSurface } from './weather-presentation.ts';
import { helmetLiveryTexture, riderPanelTexture } from './bike-livery.ts';
import { bikeSurfaceMaps } from './bike-surface-detail.ts';
import { batchBikeRigidMeshes } from './bike-rigid-batch.ts';
import { sampleProfile } from './profile-sampling.ts';
import { tagMudExposure } from './offroad/mud.ts';
import { gpRacingBoot, installGpLeatherFinish } from './gp-rider-gear.ts';
import { GpRiderGarment } from './gp-rider-garment.ts';
import { addGpRacingGlove } from './gp-rider-glove.ts';
import type { GpBrakeFingers } from './gp-brake-fingers.ts';
import { gpHeadFrame } from './gp-rider-motion.ts';
import {
  GP_HELMET_CENTRE,
  addGpHelmetDetails,
  gpHelmetLivery,
  gpHelmetShell,
} from './gp-rider-helmet.ts';
import { GpRiderSpine } from './gp-rider-spine.ts';
import {
  GpRiderPosture,
  gpClearJoint,
  gpRoadClearance,
  type GpRiderBodyState,
} from './gp-rider-posture.ts';
import {
  GP_BOOT_ANKLE,
  GP_BOOT_PEDAL,
  GP_BOOT_PEG,
  GP_GLOVE_GRIP,
  GP_GLOVE_WRIST,
  GP_FOOTPEG_RADIUS,
  gpAttachAtJoint,
  gpBootFrame,
  gpContactJoint,
  gpGripFrame,
} from './gp-rider-contact.ts';
import {
  GP_TORSO_PROFILE,
  gpTorsoGeometry,
  installGpSuitFinish,
  shapeGpSuitGeometry,
} from './gp-rider-suit.ts';
import { motocrossFabricMaps, motocrossGraphics } from './offroad/motocross-detail.ts';
import type { MotocrossBootSkin } from './offroad/motocross-boot-skin.ts';
import {
  MX_BOOT_ANKLE,
  MX_BOOT_PEG,
  MX_GLOVE_GRIP,
  MX_GLOVE_WRIST,
  motocrossBootFrame,
  motocrossSoleContact,
} from './offroad/motocross-rider-contact.ts';
import {
  sampleMotocrossRiderMotion,
  type MotocrossRiderMotion,
  type MotocrossRiderMotionInput,
} from './offroad/motocross-rider-motion.ts';
import { MotocrossRiderSpine, motocrossHeadFrame } from './offroad/motocross-rider-spine.ts';
import {
  addMotocrossBoot,
  addMotocrossGarment,
  addMotocrossGlove,
  addMotocrossHelmet,
  motocrossGarmentGeometry,
  motocrossHelmetShell,
  type MotocrossGarmentMesh,
} from './offroad/motocross-gear.ts';
import {
  helmetShell,
  visorGeometry,
  helmetSpoilerGeometry,
  helmetPoint,
  visorBounds,
  VISOR_PHI,
  helmetPatch,
} from './helmet-shell.ts';

/** Procedural road-racing rider (WP34 presentation): one-piece leathers with
 * armour caps, aero hump, knee/elbow sliders, gloves, boots and a full-face
 * helmet with a tinted visor. The pose is solved every frame from the bike
 * snapshot: lean (the rider hangs off and leans further than the bike), rider
 * offset, tuck behind the screen on straights, sitting up under braking, hands
 * on the clip-ons (two-bone IK to the steered grips) and feet on the pegs.
 * Separated, the same rider slides, tumbles, stands and jogs back to the bike.
 * Original design; no real person, team or equipment brand is depicted. */
export interface RiderColours {
  primary: number;
  secondary: number;
  accent: number;
}
export interface RiderPose extends MotocrossRiderMotionInput {
  /** Chassis lean (rad, + left) and hang-off offset (m, + left). */
  lean: number;
  offset: number;
  tuck: number;
  /** 0 coasting .. 1 hard braking. */
  braking: number;
  steer: number;
  /** Presented road speed (m/s); distinguishes slow steering from countersteer. */
  speed?: number;
  /** Sprung chassis pitch relative to the bike frame, in radians. */
  suspensionPitch?: number;
  /** Independent rear pedal; the front lever must not animate the right foot. */
  rearBraking?: number;
  /** Off-road (WP41): 0 seated .. 1 standing on the pegs. */
  standing?: number;
  /** Foot dab: -1 right foot down .. +1 left foot down. */
  dab?: number;
  /** Body fore/aft over the bike: -1 back (throttle) .. +1 forward. */
  body?: number;
  /** GP only: presented throttle 0..1, longitudinal acceleration (g, +
   * forward) and chassis roll rate (rad/s, + left), all from the snapshot. */
  throttle?: number;
  gLong?: number;
  leanRate?: number;
  /** GP only: spring-damped body state from `GpRiderBody`; omitted, the
   * posture uses its equilibrium, so `ride()` stays a pure function. */
  gpBody?: GpRiderBodyState;
}
export type RiderDetail = 'high' | 'mid' | 'far';
/** Road leathers, or an off-road kit (textile jersey and pants, peaked
 * helmet with goggles, tall boots). */
export type RiderKit = 'leathers' | 'motocross';
const Y = new T.Vector3(0, 1, 0);
/** GP neck: seventh vertebra on the upper-chest frame and its length to the
 * atlas, where the race helmet pivots (gp-rider-helmet.ts GP_HELMET_CENTRE). */
const GP_NECK_BASE = new T.Vector3(0, 0.495, 0.02);
const GP_NECK_LENGTH = 0.075;
/** A rounded upper back carries the neck base forward/down the chest. */
const GP_NECK_HUNCH = new T.Vector3(0, -0.012, 0.04);
/** Joint-centre clearances that leave the knee/elbow sliders (about 6 cm
 * outboard of the joint) skimming the road rather than inside it. */
const GP_KNEE_CLEARANCE = 0.068;
const GP_ELBOW_CLEARANCE = 0.07;
const GP_BIKE_FORWARD = new T.Vector3(0, 0, 1);
/** Tapered capsule along +Y from 0 to `length` (joint at the origin). */
function limbGeometry(r0: number, r1: number, length: number, sides: number) {
  const points: T.Vector2[] = [];
  const caps = Math.max(3, Math.round(sides / 4));
  for (let i = 0; i <= caps; i++) {
    const a = -Math.PI / 2 + (i / caps) * (Math.PI / 2);
    points.push(new T.Vector2(Math.cos(a) * r0, Math.sin(a) * r0));
  }
  for (let i = 1; i < 6; i++) {
    const t = i / 6,
      bulge = Math.sin(t * Math.PI) * 0.12 * Math.max(r0, r1);
    points.push(new T.Vector2(T.MathUtils.lerp(r0, r1, t) + bulge, t * length));
  }
  for (let i = 0; i <= caps; i++) {
    const a = (i / caps) * (Math.PI / 2);
    points.push(new T.Vector2(Math.cos(a) * r1, length + Math.sin(a) * r1));
  }
  return new T.LatheGeometry(points, sides);
}
type LimbShape = 'upper-arm' | 'forearm' | 'thigh' | 'shin';
type BodySection = readonly [number, number, number, number, number];
/** Cross sections of clothed anatomy, measured along each existing IK bone.
 * The shoulder/biceps, forearm mass, quadriceps and calf have separate peaks;
 * the wrist, elbow, patella and ankle taper instead of forming rigid capsules.
 * [fraction along bone, centre Z, half width, front depth, rear depth]. */
const ROAD_LIMB_SECTIONS: Record<LimbShape, readonly BodySection[]> = {
  'upper-arm': [
    [-0.11, 0, 0.002, 0.003, 0.003],
    [-0.055, 0, 0.035, 0.034, 0.039],
    [0, 0.002, 0.049, 0.045, 0.052],
    [0.18, 0.004, 0.055, 0.051, 0.058],
    [0.42, 0.003, 0.05, 0.046, 0.054],
    [0.68, 0, 0.041, 0.038, 0.045],
    [0.87, 0, 0.036, 0.034, 0.039],
    [1, 0, 0.033, 0.032, 0.035],
    [1.1, 0, 0.002, 0.003, 0.003],
  ],
  forearm: [
    [-0.1, 0, 0.002, 0.003, 0.003],
    [0, 0, 0.038, 0.04, 0.04],
    [0.15, -0.003, 0.047, 0.051, 0.047],
    [0.33, -0.003, 0.044, 0.047, 0.045],
    [0.64, 0, 0.034, 0.036, 0.036],
    [0.89, 0, 0.028, 0.03, 0.03],
    [1, 0, 0.027, 0.029, 0.029],
    [1.08, 0, 0.002, 0.003, 0.003],
  ],
  thigh: [
    [-0.1, 0, 0.003, 0.004, 0.004],
    [-0.04, 0, 0.061, 0.068, 0.064],
    [0.05, 0.003, 0.08, 0.082, 0.075],
    [0.25, 0.003, 0.081, 0.083, 0.075],
    [0.46, 0.004, 0.072, 0.074, 0.065],
    [0.72, 0.001, 0.058, 0.061, 0.053],
    [0.9, 0, 0.051, 0.053, 0.047],
    [1, 0, 0.048, 0.047, 0.047],
    [1.09, 0, 0.003, 0.004, 0.004],
  ],
  shin: [
    [-0.1, 0, 0.003, 0.004, 0.004],
    [0, 0.002, 0.049, 0.055, 0.046],
    [0.2, -0.006, 0.048, 0.047, 0.055],
    [0.4, -0.009, 0.049, 0.045, 0.059],
    [0.65, -0.004, 0.04, 0.039, 0.044],
    [0.9, 0, 0.031, 0.034, 0.032],
    [1, 0, 0.032, 0.035, 0.031],
    [1.08, 0, 0.003, 0.004, 0.004],
  ],
};
function roadLimbSections(shape: LimbShape, length: number): BodySection[] {
  return ROAD_LIMB_SECTIONS[shape].map(([t, z, w, front, back]) => [t * length, z, w, front, back]);
}
/** A stitched insert conforms to the underlying anatomical loft. Optional
 * accordion folds rise only 1.5–4.5 mm; plain side panels follow the same skin. */
function leatherPanelGeometry(
  sections: readonly BodySection[],
  from: number,
  to: number,
  folds: number,
  sides: number,
  angles: readonly [number, number] = [Math.PI * 1.06, Math.PI * 1.94],
  roundness = 1,
) {
  const ys = sections.map((s) => s[0]),
    positions: number[] = [],
    uv: number[] = [],
    indices: number[] = [],
    rows = folds ? folds * 4 : 16;
  for (let i = 0; i <= rows; i++) {
    const t = i / rows,
      y = T.MathUtils.lerp(from, to, t),
      values = [1, 2, 3, 4].map((k) =>
        sampleProfile(
          ys,
          sections.map((s) => s[k]),
          y,
        ),
      ),
      raised = 0.0015 + (1 - Math.cos(t * folds * Math.PI * 2)) * 0.0015 * Math.sin(t * Math.PI);
    for (let j = 0; j <= sides; j++) {
      const a = T.MathUtils.lerp(angles[0], angles[1], j / sides),
        shape = (value: number) => Math.sign(value) * Math.abs(value) ** roundness;
      positions.push(
        shape(Math.cos(a)) * (values[1] + raised),
        y,
        values[0] + shape(Math.sin(a)) * (values[Math.sin(a) > 0 ? 2 : 3] + raised),
      );
      uv.push(j / sides, t);
      if (i < rows && j < sides) {
        const at = i * (sides + 1) + j,
          next = at + sides + 1;
        indices.push(at, next, at + 1, at + 1, next, next + 1);
      }
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
/** Superelliptic body section loft along +Y (torso, hump). */
function bodyLoft(sections: readonly BodySection[], sides: number, roundness = 0.8) {
  // [y, z centre, half-width, half-depth front, half-depth back]
  const p: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  const ys = sections.map((s) => s[0]);
  const samples: number[][] = [];
  const steps = sides >= 20 ? 4 : sides >= 12 ? 2 : 1;
  for (let i = 0; i < sections.length - 1; i++)
    for (let j = 0; j < steps; j++) {
      const y = T.MathUtils.lerp(ys[i], ys[i + 1], j / steps);
      samples.push([
        y,
        ...[1, 2, 3, 4].map((k) =>
          sampleProfile(
            ys,
            sections.map((s) => s[k]),
            y,
          ),
        ),
      ]);
    }
  samples.push([...sections[sections.length - 1]]);
  for (const [y, cz, w, front, back] of samples)
    for (let j = 0; j <= sides; j++) {
      const a = (j / sides) * Math.PI * 2,
        c = Math.cos(a),
        s = Math.sin(a);
      const shape = (v: number) => Math.sign(v) * Math.abs(v) ** roundness;
      p.push(shape(c) * w, y, cz + shape(s) * (s > 0 ? front : back));
      uv.push(j / sides, (y - ys[0]) / (ys[ys.length - 1] - ys[0]));
    }
  for (let i = 0; i < samples.length - 1; i++)
    for (let j = 0; j < sides; j++) {
      const a = i * (sides + 1) + j,
        b = a + sides + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}
/** Replaceable knee slider: a thin asymmetrical polymer pad, not a joint disc. */
function kneeSliderGeometry() {
  const shape = new T.Shape();
  shape.moveTo(-0.025, -0.037);
  shape.bezierCurveTo(-0.036, -0.025, -0.032, 0.025, -0.018, 0.04);
  shape.quadraticCurveTo(0.002, 0.049, 0.023, 0.031);
  shape.quadraticCurveTo(0.033, 0.005, 0.026, -0.026);
  shape.quadraticCurveTo(0.017, -0.043, -0.025, -0.037);
  const geometry = new T.ExtrudeGeometry(shape, {
    depth: 0.01,
    bevelEnabled: true,
    bevelSize: 0.004,
    bevelThickness: 0.003,
    bevelSegments: 2,
    curveSegments: 5,
  });
  geometry.translate(0, 0, -0.005);
  return geometry;
}
function part(parent: T.Object3D, geometry: T.BufferGeometry, material: T.Material) {
  const m = new T.Mesh(geometry, material);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
/** Bone: a group at the proximal joint whose +Y points at the distal joint. */
class Bone {
  readonly group = new T.Group();
  constructor(
    readonly length: number,
    parent: T.Object3D,
  ) {
    parent.add(this.group);
  }
  private static x = new T.Vector3();
  private static y = new T.Vector3();
  private static z = new T.Vector3();
  private static m = new T.Matrix4();
  aim(from: T.Vector3, to: T.Vector3, pole: T.Vector3) {
    const { x, y, z, m } = Bone;
    y.subVectors(to, from);
    const len = y.length();
    if (len < 1e-6) return;
    y.multiplyScalar(1 / len);
    z.subVectors(pole, from);
    z.addScaledVector(y, -z.dot(y));
    if (z.lengthSq() < 1e-10) z.set(0, 0, 1).addScaledVector(y, -y.z);
    z.normalize();
    x.crossVectors(y, z);
    m.makeBasis(x, y, z);
    this.group.position.copy(from);
    this.group.quaternion.setFromRotationMatrix(m);
  }
}
const scratch = {
  a: new T.Vector3(),
  b: new T.Vector3(),
  e: new T.Vector3(),
  m: new T.Vector3(),
};
/** Analytic two-bone IK: sets `upper` from root to the joint and `lower` on to the target. */
function twoBone(
  upper: Bone,
  lower: Bone,
  root: T.Vector3,
  target: T.Vector3,
  pole: T.Vector3,
  joint: T.Vector3,
) {
  const { e, m } = scratch;
  const l1 = upper.length,
    l2 = lower.length;
  e.subVectors(target, root);
  const d = T.MathUtils.clamp(e.length(), Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
  e.normalize();
  const cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d),
    sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  m.subVectors(pole, root);
  m.addScaledVector(e, -m.dot(e));
  if (m.lengthSq() < 1e-10) m.set(0, 1, 0);
  m.normalize();
  joint
    .copy(root)
    .addScaledVector(e, l1 * cosA)
    .addScaledVector(m, l1 * sinA);
  upper.aim(root, joint, pole);
  scratch.a.copy(root).addScaledVector(e, d);
  lower.aim(joint, scratch.a, pole);
}
/** Rider dimensions (m) for a ~1.75 m, 72 kg rider in leathers. */
export const RIDER = Object.freeze({
  hipWidth: 0.1,
  shoulderWidth: 0.185,
  spine: 0.48,
  upperArm: 0.29,
  forearm: 0.28,
  thigh: 0.44,
  shin: 0.44,
  neck: 0.12,
});
export class Rider {
  readonly root = new T.Group();
  /** Bike-frame anchors the bike supplies each frame: seat hip centre, the two
   * grips (after steering) and the two foot pegs. Index 0 left (+X), 1 right. */
  readonly seat = new T.Vector3(0, 0.3, -0.24);
  readonly grips = [new T.Vector3(0.3, 0.24, 0.35), new T.Vector3(-0.3, 0.24, 0.35)];
  /** Cylinder axes in this same sprung frame; supplied from the real bars. */
  readonly gripAxes = [new T.Vector3(1, 0, 0), new T.Vector3(1, 0, 0)];
  /** Blade contact points in this rider-root frame, supplied by the GP lever. */
  brakeFingerTargets?: readonly [T.Vector3, T.Vector3];
  readonly pegs = [new T.Vector3(0.17, -0.2, -0.3), new T.Vector3(-0.17, -0.2, -0.3)];
  /** GP road plane: this frame's origin height above the road when upright,
   * and the tyre crown radius the chassis rolls on. Set from the machine. */
  readonly ground = { height: 0.62, crown: 0.08 };
  private readonly torso = new T.Group();
  private readonly head = new T.Group();
  private readonly headShadow = new T.Group();
  private readonly upperArms: Bone[];
  private readonly forearms: Bone[];
  private readonly thighs: Bone[];
  private readonly shins: Bone[];
  private readonly hands: T.Group[] = [];
  private readonly feet: T.Group[] = [];
  private readonly bootCuffs: (T.Object3D | undefined)[] = [];
  private readonly motocrossGarments: MotocrossGarmentMesh[] = [];
  private readonly motocrossBoots: MotocrossBootSkin[] = [];
  private readonly motocrossContact = new T.Vector3();
  private readonly motocrossShoulders: T.Bone[] = [];
  private readonly motocrossMotion: MotocrossRiderMotion = {
    pelvisDrop: 0,
    pelvisBack: 0,
    torsoPitch: 0,
    elbowLift: 0,
    gazePitch: 0,
  };
  private readonly gpGarments: GpRiderGarment[] = [];
  private readonly gpSpine?: GpRiderSpine;
  private readonly gpPosture = new GpRiderPosture();
  private readonly gpScratch = [new T.Vector3(), new T.Vector3()];
  private readonly gpPelvisFrame = new T.Quaternion();
  private readonly gpChestInverse = new T.Quaternion();
  private readonly gpPlantFrame = new T.Quaternion();
  private readonly gpLeanFrame = new T.Quaternion();
  private readonly gpPlantEuler = new T.Euler();
  private readonly motocrossSpine?: MotocrossRiderSpine;
  private readonly gpBrakeFingers?: GpBrakeFingers;
  private readonly exteriorForearms = [0, 1].map(() => ({
    position: new T.Vector3(),
    quaternion: new T.Quaternion(),
  }));
  private readonly exteriorUpperArms = [0, 1].map(() => ({
    position: new T.Vector3(),
    quaternion: new T.Quaternion(),
  }));
  private motocrossFirstPerson = false;
  private riding = false;
  private readonly materials: T.Material[] = [];
  private readonly q = new T.Quaternion();
  private readonly euler = new T.Euler();
  private readonly v = [0, 1, 2, 3, 4, 5].map(() => new T.Vector3());
  constructor(
    colours: RiderColours,
    readonly detail: RiderDetail = 'high',
    readonly kit: RiderKit = 'leathers',
    readonly raceNumber = 2,
    readonly gp = false,
  ) {
    const sides = detail === 'high' ? 20 : detail === 'mid' ? 12 : 6;
    const mx = kit === 'motocross';
    const gpSuit = gp && !mx && detail !== 'far';
    // Textile kit: matte woven fabric with a soft sheen, no lacquer.
    const leather = new T.MeshPhysicalMaterial(
      mx
        ? {
            color: colours.primary,
            roughness: 0.84,
            sheen: 0.35,
            sheenRoughness: 0.7,
            name: 'Rider jersey and pants (textile)',
          }
        : {
            color: colours.primary,
            roughness: 0.48,
            metalness: 0.02,
            clearcoat: 0.25,
            clearcoatRoughness: 0.55,
            name: 'Rider leathers',
          },
    );
    const panel = new T.MeshPhysicalMaterial(
      mx
        ? {
            color: colours.secondary,
            roughness: 0.86,
            sheen: 0.3,
            sheenRoughness: 0.75,
            name: 'Rider kit panels (textile)',
          }
        : {
            color: colours.secondary,
            roughness: 0.52,
            clearcoat: 0.2,
            clearcoatRoughness: 0.6,
            name: 'Rider leather panels',
          },
    );
    const armour = new T.MeshStandardMaterial({
      color: mx ? 0x34393a : 0x333b43,
      roughness: mx ? 0.74 : 0.49,
      metalness: mx ? 0.02 : 0.08,
      name: mx ? 'Rider armour caps' : 'Rider moulded armour caps',
    });
    const glove = new T.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 0.62 });
    const slider = new T.MeshStandardMaterial({
      color: 0x454b51,
      roughness: 0.68,
      name: 'Knee slider (scuffed polymer)',
    });
    const helmet = new T.MeshPhysicalMaterial({
      color: colours.primary,
      roughness: 0.22,
      metalness: 0.05,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
      name: 'Rider helmet shell',
    });
    const visor = new T.MeshPhysicalMaterial({
      color: 0x5e6f79,
      roughness: 0.1,
      metalness: 0.85,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
      name: 'Tinted visor',
    });
    if (!mx && detail !== 'far') {
      // Smoked polymer is a dark dielectric, not a grey metal mirror. Keep
      // the actual visor and eye-port geometry and the near-camera shadow.
      visor.color.setHex(0x071018);
      visor.metalness = 0;
      visor.roughness = 0.13;
      visor.clearcoat = 0.82;
      visor.clearcoatRoughness = 0.09;
      helmet.metalness = 0;
      helmet.roughness = 0.29;
      helmet.clearcoat = 0.78;
      helmet.clearcoatRoughness = 0.18;
      if (!gpSuit) {
        const surface = bikeSurfaceMaps('leather');
        Object.assign(leather, surface);
        Object.assign(panel, surface);
      }
      // GP hide now uses its metre-space finish. Retaining UV hide maps here
      // stretches their grain across the airbag dye swatch and duplicates two
      // texture allocations per rider/LOD without adding physical detail.
      leather.normalScale.set(0.09, 0.09);
      panel.normalScale.set(0.08, 0.08);
      leather.roughness = 0.72;
      leather.clearcoat = 0.035;
      panel.roughness = 0.75;
      panel.clearcoat = 0.025;
      if (gpSuit) {
        leather.roughness = 0.63;
        leather.clearcoat = 0.055;
        leather.clearcoatRoughness = 0.43;
        panel.roughness = 0.69;
      }
      Object.assign(glove, bikeSurfaceMaps('seat'));
      glove.normalScale.set(0.2, 0.2);
      slider.roughness = 0.79;
      if (gp) {
        // REF_018/056: deep gloss lacquer over the shell paint, and a dark
        // iridium-coated visor that mirrors the sky with a thin-film tint.
        helmet.roughness = 0.3;
        helmet.clearcoat = 1;
        helmet.clearcoatRoughness = 0.035;
        visor.color.setHex(0x10161d);
        visor.metalness = 0.62;
        visor.roughness = 0.045;
        visor.clearcoat = 1;
        visor.clearcoatRoughness = 0.02;
        visor.iridescence = 0.85;
        visor.iridescenceIOR = 1.75;
        visor.iridescenceThicknessRange = [260, 430];
        visor.name = 'GP iridium visor';
      }
    }
    const flex = new T.MeshStandardMaterial({
      color: 0x151a20,
      roughness: 0.91,
      name: 'Rider stretch fabric and seams',
    });
    this.materials.push(leather, panel, armour, glove, slider, helmet, visor, flex);
    const torsoLeather = leather.clone();
    const mxBoot = mx
      ? new T.MeshStandardMaterial({
          color: 0xe1ddd2,
          roughness: 0.65,
          name: 'Motocross moulded boot shell',
        })
      : null;
    const mxTrim = mx
      ? new T.MeshPhysicalMaterial({
          color: colours.accent,
          roughness: 0.38,
          clearcoat: 0.2,
          name: 'Motocross equipment trim',
        })
      : null;
    const mxGloveBack = mx
      ? new T.MeshPhysicalMaterial({
          color: colours.primary,
          roughness: 0.83,
          sheen: 0.25,
          sheenRoughness: 0.8,
          name: 'Motocross flexible glove textile',
        })
      : null;
    if (mxBoot && mxTrim) this.materials.push(mxBoot, mxTrim);
    if (mxGloveBack) this.materials.push(mxGloveBack);
    if (mx) {
      // A coated polycarbonate goggle lens has a dark eye cavity behind it.
      // The old pale, mostly metallic visor turned into an opaque cyan slab.
      // Keep the clear surface reflection while the smoke tint stays dark.
      visor.color.setHex(0x123034);
      visor.metalness = 0.12;
      visor.roughness = 0.12;
      visor.clearcoat = 0.95;
      visor.clearcoatRoughness = 0.06;
      visor.iridescence = 0.28;
      visor.iridescenceIOR = 1.32;
      visor.iridescenceThicknessRange = [180, 290];
      visor.name = 'Motocross smoked coated goggle lens';
      helmet.metalness = 0;
      helmet.roughness = 0.31;
      helmet.clearcoat = 0.65;
      helmet.clearcoatRoughness = 0.16;
      helmet.name = 'Motocross composite helmet shell';
      tagMudExposure(helmet, 0.55);
      tagMudExposure(visor, 0.25);
      tagMudExposure(torsoLeather, 0.72);
    }
    if (mx && detail !== 'far') {
      const weave = motocrossFabricMaps();
      const sleeve = motocrossGraphics(colours, 'sleeve', raceNumber);
      for (const material of [leather, panel, torsoLeather]) {
        Object.assign(material, weave);
        material.normalScale.set(0.22, 0.22);
        material.color.setHex(0xffffff);
      }
      leather.map = panel.map = sleeve;
      torsoLeather.map = motocrossGraphics(colours, 'jersey', raceNumber);
      helmet.map = motocrossGraphics(colours, 'helmet', raceNumber);
      helmet.color.setHex(0xffffff);
      Object.assign(mxGloveBack!, weave);
      mxGloveBack!.normalScale.set(0.18, 0.18);
      Object.assign(glove, bikeSurfaceMaps('seat'));
      glove.normalScale.set(0.16, 0.16);
      glove.roughness = 0.78;
      Object.assign(mxBoot!, bikeSurfaceMaps('paint'));
      mxBoot!.normalScale.set(0.15, 0.15);
    }
    if (!mx && detail !== 'far') {
      leather.map = riderPanelTexture(colours, false, gpSuit);
      leather.color.setHex(0xffffff);
      torsoLeather.map = riderPanelTexture(colours, true, gpSuit);
      torsoLeather.color.setHex(0xffffff);
      helmet.map = gp ? gpHelmetLivery(colours, raceNumber) : helmetLiveryTexture(colours);
      helmet.color.setHex(0xffffff);
    }
    this.materials.push(torsoLeather);
    if (!mx && detail !== 'far')
      for (const material of [leather, panel, torsoLeather]) {
        if (gpSuit)
          installGpSuitFinish(
            material,
            material !== panel,
            material === torsoLeather ? 'torso' : material === leather ? 'limb' : 'plain',
          );
        else installGpLeatherFinish(material);
      }
    for (const m of [leather, panel, torsoLeather])
      tagWeatherSurface(m, mx ? 'fabric' : 'leather', 0.85);
    tagWeatherSurface(flex, 'fabric', 0.65);
    tagWeatherSurface(glove, 'leather', 0.8);
    if (mxGloveBack) tagWeatherSurface(mxGloveBack, 'fabric', 0.85);
    tagWeatherSurface(helmet, 'paint');
    tagWeatherSurface(armour, 'metal', 0.7);
    tagWeatherSurface(slider, 'paint', 0.6);
    this.root.name = 'Rider';
    this.torso.name = 'Rider torso';
    this.root.add(this.torso);
    if (gpSuit) this.gpSpine = new GpRiderSpine(this.root, this.torso);
    if (mx) this.motocrossSpine = new MotocrossRiderSpine(this.root, this.torso);
    const upperTorso = this.gpSpine?.chest ?? this.motocrossSpine?.chest ?? this.torso;
    // Torso: pelvis at the origin, spine along +Y, chest forward (+Z).
    const torsoSections: readonly BodySection[] = mx
      ? [
          [-0.06, 0, 0.15, 0.1, 0.09],
          [0.05, 0, 0.165, 0.11, 0.1],
          [0.17, 0.01, 0.16, 0.1, 0.1],
          [0.3, 0.02, 0.17, 0.11, 0.1],
          [0.42, 0.02, 0.2, 0.11, 0.09],
          [0.5, 0.02, 0.17, 0.08, 0.08],
          [0.55, 0.03, 0.08, 0.05, 0.05],
        ]
      : gpSuit
        ? GP_TORSO_PROFILE
        : [
            [-0.06, 0, 0.15, 0.1, 0.09],
            [0.05, 0, 0.165, 0.11, 0.1],
            [0.17, 0.01, 0.145, 0.093, 0.092],
            [0.3, 0.02, 0.172, 0.128, 0.105],
            [0.42, 0.02, 0.2, 0.128, 0.1],
            [0.5, 0.02, 0.17, 0.08, 0.08],
            [0.55, 0.03, 0.08, 0.05, 0.05],
          ];
    const torsoGeometry = mx
      ? motocrossGarmentGeometry('jersey', detail)
      : gpSuit
        ? gpTorsoGeometry(detail)
        : bodyLoft(torsoSections, sides);
    if (gpSuit) shapeGpSuitGeometry(torsoGeometry, 'torso');
    const torsoMesh = part(this.torso, torsoGeometry, torsoLeather);
    torsoMesh.name = mx ? 'Motocross sculpted textile torso' : 'Rider leather torso';
    this.motocrossSpine?.bind(torsoMesh);
    if (mx) {
      part(this.torso, motocrossGarmentGeometry('seat', detail), leather).name =
        'Motocross separate trouser waist';
      const neck = part(this.torso, new T.CylinderGeometry(0.041, 0.046, 0.075, sides), flex);
      neck.name = 'Motocross neck liner above textile collar';
      neck.position.set(0, 0.56, 0.029);
      this.motocrossSpine!.bind(neck);
    }
    // Aero hump (spine protector and airbag housing) on the back.
    if (detail !== 'far' && !mx && !gpSuit) {
      const hump = bodyLoft(
        [
          [0.12, -0.075, 0.012, 0.016, 0.018],
          [0.23, -0.1, 0.068, 0.025, 0.046],
          [0.36, -0.104, 0.086, 0.024, 0.052],
          [0.46, -0.085, 0.072, 0.021, 0.048],
          [0.54, -0.048, 0.032, 0.014, 0.027],
          [0.57, -0.035, 0.003, 0.003, 0.004],
        ],
        sides,
      );
      part(this.torso, hump, panel).name = 'Rider aero hump';
    }
    // Contrast side panels and a shoulder cap per side.
    for (const side of [1, -1]) {
      if (detail === 'far') break;
      if (mx) {
        // Printed side inserts already follow the baked garment UV. A second
        // capsule here used to protrude from the ribs like rigid body armour.
        // The cloth shoulder saddle is part of the same continuous surface.
        continue;
      } else {
        const centreAngle = side > 0 ? 0 : Math.PI;
        const flank = part(
          this.torso,
          leatherPanelGeometry(
            torsoSections,
            0.07,
            0.425,
            0,
            detail === 'high' ? 12 : 8,
            [centreAngle - 0.43, centreAngle + 0.43],
            0.8,
          ),
          panel,
        );
        flank.name = 'Conformal torso leather side panel';
      }
      // Low-profile shoulder armour moulded into the leathers.
      const cap = part(
        this.torso,
        new T.SphereGeometry(0.055, sides, sides / 2),
        mx ? panel : armour,
      );
      cap.position.set(side * 0.175, 0.46, 0.0);
      cap.scale.set(0.75, 0.55, 1.0);
    }
    if (mx && detail !== 'far') {
      const collar = part(
        this.torso,
        new T.TorusGeometry(0.061, 0.007, 6, detail === 'high' ? 32 : 16),
        flex,
      );
      collar.name = 'Motocross rib-knit jersey collar';
      collar.rotation.x = Math.PI / 2;
      collar.position.set(0, 0.536, 0.027);
      collar.scale.y = 0.88;
      // The neck opening follows the upper jersey through spine flexion.
      // Keep the skin under the torso's first-person visibility boundary.
      this.motocrossSpine!.bind(collar);
    }
    if (detail !== 'far' && !mx) {
      // A turned leather collar closes the neck opening instead of leaving
      // the torso and helmet as two unrelated glossy forms.
      const collar = part(this.torso, new T.TorusGeometry(0.062, 0.009, 6, 24), flex);
      collar.rotation.x = Math.PI / 2;
      collar.position.set(0, 0.541, 0.03);
      collar.scale.y = 0.82;
      const lip = part(this.torso, new T.TorusGeometry(0.064, 0.003, 5, 24), panel);
      lip.rotation.x = Math.PI / 2;
      lip.position.set(0, 0.549, 0.03);
      lip.scale.y = 0.82;
      if (detail === 'high') {
        const zip = part(
          this.torso,
          new T.TubeGeometry(
            new T.CatmullRomCurve3([
              new T.Vector3(0, 0.06, 0.113),
              new T.Vector3(0, 0.2, 0.117),
              new T.Vector3(0, 0.37, 0.151),
              new T.Vector3(0, 0.485, 0.108),
            ]),
            18,
            0.0016,
            4,
            false,
          ),
          flex,
        );
        zip.name = 'Recessed front zip seam';
        const pull = part(
          this.torso,
          new RoundedBoxGeometry(0.008, 0.021, 0.004, 1, 0.002),
          armour,
        );
        pull.position.set(0, 0.473, 0.116);
      }
    }
    // Head and helmet: neck pivot at the top of the spine. The GP head turns
    // about the atlas at the end of an articulated neck (rideGp).
    const gpHelmet = gp && !mx;
    this.head.name = 'Rider head and helmet';
    this.head.position.set(0, RIDER.spine + (mx ? 0.078 : 0.04), 0.03);
    if (gpHelmet) this.head.position.copy(GP_NECK_BASE).addScaledVector(Y, GP_NECK_LENGTH);
    upperTorso.add(this.head);
    const shell = part(
      this.head,
      gpHelmet
        ? gpHelmetShell(detail)
        : mx
          ? motocrossHelmetShell(detail)
          : detail === 'far'
            ? new T.SphereGeometry(0.14, 8, 6)
            : helmetShell(),
      helmet,
    );
    if (gpHelmet) shell.name = 'GP elongated race helmet shell';
    else shell.position.set(0, 0.15, 0.02);
    if (!mx) {
      // The followed rider's helmet surrounds the onboard lens and is hidden
      // from that view. Retain its ground shadow with a cheap closed silhouette;
      // it writes neither colour nor depth to the normal camera pass. Three's
      // shadow pass uses its own opaque depth material (alphaTest remains zero).
      const shadowOnly = new T.MeshBasicMaterial({
        name: 'Onboard helmet shadow only',
        transparent: true,
        opacity: 0,
        colorWrite: false,
        depthWrite: false,
      });
      this.materials.push(shadowOnly);
      this.headShadow.name = 'Onboard helmet shadow proxy';
      this.headShadow.visible = false;
      this.headShadow.position.copy(this.head.position);
      upperTorso.add(this.headShadow);
      const silhouette = part(this.headShadow, new T.SphereGeometry(0.14, 18, 12), shadowOnly);
      silhouette.position.copy(shell.position);
      silhouette.scale.set(0.98, 1.02, 1.07);
      if (gpHelmet) {
        silhouette.position.fromArray(GP_HELMET_CENTRE);
        silhouette.scale.set(0.89, 1.04, 1.1);
      }
      silhouette.receiveShadow = false;
    }
    if (mx) {
      addMotocrossHelmet(this.head, detail, helmet, visor, flex, mxTrim!);
    } else if (gpHelmet) {
      if (detail !== 'far')
        addGpHelmetDetails(this.head, detail, {
          shell: helmet,
          trim: armour,
          liner: flex,
          visor,
        });
    } else if (detail !== 'far') {
      const shield = part(this.head, visorGeometry(0.004), visor);
      shield.position.copy(shell.position);
      // Rear aero spoiler on the helmet.
      const fin = part(this.head, helmetSpoilerGeometry(detail === 'high' ? 16 : 8, 4), helmet);
      fin.position.copy(shell.position);
      // Conformal gasket follows the existing shaped eye port; no floating visor band.
      const outline: T.Vector3[] = [];
      for (const edge of [1, 0])
        for (let i = 0; i <= 40; i++) {
          const t = edge ? i / 40 : 1 - i / 40;
          const phi = T.MathUtils.lerp(VISOR_PHI[0], VISOR_PHI[1], t);
          outline.push(helmetPoint(visorBounds(phi)[edge], phi, 0.0045));
        }
      const seal = part(
        this.head,
        new T.TubeGeometry(new T.CatmullRomCurve3(outline, true), 80, 0.002, 5, true),
        flex,
      );
      seal.position.copy(shell.position);
      const brow = part(
        this.head,
        helmetPatch(0.048, 0.07, 0.15, Math.PI - 0.15, 0.0015, 3, 32),
        panel,
      );
      brow.position.copy(shell.position);
      for (const side of [-1, 1]) {
        const pivot = part(this.head, new T.CylinderGeometry(0.01, 0.01, 0.004, 12), glove);
        pivot.rotation.z = Math.PI / 2;
        pivot.position.set(side * 0.137, 0.153, 0.035);
        const vent = part(this.head, new RoundedBoxGeometry(0.061, 0.012, 0.006, 2, 0.003), flex);
        vent.position.set(side * 0.033, 0.095, 0.173);
        vent.rotation.y = side * 0.2;
      }
    }
    const limb = (
      shape: LimbShape,
      r0: number,
      r1: number,
      length: number,
      material: T.Material,
    ) => {
      const bone = new Bone(length, this.root);
      // GP leathers and MX textiles span the solved bones below. A second
      // capped volume here would poke through the continuous skin at a bend.
      if (mx || gpSuit) return bone;
      const geometry =
        detail !== 'far'
          ? bodyLoft(roadLimbSections(shape, length), sides, 1)
          : limbGeometry(r0, r1, length, sides);
      const segment = part(bone.group, geometry, material);
      segment.name = `Rider ${shape} leather volume`;
      return bone;
    };
    this.upperArms = [0, 1].map(() => limb('upper-arm', 0.046, 0.038, RIDER.upperArm, leather));
    this.forearms = [0, 1].map(() => limb('forearm', 0.039, 0.031, RIDER.forearm, panel));
    this.thighs = [0, 1].map(() => limb('thigh', 0.072, 0.052, RIDER.thigh, leather));
    this.shins = [0, 1].map(() => limb('shin', 0.05, 0.037, RIDER.shin, panel));
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      if (mx || gp) {
        const label = i === 0 ? 'left' : 'right';
        const family = mx ? 'Motocross' : 'GP';
        this.upperArms[i].group.name = `${family} ${label} upper arm`;
        this.forearms[i].group.name = `${family} ${label} forearm`;
        this.thighs[i].group.name = `${family} ${label} thigh`;
        this.shins[i].group.name = `${family} ${label} shin`;
        if (mx) {
          for (const [upper, lower, kind] of [
            [this.upperArms[i], this.forearms[i], 'sleeve'],
            [this.thighs[i], this.shins[i], 'pants'],
          ] as const) {
            const shoulder = kind === 'sleeve' ? new T.Bone() : undefined;
            if (shoulder) {
              shoulder.name = `Motocross ${label} jersey armhole`;
              this.motocrossShoulders.push(shoulder);
            }
            const garment = addMotocrossGarment(
              this.root,
              upper.group,
              lower.group,
              upper.length,
              lower.length,
              kind,
              detail,
              leather,
              shoulder,
            );
            garment.name = `Motocross continuous ${label} ${kind}`;
            this.motocrossGarments.push(garment);
          }
        } else if (gpSuit) {
          for (const [upper, lower, kind, attachment] of [
            [
              this.upperArms[i],
              this.forearms[i],
              'sleeve',
              [side * RIDER.shoulderWidth, RIDER.spine - 0.04, 0],
            ],
            [this.thighs[i], this.shins[i], 'pants', [side * RIDER.hipWidth, 0, 0]],
          ] as const) {
            const garment = new GpRiderGarment(
              this.root,
              kind === 'sleeve' ? upperTorso : this.torso,
              upper.group,
              lower.group,
              upper.length,
              lower.length,
              attachment,
              kind,
              detail,
              leather,
            );
            garment.mesh.name = `GP continuous fitted ${label} ${kind}`;
            this.gpGarments.push(garment);
          }
        }
      }
      if (detail !== 'far' && !mx && !gpSuit) {
        const foldSides = detail === 'high' ? 12 : 8;
        const shoulderStretch = part(
          this.upperArms[i].group,
          leatherPanelGeometry(
            roadLimbSections('upper-arm', RIDER.upperArm),
            0.012,
            0.094,
            7,
            foldSides,
          ),
          flex,
        );
        shoulderStretch.name = 'Conforming shoulder accordion insert';
        const hipStretch = part(
          this.thighs[i].group,
          leatherPanelGeometry(roadLimbSections('thigh', RIDER.thigh), 0.042, 0.157, 9, foldSides),
          flex,
        );
        hipStretch.name = 'Conforming hip accordion insert';
        const elbowFlex = part(
          this.upperArms[i].group,
          new T.SphereGeometry(0.039, sides, sides / 2),
          flex,
        );
        elbowFlex.position.y = RIDER.upperArm;
        elbowFlex.scale.set(0.94, 0.85, 0.94);
        const kneeFlex = part(
          this.thighs[i].group,
          new T.SphereGeometry(0.053, sides, sides / 2),
          flex,
        );
        kneeFlex.position.y = RIDER.thigh;
        kneeFlex.scale.set(0.95, 0.8, 0.95);
        for (const [bone, shape, len] of [
          [this.upperArms[i], 'upper-arm', RIDER.upperArm],
          [this.thighs[i], 'thigh', RIDER.thigh],
        ] as const) {
          const sections = roadLimbSections(shape, len),
            ys = sections.map((s) => s[0]);
          const seamPoints = [0.025, len * 0.32, len * 0.65, len - 0.025].map((y) => {
            const [centre, width, back] = [1, 2, 4].map((k) =>
              sampleProfile(
                ys,
                sections.map((s) => s[k]),
                y,
              ),
            );
            return new T.Vector3(
              side * (width + 0.0012) * 0.7,
              y,
              centre - (back + 0.0012) * 0.714,
            );
          });
          const seam = part(
            bone.group,
            new T.TubeGeometry(new T.CatmullRomCurve3(seamPoints), 12, 0.0018, 4, false),
            panel,
          );
          seam.name = 'Stitched leather panel boundary';
        }
      }
      if (detail !== 'far' && !mx) {
        // The armour sits under shaped leather. Only the small replaceable
        // polymer pads are exposed; a metallic sphere would read as a hinge.
        if (!gpSuit) {
          const elbow = part(
            this.forearms[i].group,
            bodyLoft(
              [
                [-0.028, -0.02, 0.012, 0.013, 0.016],
                [0.004, -0.025, 0.035, 0.02, 0.031],
                [0.039, -0.025, 0.038, 0.022, 0.037],
                [0.082, -0.021, 0.031, 0.018, 0.029],
                [0.118, -0.01, 0.015, 0.012, 0.015],
              ],
              sides,
              1,
            ),
            panel,
          );
          elbow.name = 'Leather-covered elbow protector';
        }
        const elbowPad = part(
          this.forearms[i].group,
          new RoundedBoxGeometry(0.037, 0.053, 0.009, 2, 0.004),
          slider,
        );
        elbowPad.position.set(side * 0.008, 0.035, -0.063);
        elbowPad.rotation.y = side * 0.12;
        if (!gpSuit) {
          const knee = part(
            this.shins[i].group,
            bodyLoft(
              [
                [-0.044, 0.025, 0.017, 0.02, 0.019],
                [-0.015, 0.025, 0.047, 0.048, 0.031],
                [0.036, 0.019, 0.054, 0.052, 0.037],
                [0.095, 0.009, 0.047, 0.047, 0.035],
                [0.158, 0.005, 0.028, 0.032, 0.024],
                [0.18, 0.004, 0.006, 0.009, 0.009],
              ],
              sides,
              0.92,
            ),
            panel,
          );
          knee.name = 'Leather-covered knee and shin protector';
        }
        const backing = part(
          this.shins[i].group,
          new RoundedBoxGeometry(0.007, 0.1, 0.082, 2, 0.003),
          glove,
        );
        backing.position.set(side * 0.054, 0.035, 0.007);
        const puck = part(this.shins[i].group, kneeSliderGeometry(), slider);
        puck.name = 'Shaped replaceable polymer knee slider';
        puck.rotation.y = (side * Math.PI) / 2;
        puck.position.set(side * 0.062, 0.035, 0.007);
      }
      const hand = new T.Group();
      if (mx) hand.name = `Motocross ${i === 0 ? 'left' : 'right'} hand`;
      else if (gp) hand.name = `GP ${i === 0 ? 'left' : 'right'} hand`;
      if (mx) addMotocrossGlove(hand, detail, side, glove, mxGloveBack!, flex);
      else if (gp && detail !== 'far') {
        const fingers = addGpRacingGlove(
          hand,
          detail,
          side,
          { leather: glove, panel, armour },
          detail === 'high' && i === 1,
        );
        if (fingers) this.gpBrakeFingers = fingers;
      } else
        part(
          hand,
          new RoundedBoxGeometry(0.069, 0.047, 0.079, detail === 'far' ? 1 : 3, 0.017),
          glove,
        ).position.set(0, 0.0, 0.016);
      if (detail !== 'far' && !mx && !gp) {
        for (let finger = 0; finger < 4; finger++) {
          const x = -0.025 + finger * 0.0165;
          const points = [
            new T.Vector3(x, 0.013, 0.042),
            new T.Vector3(x, 0.013, 0.07),
            new T.Vector3(x, -0.007, 0.079),
            new T.Vector3(x, -0.025, 0.061),
          ];
          part(hand, new T.TubeGeometry(new T.CatmullRomCurve3(points), 9, 0.007, 6, false), glove);
        }
        const thumb = part(hand, limbGeometry(0.01, 0.008, 0.037, 8), glove);
        thumb.position.set(side * 0.036, -0.01, 0.007);
        thumb.rotation.set(0.85, 0, side * 0.4);
      }
      if (detail === 'high' && !mx && !gp) {
        const knuckleBacking = part(
          hand,
          new RoundedBoxGeometry(0.062, 0.008, 0.027, 2, 0.006),
          panel,
        );
        knuckleBacking.position.set(0, 0.024, 0.025);
        for (let finger = 0; finger < 4; finger++) {
          const knuckle = part(hand, new T.SphereGeometry(0.0085, 10, 6), armour);
          knuckle.scale.set(1, 0.65, 1.15);
          knuckle.position.set(-0.024 + finger * 0.016, 0.03, 0.025);
        }
      }
      this.forearms[i].group.add(hand);
      hand.position.set(0, RIDER.forearm + 0.02, 0);
      this.hands.push(hand);
      const foot = new T.Group();
      if (mx) foot.name = `Motocross ${i === 0 ? 'left' : 'right'} boot`;
      else if (gp) foot.name = `GP ${i === 0 ? 'left' : 'right'} foot`;
      // The planted boot frame has +Y down, +Z forward and +X toward bike
      // right. Mirror its lateral buckles so they remain outside both legs.
      if (mx)
        this.motocrossBoots.push(addMotocrossBoot(foot, detail, -side, mxBoot!, flex, armour));
      else
        foot.add(
          gpRacingBoot(detail, side, { leather: glove, panel, sole: flex, armour, slider }, gp),
        );
      this.shins[i].group.add(foot);
      foot.position.set(0, RIDER.shin + 0.02, 0);
      this.feet.push(foot);
      this.bootCuffs.push(foot.getObjectByName('GP ankle-hinged boot cuff'));
    }
    this.attachMotocrossShoulders(false);
    this.gpSpine?.bindTorso();
    for (const group of [
      this.torso,
      this.head,
      ...this.hands,
      ...this.feet,
      ...this.upperArms.map((b) => b.group),
      ...this.forearms.map((b) => b.group),
      ...this.thighs.map((b) => b.group),
      ...this.shins.map((b) => b.group),
    ])
      batchBikeRigidMeshes(group);
  }
  /** Exclude the followed rider's own helmet from the first-person lens.
   * A stable MX eye needs its own arm presentation: sleeves enter from below
   * the camera, with the same wrists on the actual steered bar grips. */
  setFirstPerson(active: boolean, motocross = false) {
    this.head.visible = !active;
    this.headShadow.visible = active && this.kit !== 'motocross';
    this.headShadow.quaternion.copy(this.head.quaternion);
    if (this.kit === 'motocross') {
      const previous = this.motocrossFirstPerson;
      this.motocrossFirstPerson = active && motocross;
      this.torso.visible = !this.motocrossFirstPerson;
      if (previous !== this.motocrossFirstPerson)
        this.attachMotocrossShoulders(this.motocrossFirstPerson);
      for (const arm of this.upperArms) arm.group.visible = true;
      if (this.motocrossFirstPerson && this.riding) this.onboardArms();
      else if (previous)
        for (let i = 0; i < this.forearms.length; i++) {
          this.forearms[i].group.position.copy(this.exteriorForearms[i].position);
          this.forearms[i].group.quaternion.copy(this.exteriorForearms[i].quaternion);
          this.upperArms[i].group.position.copy(this.exteriorUpperArms[i].position);
          this.upperArms[i].group.quaternion.copy(this.exteriorUpperArms[i].quaternion);
          if (this.riding) this.attachMotocrossHand(i);
        }
      for (const garment of this.motocrossGarments) garment.updatePose();
    }
  }
  private attachMotocrossShoulders(onboard: boolean) {
    for (let i = 0; i < this.motocrossShoulders.length; i++) {
      const shoulder = this.motocrossShoulders[i],
        side = i === 0 ? 1 : -1;
      if (onboard) {
        // The whole armhole follows the lowered first-person presentation;
        // a hidden torso must not pull this broader sleeve through the lens.
        this.upperArms[i].group.add(shoulder);
        shoulder.position.set(0, 0, 0);
        shoulder.quaternion.identity();
      } else {
        (this.motocrossSpine?.chest ?? this.torso).add(shoulder);
        shoulder.position.set(side * (RIDER.shoulderWidth - 0.025), RIDER.spine - 0.045, 0.008);
        // Garment +Y exits the side of the jersey, +Z faces the upper shoulder.
        // The root sits inside its armhole; the rest blends into the solved arm.
        shoulder.rotation.set(0, (-side * Math.PI) / 2, (-side * Math.PI) / 2, 'ZYX');
      }
    }
  }
  private captureExteriorArms() {
    for (let i = 0; i < this.forearms.length; i++) {
      this.exteriorForearms[i].position.copy(this.forearms[i].group.position);
      this.exteriorForearms[i].quaternion.copy(this.forearms[i].group.quaternion);
      this.exteriorUpperArms[i].position.copy(this.upperArms[i].group.position);
      this.exteriorUpperArms[i].quaternion.copy(this.upperArms[i].group.quaternion);
    }
  }
  private attachMotocrossHand(i: number) {
    // This cylinder-frame math is also used by the GP rig; MX supplies its
    // own actual bar axis and its own glove's wrist/grip landmarks.
    gpGripFrame(this.gripAxes[i], this.q);
    gpAttachAtJoint(
      this.hands[i],
      this.forearms[i].group.quaternion,
      RIDER.forearm,
      this.q,
      MX_GLOVE_WRIST,
    );
  }
  private onboardArms() {
    const [elbow, pole, offset, shoulder, wrist] = this.v;
    for (let i = 0; i < this.forearms.length; i++) {
      const side = i === 0 ? 1 : -1;
      // Preserve the authored forearm length and the exact hand contact. The
      // exterior standing elbow pole lies above this fixed bike-frame camera;
      // the first-person pole instead carries each sleeve out of the lower view.
      gpGripFrame(this.gripAxes[i], this.q);
      gpContactJoint(this.grips[i], this.q, MX_GLOVE_GRIP, MX_GLOVE_WRIST, wrist);
      offset.set(side * 0.09, -0.13, -0.23).normalize();
      elbow.copy(wrist).addScaledVector(offset, RIDER.forearm);
      offset.set(side * 0.015, -0.16, -0.24).normalize();
      shoulder.copy(elbow).addScaledVector(offset, RIDER.upperArm);
      pole.copy(wrist);
      pole.z += 1;
      this.upperArms[i].aim(shoulder, elbow, pole);
      this.forearms[i].aim(elbow, wrist, pole);
      this.attachMotocrossHand(i);
    }
    for (const garment of this.motocrossGarments) garment.updatePose();
  }
  /** Riding pose in the bike's (sprung) frame. */
  ride(pose: RiderPose) {
    this.riding = true;
    if (this.gp && this.kit !== 'motocross') {
      this.rideGp(pose);
      return;
    }
    const lean = pose.lean,
      offset = pose.offset,
      tuck = T.MathUtils.clamp(pose.tuck, 0, 1),
      braking = Number.isFinite(pose.braking) ? T.MathUtils.clamp(pose.braking, 0, 1) : 0,
      standing = T.MathUtils.clamp(pose.standing ?? 0, 0, 1),
      dab = T.MathUtils.clamp(pose.dab ?? 0, -1, 1),
      body = T.MathUtils.clamp(pose.body ?? 0, -1, 1);
    const [pelvis, shoulder, joint, hip, pole, target] = this.v;
    // Hang off: the hips slide toward the inside and drop off the seat.
    pelvis.copy(this.seat);
    pelvis.x += offset * 0.6;
    pelvis.y -= Math.abs(offset) * 0.15;
    pelvis.z += braking * 0.05 - tuck * 0.05;
    pelvis.y -= tuck * 0.03;
    // Off-road: up on the pegs (knees flexed) and fore/aft over the bike.
    const mx = this.kit === 'motocross';
    const motion = mx ? sampleMotocrossRiderMotion(pose, this.motocrossMotion) : null;
    // The original 30 cm rise exceeded a dirt rider's leg reach. Keep the
    // ankles planted on their pegs with flex left in the knees for a landing.
    pelvis.y += standing * (mx ? 0.17 : 0.3);
    pelvis.z += mx ? standing * 0.055 + body * 0.085 : standing * 0.04 - body * 0.1;
    if (motion) {
      pelvis.y -= motion.pelvisDrop;
      pelvis.z -= motion.pelvisBack;
    }
    // The body leans further into the corner than the bike; tucks on the
    // straight; sits up and braces under braking.
    const into = T.MathUtils.clamp(
      mx ? -lean * 0.3 + offset * 0.2 : lean * 0.22 + offset * 0.5,
      -0.32,
      0.32,
    );
    let pitch = T.MathUtils.lerp(1.05, 1.42, tuck) - braking * 0.3 + Math.abs(lean) * 0.1;
    // An off-road rider sits up; standing, bends at the hips over the bars.
    if (mx) pitch = 0.36 + braking * 0.12 + body * 0.16 + standing * 0.23 + motion!.torsoPitch;
    else pitch = T.MathUtils.lerp(pitch, 0.78 + body * 0.25, standing);
    const yaw = T.MathUtils.clamp(offset * 0.9, -0.3, 0.3) + pose.steer * 0.3;
    this.euler.set(pitch, yaw, -into, 'ZYX');
    this.torso.position.copy(pelvis);
    this.torso.quaternion.setFromEuler(this.euler);
    this.motocrossSpine?.ride(pose, pelvis, pitch, yaw, -into);
    const upperTorso = this.motocrossSpine?.chest ?? this.torso;
    // Non-GP kits retain their authored pose, including the MX landing response.
    if (mx)
      motocrossHeadFrame(pose, upperTorso.quaternion, motion!.gazePitch, this.head.quaternion);
    else
      this.head.rotation.set(
        -pitch + 0.3 + tuck * 0.12 + (motion?.gazePitch ?? 0),
        lean * 0.3 + pose.steer * 0.6,
        (into + lean) * (mx ? 0.78 : 0.45),
        'YXZ',
      );
    this.headShadow.quaternion.copy(this.head.quaternion);
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const inside = side * Math.sign(offset || lean) > 0;
      shoulder
        .set(side * RIDER.shoulderWidth, RIDER.spine - 0.04, 0.0)
        .applyQuaternion(upperTorso.quaternion)
        .add(upperTorso.position);
      // Seated corners use relaxed shoulders; standing attack/bracing still
      // raises the elbows. A fixed high, wide pole made every MX pose read as
      // the same horizontal T-pose, even while sitting at the gate.
      pole
        .copy(shoulder)
        .add(
          target.set(
            side * (mx ? 0.3 : 0.35),
            mx ? -0.24 + standing * 0.12 + Math.max(0, body) * 0.1 + motion!.elbowLift : -0.3,
            mx ? 0.04 : -0.1,
          ),
        );
      if (mx) {
        gpGripFrame(this.gripAxes[i], this.q);
        gpContactJoint(this.grips[i], this.q, MX_GLOVE_GRIP, MX_GLOVE_WRIST, target);
        // A braking rider can protract the outside shoulder within the suit.
        // Preserve a little elbow flex at full hang-off rather than letting
        // the fixed-length IK silently shorten its wrist target off the grip.
        const reach = shoulder.distanceTo(target),
          relaxedReach = RIDER.upperArm + RIDER.forearm - 0.01;
        if (reach > relaxedReach) {
          joint.subVectors(target, shoulder).multiplyScalar((reach - relaxedReach) / reach);
          shoulder.add(joint);
          pole.add(joint);
        }
        twoBone(this.upperArms[i], this.forearms[i], shoulder, target, pole, joint);
        gpAttachAtJoint(
          this.hands[i],
          this.forearms[i].group.quaternion,
          RIDER.forearm,
          this.q,
          MX_GLOVE_WRIST,
        );
      } else {
        twoBone(this.upperArms[i], this.forearms[i], shoulder, this.grips[i], pole, joint);
        this.hands[i].rotation.set(0.2, 0, 0);
      }
      hip
        .set(side * RIDER.hipWidth, 0, 0)
        .applyQuaternion(this.torso.quaternion)
        .add(pelvis);
      // Feet on the pegs; the inside knee opens toward the road when hung off.
      const out = mx ? (inside ? 0.18 : 0.12) : inside ? 0.35 + Math.abs(offset) * 1.4 : 0.25;
      pole.copy(hip).add(target.set(side * out, 0.15, 0.55));
      // A dabbed foot leaves its peg toward the ground ahead of it.
      const down = side * dab > 0 ? Math.abs(dab) : 0;
      if (mx) {
        // Solve the ankle above the contact patch. The boot sole stays on
        // the serrations while its calf follows this independently solved
        // shin, including standing absorption and a continuous foot dab.
        motocrossSoleContact(this.pegs[i], side, dab, this.motocrossContact);
        motocrossBootFrame(this.q, down);
        gpContactJoint(this.motocrossContact, this.q, MX_BOOT_PEG, MX_BOOT_ANKLE, target);
        twoBone(this.thighs[i], this.shins[i], hip, target, pole, joint);
        gpAttachAtJoint(
          this.feet[i],
          this.shins[i].group.quaternion,
          RIDER.shin,
          this.q,
          MX_BOOT_ANKLE,
        );
        this.motocrossBoots[i].updatePose();
      } else if (down > 0) {
        // Motocross: project the boot ahead of the peg, heel close to the
        // surface. The former 86 cm drop put the target far below the track.
        target.set(side * (mx ? 0.2 : 0.34), mx ? -0.015 : -0.86, 0.32).add(this.pegs[i]);
        target.lerpVectors(this.pegs[i], target, down);
        twoBone(this.thighs[i], this.shins[i], hip, target, pole, joint);
      } else twoBone(this.thighs[i], this.shins[i], hip, this.pegs[i], pole, joint);
      if (!mx) {
        this.feet[i].position.set(0, RIDER.shin + 0.02, 0);
        this.feet[i].rotation.set(mx ? -0.07 - down * 0.15 : -0.35, 0, 0);
        this.bootCuffs[i]?.quaternion.identity();
      }
    }
    if (this.kit === 'motocross') {
      this.captureExteriorArms();
      for (const garment of this.motocrossGarments) garment.updatePose();
      if (this.motocrossFirstPerson) this.onboardArms();
    }
  }
  /** GP prototype riding pose. `GpRiderPosture` supplies the pelvis, spine,
   * neck and limb poles; this solver keeps every machine contact exact (glove
   * on the grip, forefoot on the peg or boot on the road at a stop) and folds
   * a knee or elbow back about its limb axis so its slider skims, but never
   * penetrates, the road at full lean. Pure in `pose`: no clock or history. */
  private rideGp(pose: RiderPose) {
    const posture = this.gpPosture.solve(pose, this.seat),
      braking = Number.isFinite(pose.braking) ? T.MathUtils.clamp(pose.braking, 0, 1) : 0,
      lean = T.MathUtils.clamp(Number.isFinite(pose.lean) ? pose.lean : 0, -1.3, 1.3),
      { height, crown } = this.ground,
      [pelvis, shoulder, joint, hip, pole, target] = this.v,
      [plantedAnkle, contact] = this.gpScratch,
      pelvisFrame = this.gpPelvisFrame.setFromEuler(posture.pelvisAngles),
      plant = posture.plant[0];
    pelvis.copy(posture.pelvis);
    if (plant > 0) {
      // A planted boot must reach the road: settle the hips into the seat
      // (and onto the boots) by at most 7 cm before the IK would fall short.
      let drop = 0;
      for (let i = 0; i < 2; i++) {
        this.gpPlantedFoot(i, lean, this.q, contact, plantedAnkle);
        hip
          .set((i === 0 ? 1 : -1) * RIDER.hipWidth, 0, 0)
          .applyQuaternion(pelvisFrame)
          .add(pelvis);
        drop = Math.max(drop, hip.distanceTo(plantedAnkle) - (RIDER.thigh + RIDER.shin - 0.035));
      }
      pelvis.y -= T.MathUtils.clamp(drop, 0, 0.07) * plant;
    }
    this.torso.position.copy(pelvis);
    if (this.gpSpine) this.gpSpine.pose(pelvis, posture.pelvisAngles, posture.chestAngles);
    else this.torso.quaternion.setFromEuler(posture.chestAngles);
    const chest = this.gpSpine?.chest ?? this.torso;
    // The neck leaves the seventh vertebra along the posture's direction;
    // the helmet then turns about the atlas toward the road ahead.
    this.head.position
      .copy(posture.neck)
      .applyQuaternion(this.gpChestInverse.copy(chest.quaternion).invert())
      .multiplyScalar(GP_NECK_LENGTH)
      .add(GP_NECK_BASE)
      .addScaledVector(GP_NECK_HUNCH, posture.hunch);
    gpHeadFrame(pose, chest.quaternion, this.head.quaternion);
    this.headShadow.position.copy(this.head.position);
    this.headShadow.quaternion.copy(this.head.quaternion);
    const relaxedReach = RIDER.upperArm + RIDER.forearm - 0.01;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      shoulder
        .set(side * RIDER.shoulderWidth, RIDER.spine - 0.04 + posture.reach.y, posture.reach.z)
        .applyQuaternion(chest.quaternion)
        .add(chest.position);
      pole.copy(shoulder).add(posture.elbowPoles[i]);
      gpGripFrame(this.gripAxes[i], this.q);
      gpContactJoint(this.grips[i], this.q, GP_GLOVE_GRIP, GP_GLOVE_WRIST, target);
      // A braking rider can protract the outside shoulder within the suit.
      // Preserve a little elbow flex at full hang-off rather than letting
      // the fixed-length IK silently shorten its wrist target off the grip.
      const reach = shoulder.distanceTo(target);
      if (reach > relaxedReach) {
        joint.subVectors(target, shoulder).multiplyScalar((reach - relaxedReach) / reach);
        shoulder.add(joint);
        pole.add(joint);
      }
      twoBone(this.upperArms[i], this.forearms[i], shoulder, target, pole, joint);
      if (gpClearJoint(shoulder, target, joint, pole, lean, height, crown, GP_ELBOW_CLEARANCE))
        twoBone(this.upperArms[i], this.forearms[i], shoulder, target, pole, joint);
      gpAttachAtJoint(
        this.hands[i],
        this.forearms[i].group.quaternion,
        RIDER.forearm,
        this.q,
        GP_GLOVE_WRIST,
      );
      if (i === 1)
        this.gpBrakeFingers?.update(braking, this.brakeFingerTargets, this.grips[i], this.q);
      hip
        .set(side * RIDER.hipWidth, 0, 0)
        .applyQuaternion(this.torso.quaternion)
        .add(pelvis);
      pole.copy(hip).add(posture.kneePoles[i]);
      gpBootFrame(this.q, i === 1 ? pose.rearBraking : 0);
      gpContactJoint(this.pegs[i], this.q, GP_BOOT_PEG, GP_BOOT_ANKLE, target);
      target.y += GP_FOOTPEG_RADIUS;
      if (plant > 0) {
        // Boots leave the rearsets for the road (REF_014/052): the forefoot
        // presses on the asphalt beside the bike, heel raised, toe out.
        const blend = T.MathUtils.smootherstep(plant, 0, 1);
        this.gpPlantedFoot(i, lean, this.gpPlantFrame, contact, plantedAnkle);
        target.lerp(plantedAnkle, blend);
        this.q.slerp(this.gpPlantFrame, blend);
      }
      twoBone(this.thighs[i], this.shins[i], hip, target, pole, joint);
      if (gpClearJoint(hip, target, joint, pole, lean, height, crown, GP_KNEE_CLEARANCE))
        twoBone(this.thighs[i], this.shins[i], hip, target, pole, joint);
      gpAttachAtJoint(
        this.feet[i],
        this.shins[i].group.quaternion,
        RIDER.shin,
        this.q,
        GP_BOOT_ANKLE,
      );
      // Inverse ankle rotation keeps the existing cuff on the shin while
      // its forefoot rests on the rearset. No skinning or vertex uploads.
      this.bootCuffs[i]?.quaternion.copy(this.feet[i].quaternion).invert();
    }
    for (const garment of this.gpGarments) garment.updatePose();
  }
  /** Boot frame and ankle target for a foot planted on the road beside the
   * machine, in this sprung frame. The road plane accounts for chassis lean. */
  private gpPlantedFoot(
    i: number,
    lean: number,
    frame: T.Quaternion,
    contact: T.Vector3,
    ankle: T.Vector3,
  ) {
    const side = i === 0 ? 1 : -1;
    frame
      .setFromEuler(this.gpPlantEuler.set(0.24, side * 0.16, Math.PI, 'YXZ'))
      .premultiply(this.gpLeanFrame.setFromAxisAngle(GP_BIKE_FORWARD, lean));
    contact.set(side * 0.34, 0, this.seat.z + 0.24);
    // Solve the contact's height on the road plane, then lift by the toe pad.
    contact.y = 0;
    contact.y =
      -gpRoadClearance(contact, lean, this.ground.height, this.ground.crown) / Math.cos(lean);
    return gpContactJoint(contact, frame, GP_BOOT_PEDAL, GP_BOOT_ANKLE, ankle);
  }
  /** Separated rider: `phase` 0 sliding/tumbling, 1 standing/jogging, 2 at the bike. */
  separated(phase: number, tumble: number, time: number) {
    this.riding = false;
    this.gpBrakeFingers?.update(0);
    const [pelvis, a, b, joint, pole, c] = this.v;
    const lying = phase === 0;
    pelvis.set(0, lying ? 0.0 : 0.95, 0);
    this.torso.position.copy(pelvis);
    // Lying: torso along the slide direction, rolled by the tumble.
    this.euler.set(lying ? Math.PI / 2 - 0.1 : 0.12, 0, lying ? tumble : 0, 'ZYX');
    this.torso.quaternion.setFromEuler(this.euler);
    this.gpSpine?.reset();
    this.motocrossSpine?.reset();
    this.head.rotation.set(lying ? -0.6 : -0.1, 0, 0);
    // The GP neck articulates while riding; recovery restores its rest length.
    if (this.gp && this.kit !== 'motocross')
      this.head.position.copy(GP_NECK_BASE).addScaledVector(Y, GP_NECK_LENGTH);
    this.headShadow.position.copy(this.head.position);
    this.headShadow.quaternion.copy(this.head.quaternion);
    const stride = phase === 1 ? Math.sin(time * 9) * 0.45 : 0;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      a.set(side * RIDER.shoulderWidth, RIDER.spine - 0.04, 0)
        .applyQuaternion(this.torso.quaternion)
        .add(pelvis);
      // Hands: spread when sliding, swinging when jogging, on the bars at the bike.
      c.set(side * 0.38, lying ? 0.0 : -0.25, lying ? 0.35 : 0.15 + side * stride * 0.4);
      if (phase === 2) c.set(side * 0.25, -0.05, 0.45);
      c.applyQuaternion(this.torso.quaternion).add(a);
      pole.copy(a).add(b.set(side * 0.4, -0.4, -0.2));
      twoBone(this.upperArms[i], this.forearms[i], a, c, pole, joint);
      a.set(side * RIDER.hipWidth, 0, 0)
        .applyQuaternion(this.torso.quaternion)
        .add(pelvis);
      c.set(side * 0.16, -0.86, side * stride * 0.6);
      if (lying) c.set(side * 0.22, -0.82, -0.08);
      c.applyQuaternion(this.torso.quaternion).add(a);
      pole.copy(a).add(b.set(side * 0.1, 0, 0.6).applyQuaternion(this.torso.quaternion));
      twoBone(this.thighs[i], this.shins[i], a, c, pole, joint);
      this.feet[i].rotation.set(-1.4, 0, 0);
      if (this.kit === 'motocross') {
        // Recovery starts from its own joint frames, not the last steering
        // angle or standing ankle pose retained by a previous riding frame.
        this.hands[i].position.set(0, RIDER.forearm + 0.02, 0);
        this.hands[i].rotation.set(0.2, 0, 0);
        motocrossBootFrame(this.q).premultiply(this.torso.quaternion);
        gpAttachAtJoint(
          this.feet[i],
          this.shins[i].group.quaternion,
          RIDER.shin,
          this.q,
          MX_BOOT_ANKLE,
        );
        this.motocrossBoots[i].updatePose();
      }
      if (this.gp && this.kit !== 'motocross') {
        // A held recovery frame must not inherit the last riding wrist/ankle
        // transforms, including after a replay jumps directly out of a turn.
        this.hands[i].position.set(0, RIDER.forearm + 0.02, 0);
        this.hands[i].rotation.set(0.2, 0, 0);
        // Keep the existing sliding/jogging leg targets, with the forefoot
        // facing the rider's direction and the calf sleeve following its shin.
        gpBootFrame(this.q).premultiply(this.torso.quaternion);
        gpAttachAtJoint(
          this.feet[i],
          this.shins[i].group.quaternion,
          RIDER.shin,
          this.q,
          GP_BOOT_ANKLE,
        );
        this.bootCuffs[i]?.quaternion.copy(this.feet[i].quaternion).invert();
      }
    }
    if (this.kit === 'motocross') {
      this.captureExteriorArms();
      for (const garment of this.motocrossGarments) garment.updatePose();
    }
    for (const garment of this.gpGarments) garment.updatePose();
  }
  dispose() {
    this.gpBrakeFingers?.dispose();
    this.gpSpine?.dispose();
    this.motocrossSpine?.dispose();
    for (const garment of this.motocrossGarments) garment.skeleton.dispose();
    for (const boot of this.motocrossBoots) boot.dispose();
    for (const garment of this.gpGarments) garment.dispose();
    this.root.traverse((o) => {
      if (o instanceof T.Mesh) o.geometry.dispose();
    });
    const textures = new Set<T.Texture>();
    for (const m of this.materials) {
      for (const value of Object.values(m)) if (value instanceof T.Texture) textures.add(value);
      m.dispose();
    }
    for (const texture of textures) texture.dispose();
  }
}
void Y;
