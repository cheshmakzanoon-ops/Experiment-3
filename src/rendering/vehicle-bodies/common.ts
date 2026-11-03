import * as T from 'three';
import type { PaintFinish } from '../paint-finish.ts';
import { revolveX, roundedBox, tubeGeometry, type Pt } from './loft.ts';
import {
  bodyPaint,
  lampMaterial,
  numberBoard,
  paintNumber,
  sharedMaterials,
  type PanelGap,
} from './materials.ts';
import { placed, type Parts } from './parts.ts';
import type { BuiltCabin } from './interior.ts';
import { bodyLayersOf, type BodyLayers, type LayerFrame } from './body-livery.ts';
import { teamLook, type BodyLook } from './colourways.ts';

/** Per-car materials: its own paint (livery colour), accent, lamps (driven
 * from the snapshot), number board and helmet; everything else is shared. */
export interface CarMaterials {
  paint: T.MeshPhysicalMaterial;
  accent: T.MeshPhysicalMaterial;
  /** Helmet shell in the livery colour; the band over the crown and around the
   * visor is the accent material. */
  helmet: T.MeshPhysicalMaterial;
  head: T.MeshStandardMaterial;
  tail: T.MeshStandardMaterial;
  board: T.MeshStandardMaterial;
  suit: T.MeshStandardMaterial;
  /** The two-tone layer handle on the paint (the player's body only). */
  layers: BodyLayers | null;
  look: BodyLook;
}
/** Materials for entrant `id`: the look (team colour,
 * machine colourway or the player's livery edit) fixes the paint, accent,
 * helmet, suit and number. Only the player's body carries the layer hook, so
 * rivals keep the exact programs they always had; `layerFrame` places its bands
 * on closed bodies. */
export function carMaterials(
  id: number,
  finish: PaintFinish,
  gaps: readonly PanelGap[],
  look: BodyLook = teamLook(id),
  layerFrame?: LayerFrame | null,
) {
  const paint = bodyPaint(
    look.primary,
    finish,
    gaps,
    id === 0 ? (layerFrame ?? undefined) : undefined,
  );
  const layers = bodyLayersOf(paint) ?? null;
  const materials: CarMaterials = {
    paint,
    accent: bodyPaint(look.accent, finish === 'metallic' ? 'gloss' : finish),
    helmet: bodyPaint(look.helmet, 'gloss'),
    head: lampMaterial(0xe8edf2, 0xfff4e2),
    tail: lampMaterial(0x4a0606, 0xff1a12),
    board: numberBoard(look.number),
    // Per car (not the shared cache): a livery edit recolours it in place.
    suit: new T.MeshStandardMaterial({ color: look.suit, roughness: 0.82, metalness: 0 }),
    layers,
    look,
  };
  layers?.setLook(look);
  materials.paint.name = 'Body paint';
  return materials;
}
/** Re-colour an already built car to another look without rebuilding it (the
 * livery editor's live preview). The finish is part of the built program, so it
 * stays; colours, layers and the number board update in place. */
export function applyLook(materials: CarMaterials, look: BodyLook) {
  materials.look = look;
  materials.paint.color.set(look.primary);
  materials.accent.color.set(look.accent);
  materials.helmet.color.set(look.helmet);
  materials.suit.color.set(look.suit);
  materials.layers?.setLook(look);
  const canvas = materials.board.map?.image as HTMLCanvasElement | undefined;
  const context = canvas?.getContext?.('2d');
  if (context && materials.board.map) {
    paintNumber(context, look.number);
    materials.board.map.needsUpdate = true;
  }
}
/** One level of detail: its static group plus the detachable elements the
 * snapshot's component health hides (wings, splitters, noses). */
export interface BuiltLod {
  group: T.Group;
  front: T.Object3D[];
  rear: T.Object3D[];
  /** The near cabin (LOD0 only): interior.ts. */
  cabin?: BuiltCabin;
}
export function emptyLod(name: string): BuiltLod {
  const group = new T.Group();
  group.name = name;
  return { group, front: [], rear: [] };
}
/** Driver options for the near cabin (LOD0): the helmet and visor go to
 * `head` (hidden in the driver's own cockpit view), the static steering ring
 * is left out when the cabin carries a turning wheel, and `legs` reach from
 * the cushion to the pedals at (floor y, pedal z). */
export interface DriverOptions {
  head?: Parts;
  wheel?: boolean;
  legs?: { floor: number; pedals: number };
  /** Hands below the helmet centre (x scale); default 0.38. */
  handDrop?: number;
  /** When given, the arms and gloves are NOT merged into `parts`: each arm's
   * rest geometry is pushed here for DriverArms, which poses it every frame so
   * the hands follow the turning steering wheel. */
  arms?: DriverArmAnchor[];
  /** Level of detail (0 near .. 2 far): fewer segments, no crown stripe. */
  detail?: 0 | 1 | 2;
}
/** One arm's rest pose in the car frame (see DriverArms). */
export interface DriverArmAnchor {
  side: -1 | 1;
  shoulder: T.Vector3;
  /** The rest elbow of the former static arm: gives bone lengths and pole. */
  elbow: T.Vector3;
  /** Glove centre on the wheel rim at rest. */
  hand: T.Vector3;
  /** Arm and glove radius. */
  radius: number;
}
/** Helmet shell profile as (radius, height) about the head centre, before the
 * driver's scale: a rounded full-face lid, fuller at the crown. The face opening
 * is not cut; the visor band wraps the shell where it would be. */
const HELMET_PROFILE: readonly Pt[] = [
  [0.0, -0.128],
  [0.072, -0.122],
  [0.115, -0.075],
  [0.133, -0.005],
  [0.131, 0.058],
  [0.112, 0.108],
  [0.07, 0.14],
  [0.0, 0.152],
];
/** Front-to-back elongation of the shell, visor and crown stripe. */
const HELMET_LENGTH = 1.2;
/** Radius of the shell at height `h` (m, before scale). */
function helmetRadius(h: number) {
  const p = HELMET_PROFILE;
  if (h <= p[0][1]) return p[0][0];
  for (let i = 1; i < p.length; i++)
    if (h <= p[i][1]) {
      const t = (h - p[i - 1][1]) / (p[i][1] - p[i - 1][1]);
      return p[i - 1][0] + (p[i][0] - p[i - 1][0]) * t;
    }
  return 0;
}
/** A band wrapped round the front of the helmet: a short open cylinder segment
 * that follows the shell at height `h`, `arc` rad wide and `height` tall. Both
 * edges droop toward the cheeks (`droop`: the bottom edge's drop as a share of
 * the height at the ends of the arc, the top edge drops half as far), so the
 * visor is a curved eye-port, not a flat slab. */
function helmetBand(
  s: number,
  h: number,
  height: number,
  arc: number,
  lift: number,
  sides = 20,
  droop = 0.5,
) {
  const r = (helmetRadius(h) + lift) * s;
  const g = new T.CylinderGeometry(r * 1.01, r * 0.97, height * s, sides, 1, true, -arc / 2, arc);
  const position = g.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const t = Math.atan2(position.getX(i), position.getZ(i)) / (arc / 2);
    const drop = t * t * height * s * droop;
    position.setY(i, position.getY(i) - (position.getY(i) > 0 ? drop * 0.5 : drop));
  }
  g.computeVertexNormals();
  g.scale(1, 1, HELMET_LENGTH);
  return g;
}
/** The livery stripe along the crown, front to back, hugging the shell. */
function crownStripe(s: number, from: number, to: number, width: number, steps: number) {
  const path: [number, number, number][] = [];
  for (let k = 0; k <= steps; k++) {
    const h = from + ((0.152 - from) * k) / steps;
    path.push([0, h * s, (helmetRadius(h) + 0.003) * s * HELMET_LENGTH]);
  }
  for (let k = 1; k <= steps; k++) {
    const h = 0.152 - ((0.152 - to) * k) / steps;
    path.push([0, h * s, -(helmetRadius(h) + 0.003) * s * HELMET_LENGTH]);
  }
  return tubeGeometry(path, width * s, steps * 3, 5);
}
/** A seated driver: helmet with a wrapped visor, livery stripe and chin bar (or
 * goggles under an open-face dome), neck, HANS yoke, shoulders, torso and arms
 * reaching for a wheel `reach` m ahead. `scale` 1 is an adult. The helmet shell is
 * the livery colour (`mats.helmet`) and the accent is its band. */
export function addDriver(
  parts: Parts,
  mats: CarMaterials,
  x: number,
  seatY: number,
  z: number,
  scale: number,
  wheelZ: number,
  openFace = false,
  options: DriverOptions = {},
) {
  const headParts = options.head ?? parts;
  const s = scale,
    far = (options.detail ?? 0) === 2,
    headY = seatY + 0.74 * s,
    headZ = z + 0.02;
  const at = (dy = 0, dz = 0) => placed(x, headY + dy * s, headZ + dz * s);
  const dome = (profile: readonly Pt[]) =>
    revolveX(
      profile.map(([r, a]) => [r * s, a * s] as const),
      far ? 12 : 24,
    )
      .rotateZ(Math.PI / 2)
      .scale(1, 1, HELMET_LENGTH);
  if (!openFace) {
    // Shell: a lathe about the vertical axis, longer than it is wide, with a
    // chin guard swelling out of the lower front.
    headParts.add(dome(HELMET_PROFILE), mats.helmet, placed(x, headY, headZ));
    headParts.add(
      new T.SphereGeometry(0.085 * s, far ? 8 : 14, far ? 6 : 10).scale(1.1, 0.55, 0.85),
      mats.helmet,
      at(-0.088, 0.072),
    );
    // Visor: a curved eye-port wrapped round the front, inside a thin accent rim.
    headParts.add(helmetBand(s, 0.014, 0.066, 2.4, 0.0015, far ? 10 : 22), mats.accent, at(0.014));
    headParts.add(
      helmetBand(s, 0.016, 0.054, 2.15, 0.004, far ? 10 : 22),
      sharedMaterials.visor(),
      at(0.016),
    );
    // Crown stripe in the accent, from the visor's top edge to the nape.
    if (!far) headParts.add(crownStripe(s, 0.052, -0.012, 0.0075, 10), mats.accent, at());
  } else {
    // Open face (historic cars, karts): a jet dome over a visible face, with
    // goggles on a strap.
    headParts.add(dome(HELMET_PROFILE.slice(2)), mats.helmet, at(0.012));
    headParts.add(
      new T.SphereGeometry(0.1 * s, far ? 8 : 14, far ? 6 : 10).scale(1, 1.12, 1.08),
      sharedMaterials.skin(),
      at(-0.04, 0.008),
    );
    headParts.add(
      helmetBand(s, 0.005, 0.05, 2.0, 0.012, far ? 10 : 20),
      sharedMaterials.visor(),
      at(0.012),
    );
    headParts.add(
      new T.TorusGeometry(0.139 * s, 0.006 * s, 5, far ? 10 : 24)
        .rotateX(Math.PI / 2)
        .scale(1, 1, HELMET_LENGTH),
      mats.accent,
      at(0.012),
    );
  }
  // Neck, HANS yoke and shoulders. The arm anchors below sit on the shoulder
  // spheres, so DriverArms (rest pose, bone lengths, full-lock sweep) is as before.
  parts.add(
    new T.CylinderGeometry(0.05 * s, 0.058 * s, 0.1 * s, 12),
    mats.suit,
    placed(x, headY - 0.14 * s, z - 0.005),
  );
  parts.add(
    roundedBox(0.3 * s, 0.05 * s, 0.17 * s, 0.018 * s, 2),
    sharedMaterials.trim(),
    placed(x, headY - 0.185 * s, z - 0.01),
  );
  for (const side of [-1, 1])
    parts.add(
      roundedBox(0.07 * s, 0.032 * s, 0.15 * s, 0.012 * s, 1),
      sharedMaterials.trim(),
      placed(x + side * 0.085 * s, headY - 0.19 * s, z + 0.075 * s, 0.22),
    );
  parts.add(
    roundedBox(0.4 * s, 0.22 * s, 0.23 * s, 0.085 * s, 3),
    mats.suit,
    placed(x, headY - 0.29 * s, z - 0.04),
  );
  parts.add(
    roundedBox(0.33 * s, 0.4 * s, 0.21 * s, 0.09 * s, 3),
    mats.suit,
    placed(x, headY - 0.52 * s, z - 0.06, -0.12),
  );
  // Arms to the wheel, hands on it.
  const shoulderY = headY - 0.27 * s,
    hand = new T.Vector3(0, headY - (options.handDrop ?? 0.38) * s, wheelZ);
  for (const side of [-1, 1])
    parts.add(
      new T.SphereGeometry(0.068 * s, far ? 8 : 12, far ? 6 : 8).scale(1, 0.92, 1.05),
      mats.suit,
      placed(x + side * 0.19 * s, shoulderY, z - 0.02),
    );
  for (const side of [-1, 1] as const) {
    const sx = x + side * 0.19 * s,
      hx = x + side * 0.17 * s;
    if (options.arms) {
      options.arms.push({
        side,
        shoulder: new T.Vector3(sx, shoulderY, z - 0.02),
        elbow: new T.Vector3(sx + side * 0.03 * s, shoulderY - 0.2 * s, (z + wheelZ) / 2),
        hand: new T.Vector3(hx, hand.y, wheelZ),
        radius: 0.045 * s,
      });
      continue;
    }
    parts.add(
      tubeGeometry(
        [
          [sx, shoulderY, z - 0.02],
          [sx + side * 0.03 * s, shoulderY - 0.2 * s, (z + wheelZ) / 2],
          [hx, hand.y, wheelZ - 0.03],
        ],
        0.045 * s,
        10,
        8,
      ),
      mats.suit,
    );
    parts.add(
      new T.SphereGeometry(0.045 * s, 10, 8),
      sharedMaterials.trim(),
      placed(hx, hand.y, wheelZ),
    );
  }
  // Steering wheel (unless the cabin carries a turning one).
  if (options.wheel !== false) {
    const wheel = new T.TorusGeometry(0.15 * s, 0.016 * s, 8, 24);
    parts.add(wheel, sharedMaterials.trim(), placed(x, hand.y, wheelZ + 0.02, -0.35));
  }
  if (options.legs) {
    // Thighs forward from the hips, knees raised, shins down to the pedals.
    const hipY = seatY + 0.08 * s,
      hipZ = z + 0.02,
      { floor, pedals } = options.legs;
    for (const side of [-1, 1]) {
      const lx = x + side * 0.1 * s,
        kneeZ = Math.min(hipZ + 0.44 * s, pedals - 0.14),
        kneeY = Math.max(hipY + 0.06 * s, floor + 0.32 * s);
      parts.add(
        tubeGeometry(
          [
            [lx, hipY, hipZ - 0.04],
            [lx + side * 0.012, kneeY, kneeZ],
            [lx, floor + 0.09, pedals - 0.06],
          ],
          0.062 * s,
          12,
          8,
        ),
        mats.suit,
      );
      // Boot on the pedal.
      parts.add(
        roundedBox(0.1 * s, 0.09 * s, 0.24 * s, 0.03 * s, 1),
        sharedMaterials.trim(),
        placed(lx, floor + 0.07, pedals - 0.05, -0.5),
      );
    }
  }
}
