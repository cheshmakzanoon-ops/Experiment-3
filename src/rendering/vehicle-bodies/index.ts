import { formulaTreadState, sampleFormulaTread, type FormulaTreadState } from '../tire-finish.ts';
import { frameLiquidRain } from '../../simulation/weather.ts';
import { formulaFlapAngle } from '../formula-rear-flap.ts';
import { WING_DETACH_HEALTH } from '../../simulation/config.ts';
import { lampMaterial } from './materials.ts';
import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, lerp } from '../../core/math.ts';
import {
  F,
  H,
  O,
  R,
  RACE_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../../simulation/protocol.ts';
import { vehicleAt, type VehicleDefinition } from '../../simulation/vehicles.ts';
import type { ShadowSubstitute } from '../shadow-proxies.ts';
import { cornerGaze, HEAD_ROLL_GAIN } from '../driver.ts';
import { driverBodyPose } from '../driver-anatomy.ts';
import { wheelPhase, wheelValue } from '../wheel-pose.ts';
import {
  contactCylinderRadius,
  contactHubLength,
  sampleWheelContact,
  wheelContactPose,
} from '../wheel-contact.ts';
import {
  presentationAlpha,
  sampleOffroadField,
  sampleValue,
  snapshotSource,
} from '../snapshot-interpolation.ts';
import { bodySheetFor, type BodySheet } from './body-sheet.ts';
import { buildClosedBody, ClosedBodyModel } from './closed-body.ts';
import { festivalDetailFor } from './festival-detail.ts';
import { applyLook, carMaterials, emptyLod, type BuiltLod, type CarMaterials } from './common.ts';
import { bodyLook, type LiveryInput } from './colourways.ts';
import type { LayerFrame } from './body-livery.ts';
import { bodyFrame, type BodyFrame } from './frame.ts';
import { buildKart, buildOpenWheel, type Link } from './open-wheel.ts';
import { buildBuggy } from './buggy.ts';
import { sharedMaterials } from './materials.ts';
import { WheelAssembly, type Detail } from './wheel.ts';
import { installMudOn, mudUniforms, type MudUniforms } from '../offroad/mud.ts';
import { cabinLayout } from './cabin.ts';
import { CABIN_DETAIL_DISTANCE, CABIN_GLASS_ORDER } from './interior.ts';

/** Who is looking: the followed entrant, whether the camera sits in its
 * cockpit, the camera position and the distance (m) within which a rival's
 * cabin detail is drawn (default CABIN_DETAIL_DISTANCE; 0: the followed car's
 * only, see cabinDetailDistance). */
export interface BodyView {
  follow: number;
  cockpit: boolean;
  camera: T.Vector3 | null;
  detailDistance?: number;
}

/** Procedural exteriors for every non-Formula definition (WP30), replacing
 * the TC-1 greybox shell. The snapshot's R.VEHICLE decides the body, so live
 * play, replay and results show the machine that was simulated; the body
 * follows the interpolated Formula representation's root (its pose and its
 * LOD choice), and every wheel follows the recorded wheel channels exactly as
 * car.ts does: suspension length, steer, camber, rolling phase, load,
 * pressure and disc temperature. Three LODs share one material set per car;
 * a cheap merged proxy casts the shadow while any detailed LOD is shown. */
export interface BodyHost {
  root: T.Object3D;
  lodLevel?: number;
}
interface Built {
  definition: VehicleDefinition;
  root: T.Group;
  fine: T.Group;
  proxy: T.Mesh;
  lods: BuiltLod[];
  wheels: WheelAssembly[][];
  formulaTyres?: FormulaTreadState[];
  links: { mesh: T.Mesh; link: Link }[][];
  materials: CarMaterials;
  frame: BodyFrame;
  level: number;
  /** The coarser LOD the last rear-view feed pass showed (null: none); its
   * wheels are posed too, so the feed never shows a stale wheel set. */
  feedLevel: number | null;
  /** The main view's cabin detail state (restored after a feed pass). */
  near: boolean;
  /** Off-road mud coat (WP41), installed once the car first picks up mud. */
  mud?: MudUniforms;
}
const LOD_NAMES = ['near', 'mid', 'far'];
interface ShadowWheel {
  first: number;
  local: Float32Array;
  hub: number;
  steer: number;
  camber: number;
  radiusScale: number;
}
interface ShadowFlap {
  first: number;
  local: Float32Array;
  pivot: T.Vector3;
  angle: number;
}
const shadowFlaps = new WeakMap<T.Mesh, ShadowFlap>();
const shadowWheels = new WeakMap<T.Mesh, ShadowWheel[]>();
/** Where the colourway layers sit on a closed body (car-frame metres). */
export function layerFrameFor(frame: BodyFrame, model: ClosedBodyModel): LayerFrame {
  const s = model.s;
  return {
    belt: frame.y(s.belt),
    low: frame.y(s.floor + (s.belt - s.floor) * 0.58),
    roof: frame.y(s.roof),
    windscreen: frame.z(s.cabin[0]),
    rearGlass: frame.z(s.cabin[3]),
    front: model.zFront,
    rear: model.zRear,
    half: model.halfBase,
    bonnetInset: model.forwardCanopy
      ? [frame.z(s.cabin[0]) + 0.31, model.zFront - 0.24]
      : undefined,
  };
}
/** Build one catalogue body for entrant `id`. `livery` is the player's own
 * edit: it only affects entrant 0, and only once it differs from the default
 * identity (colourways.ts). */
export function buildVehicleBody(
  id: number,
  definition: VehicleDefinition,
  sheet: BodySheet,
  livery?: LiveryInput | null,
) {
  const frame = bodyFrame(definition);
  const cabin = { layout: cabinLayout(definition, sheet), def: definition };
  const closed = sheet.kind === 'closed' ? sheet : null;
  const finish = sheet.paint;
  const model = closed
    ? new ClosedBodyModel(frame, closed, [sheet.wheels.width[0] / 2, sheet.wheels.width[1] / 2])
    : null;
  const materials = carMaterials(
    id,
    finish,
    model ? model.gaps() : [],
    bodyLook(definition.id, id, sheet, livery),
    model ? layerFrameFor(frame, model) : null,
  );
  if (definition.classId === 'road' && closed?.mirrorForm) {
    materials.reverse = lampMaterial(0x9ca8a7, 0xfff1d6);
    materials.reverse.name = 'Clear reversing optic';
    materials.reverse.roughness = 0.21;
  }
  const root = new T.Group();
  root.name = `${definition.name} ${id + 1} (procedural body)`;
  const fine = new T.Group();
  fine.name = 'Body LODs';
  root.add(fine);
  const lods: BuiltLod[] = [],
    wheels: WheelAssembly[][] = [],
    links: { mesh: T.Mesh; link: Link }[][] = [];
  const formulaTyres = definition.drs
    ? definition.wheelPositions.map((_, i) => formulaTreadState(sheet.wheels.width[i < 2 ? 0 : 1] / 2))
    : undefined;
  const linkGeometry = new T.CylinderGeometry(0.011, 0.011, 1, 6, 1, true);
  for (const detail of [0, 1, 2] as Detail[]) {
    const lod = emptyLod(`LOD ${detail} (${LOD_NAMES[detail]})`);
    let lodLinks: Link[] = [];
    if (model && closed) buildClosedBody(model, materials, detail, lod, cabin);
    else if (sheet.kind === 'open-wheel')
      lodLinks = buildOpenWheel(frame, sheet, materials, detail, lod, cabin);
    else if (sheet.kind === 'kart') buildKart(frame, sheet, materials, detail, lod, cabin);
    else if (sheet.kind === 'buggy')
      lodLinks = buildBuggy(frame, sheet, materials, detail, lod, cabin);
    const wheelGeometry = new Map<string, T.BufferGeometry>();
    const corners = definition.wheelPositions.map((p, i) => {
      const assembly = new WheelAssembly(
        frame.radius,
        p[0] > 0 ? 1 : -1,
        i < 2,
        sheet.wheels,
        detail,
        !!closed && festivalDetailFor(definition, closed),
        wheelGeometry,
        definition.classId === 'road',
        formulaTyres?.[i],
      );
      assembly.pivot.position.set(p[0], i < 2 ? frame.hubFront : frame.hubRear, p[2]);
      lod.group.add(assembly.pivot);
      return assembly;
    });
    const meshes = lodLinks.map((link) => {
      const mesh = new T.Mesh(
        linkGeometry,
        sheet.kind === 'buggy' ? sharedMaterials.steel() : sharedMaterials.carbon(),
      );
      mesh.castShadow = detail === 0;
      mesh.name = 'Suspension link';
      lod.group.add(mesh);
      return { mesh, link };
    });
    lod.group.visible = detail === 0;
    fine.add(lod.group);
    lods.push(lod);
    wheels.push(corners);
    links.push(meshes);
  }
  const proxy = shadowProxy(lods[2].group, wheels[2], definition, lods[2].flap);
  root.add(proxy);
  return {
    definition,
    root,
    fine,
    proxy,
    lods,
    wheels,
    formulaTyres,
    links,
    materials,
    frame,
    level: 0,
    feedLevel: null,
    near: false,
  } satisfies Built;
}
/** Faces that let sunlight into the cabin: glazing and the dark lid under it
 * (sharedMaterials.cabinLid). Seats and trim in the interior finish are solid
 * and keep casting (a buggy's seats sit in an open frame). */
function admitsLight(material: T.Material | undefined) {
  return (
    !material ||
    material.transparent ||
    !!material.userData.cabinLid ||
    !!material.userData.vehicleGlass
  );
}
/** One depth-only mesh: the far body and four posed wheel cylinders. The
 * glazing and the cabin lid are left out, so the sun reaches the near
 * cabin through the windows while the roof and body still shade it. */
function shadowProxy(far: T.Group, wheels: WheelAssembly[], def: VehicleDefinition, flap?: T.Mesh<T.BufferGeometry>) {
  const parts: T.BufferGeometry[] = [];
  far.updateMatrixWorld(true);
  far.traverse((o) => {
    if (!(o instanceof T.Mesh) || o === flap || o.name === 'Suspension link') return;
    let inWheel = false;
    for (let p: T.Object3D | null = o; p && p !== far; p = p.parent)
      if (wheels.some((w) => w.pivot === p)) inWheel = true;
    if (inWheel) return;
    const source = o.geometry as T.BufferGeometry,
      materials = Array.isArray(o.material) ? o.material : null;
    if (!materials && admitsLight(o.material as T.Material)) return;
    let g = source.clone();
    if (materials && source.index) {
      // Keep only the triangles of shadow-casting groups.
      const index: number[] = [],
        from = source.index.array;
      for (const group of source.groups)
        if (!admitsLight(materials[group.materialIndex ?? 0]))
          for (let k = group.start; k < group.start + group.count; k++) index.push(from[k]);
      if (!index.length) return;
      g.setIndex(index);
      g.clearGroups();
      g = g.toNonIndexed();
    }
    g.applyMatrix4(o.matrixWorld.clone().premultiply(far.matrixWorld.clone().invert()));
    parts.push(g);
  });
  // Place the articulated panel directly before the wheel block so all
  // frequently updated vertices occupy one contiguous GPU upload range.
  if (flap) parts.push(flap.geometry.clone().translate(flap.position.x, flap.position.y, flap.position.z));
  for (const w of wheels) {
    const g = new T.CylinderGeometry(w.radius, w.radius, 2 * w.halfWidth, 12).rotateZ(Math.PI / 2);
    g.translate(w.pivot.position.x, w.pivot.position.y, w.pivot.position.z);
    parts.push(g);
  }
  const flat = parts.map((g) => {
    const f = g.index ? g.toNonIndexed() : g;
    for (const name of Object.keys(f.attributes)) if (name !== 'position') f.deleteAttribute(name);
    f.clearGroups();
    return f;
  });
  const merged = mergeGeometries(flat, false);
  // Preserve the small wheel sections for frame-driven axle/radius updates;
  // the body remains static and the shadow retains one draw call.
  let first = 0;
  const moving: ShadowWheel[] = [];
  let movingFlap: ShadowFlap | undefined;
  flat.forEach((g, i) => {
    const position = g.getAttribute('position');
    if (flap && i === flat.length - 5) {
      const p = flap.geometry.getAttribute('position');
      // Catalogue aerofoil sections are already non-indexed triangle lists.
      movingFlap = { first, local: Float32Array.from(p.array), pivot: flap.position.clone(), angle: 0 };
    }
    if (i >= flat.length - 4) {
      const wheel = wheels[i - flat.length + 4];
      const local = Float32Array.from(position.array);
      for (let vertex = 0; vertex < position.count; vertex++) {
        local[vertex * 3] -= wheel.pivot.position.x;
        local[vertex * 3 + 1] -= wheel.pivot.position.y;
        local[vertex * 3 + 2] -= wheel.pivot.position.z;
      }
      moving.push({ first, local, hub: NaN, steer: NaN, camber: NaN, radiusScale: NaN });
    }
    first += position.count;
  });
  (merged.getAttribute('position') as T.BufferAttribute).setUsage(T.DynamicDrawUsage);
  merged.computeBoundingSphere();
  merged.boundingSphere!.radius += 0.5;
  for (const g of parts) g.dispose();
  for (const g of flat) if (!parts.includes(g)) g.dispose();
  const proxy = new T.Mesh(merged, new T.MeshBasicMaterial({ colorWrite: false }));
  proxy.name = `${def.name} shadow proxy (depth only)`;
  proxy.castShadow = true;
  proxy.receiveShadow = false;
  proxy.visible = false;
  shadowWheels.set(proxy, moving);
  if (movingFlap) shadowFlaps.set(proxy, movingFlap);
  return proxy;
}
export class VehicleBodies {
  private readonly contactPose = wheelContactPose();
  private readonly headPose = { compression: 0, headRoll: 0, headPitch: 0 };
  private readonly shadowPoint = new T.Vector3();
  private readonly shadowRotation = new T.Euler();
  private readonly shadowOrientation = new T.Quaternion();
  readonly root = new T.Group();
  private readonly bodies = new Map<number, Built>();
  /** Called once per newly built body (renderer material installers). */
  onBuild: (root: T.Object3D) => void = () => {};
  private readonly hub = new T.Vector3();
  private readonly end = new T.Vector3();
  private readonly up = new T.Vector3(0, 1, 0);
  constructor() {
    this.root.name = 'Vehicle bodies (procedural catalogue exteriors)';
  }
  /** Festival-only imported aero replaces this component after normal damage
   * posing. Circuit bodies and other parts remain entirely unchanged. */
  hideRearWing(id: number) {
    const body = this.bodies.get(id);
    if (!body) return;
    for (const lod of body.lods)
      for (const node of lod.rear) if (node.name === 'Rear wing (detachable)') node.visible = false;
  }
  /** The player's livery edit (entrant 0). Applies to the body already built
   * and to every later build; null (or the default identity) returns the
   * machine colourway. */
  private livery: LiveryInput | null = null;
  setPlayerLivery(livery: LiveryInput | null) {
    this.livery = livery ? { ...livery } : null;
    const body = this.bodies.get(0);
    if (!body) return;
    applyLook(
      body.materials,
      bodyLook(body.definition.id, 0, bodySheetFor(body.definition)!, this.livery),
    );
  }
  private build(id: number, definition: VehicleDefinition, sheet: BodySheet) {
    const built = buildVehicleBody(id, definition, sheet, id === 0 ? this.livery : null);
    this.root.add(built.root);
    this.onBuild(built.root);
    return built;
  }
  /** Pose bodies over their entrants and hide the Formula representation.
   * `a`, `b`, `alpha` are the interpolation endpoints; `headlights` lights
   * the lamps (night and dusk). */
  update(
    a: Float32Array,
    b: Float32Array,
    alpha: number,
    cars: readonly BodyHost[],
    headlights = false,
    view: BodyView = { follow: 0, cockpit: false, camera: null },
  ) {
    // Feeds refresh at 10-30 Hz; half a second without one (chase view,
    // mirrors off) stops posing the feed LODs' wheels.
    if (++this.framesSinceFeed > 30) for (const body of this.bodies.values()) body.feedLevel = null;
    for (let id = 0; id < cars.length; id++) {
      let body = this.bodies.get(id);
      if (id >= b[H.CARS]) {
        if (body) body.root.visible = false;
        continue;
      }
      const o = carBase(id),
        t = presentationAlpha(a, b, o, alpha),
        source = snapshotSource(a, b, t),
        definition = vehicleAt(Math.round(source[o + RACE_BASE + R.VEHICLE]));
      const sheet = bodySheetFor(definition);
      if (!sheet) {
        if (body) body.root.visible = false;
        cars[id].root.visible = true;
        continue;
      }
      if (!body || body.definition !== definition) {
        if (body) this.dispose(body);
        body = this.build(id, definition, sheet);
        this.bodies.set(id, body);
      }
      const host = cars[id].root;
      host.visible = false;
      body.root.visible = true;
      body.root.position.copy(host.position);
      body.root.quaternion.copy(host.quaternion);
      // Off-road (WP41): the mud and dust the car has picked up (O.MUD).
      const mud = sampleOffroadField(a, b, o, O.MUD, t);
      if (mud > 0.001 && !body.mud) installMudOn(body.root, (body.mud = mudUniforms()));
      if (body.mud) {
        body.mud.offroadMud.value = Math.min(1, Math.max(0, mud));
        body.mud.offroadMudWet.value = Math.min(
          1,
          Math.max(0, sampleOffroadField(a, b, o, O.MOISTURE, t) * 1.6),
        );
      }
      if (body.formulaTyres) {
        const rain = frameLiquidRain(source);
        const speed = sampleValue(a, b, o + F.SPEED, t);
        const compound = Math.round(source[o + F.COMPOUND]);
        for (let i = 0; i < body.formulaTyres.length; i++) {
          const wheel = o + WHEEL_BASE + i * WHEEL_STRIDE;
          sampleFormulaTread(body.formulaTyres[i], a, b, o, wheel, t, compound, rain, speed, true);
        }
      }
      const level = Math.max(0, Math.min(2, Math.round(cars[id].lodLevel ?? 0)));
      if (level !== body.level) {
        body.lods.forEach((lod, i) => (lod.group.visible = i === level));
        body.level = level;
      }
      const front = source[o + F.FRONT_HEALTH] > WING_DETACH_HEALTH,
        rear = source[o + F.REAR_HEALTH] > WING_DETACH_HEALTH;
      const brake = lerp(a[o + F.BRAKE], b[o + F.BRAKE], t);
      body.materials.tail.emissiveIntensity = brake > 0.05 ? 3.2 : headlights ? 1.1 : 0.55;
      body.materials.head.emissiveIntensity = headlights ? 2.6 : 0.35;
      if (body.materials.reverse)
        body.materials.reverse.emissiveIntensity = source[o + F.GEAR] < 0 ? 3.8 : 0;
      const positions = body.definition.wheelPositions;
      // Keep the cheap merged shadow's wheels on the same physical hubs.
      // A bounded round-cylinder envelope is sufficient at shadow-map detail.
      const proxyPosition = body.proxy.geometry.getAttribute('position') as T.BufferAttribute;
      const shadow = shadowWheels.get(body.proxy)!;
      const flap = shadowFlaps.get(body.proxy);
      const angle = flap ? formulaFlapAngle(sampleValue(a, b, o + RACE_BASE + R.DRS_FLAP, t)) : 0;
      const flapMoved = flap !== undefined && flap.angle !== angle;
      if (flap && flapMoved) {
        const c = Math.cos(angle), s = Math.sin(angle);
        for (let j = 0; j < flap.local.length; j += 3) {
          const y = flap.local[j + 1], z = flap.local[j + 2];
          proxyPosition.setXYZ(flap.first + j / 3, flap.pivot.x + flap.local[j],
            flap.pivot.y + c * y - s * z, flap.pivot.z + s * y + c * z);
        }
        flap.angle = angle;
      }
      // A newly chosen feed LOD can render before the next main update.
      for (const lod of body.lods) {
        if (lod.flap) lod.flap.rotation.x = angle;
        for (const e of lod.front) e.visible = front;
        for (const e of lod.rear) e.visible = rear;
      }
      let shadowMoved = false;
      shadow.forEach((pose, i) => {
        const { first, local } = pose;
        const p = o + WHEEL_BASE + i * WHEEL_STRIDE;
        const contact = sampleWheelContact(a, b, o, i, t, this.contactPose);
        const wheel = body.wheels[2][i];
        const radiusScale =
          contactCylinderRadius(
            contact,
            wheelValue(a, b, o, p, W.RADIUS, t) || wheel.radius,
            wheel.contact.bead,
            wheel.halfWidth,
          ) / wheel.radius;
        const hub = positions[i][1] - contactHubLength(contact, a, b, p, t);
        const steer = lerp(a[p + W.STEER], b[p + W.STEER], t);
        const camber = -lerp(a[p + W.CAMBER], b[p + W.CAMBER], t);
        if (
          hub === pose.hub &&
          steer === pose.steer &&
          camber === pose.camber &&
          radiusScale === pose.radiusScale
        )
          return;
        pose.hub = hub;
        pose.steer = steer;
        pose.camber = camber;
        pose.radiusScale = radiusScale;
        shadowMoved = true;
        this.shadowOrientation.setFromEuler(this.shadowRotation.set(0, steer, camber));
        for (let v = 0; v < local.length / 3; v++) {
          this.shadowPoint
            .set(local[v * 3], local[v * 3 + 1] * radiusScale, local[v * 3 + 2] * radiusScale)
            .applyQuaternion(this.shadowOrientation);
          proxyPosition.setXYZ(
            first + v,
            this.shadowPoint.x + positions[i][0],
            this.shadowPoint.y + hub,
            this.shadowPoint.z + positions[i][2],
          );
        }
      });
      if (shadowMoved || flapMoved) {
        // All four cylinders are contiguous after the static shell. Keep one
        // pending range if an off-screen shadow skips several upload frames.
        const start = (flap && flapMoved ? flap.first : shadow[0].first) * proxyPosition.itemSize;
        const pending = proxyPosition.updateRanges[0];
        if (!pending) proxyPosition.addUpdateRange(start, proxyPosition.array.length - start);
        else if (start < pending.start) {
          pending.start = start;
          pending.count = proxyPosition.array.length - start;
        }
        proxyPosition.needsUpdate = true;
      }
      // The main view's LOD, and the coarser one a rear-view feed shows.
      for (const shown of body.feedLevel !== null && body.feedLevel !== level
        ? [level, body.feedLevel]
        : [level]) {
        const lod = body.lods[shown];
        lod.wipers?.update(lerp(a[H.TIME], b[H.TIME], t), lerp(a[H.RAIN], b[H.RAIN], t), id);
        body.wheels[shown].forEach((wheel, i) => {
          const p = o + WHEEL_BASE + i * WHEEL_STRIDE;
          const contact = sampleWheelContact(a, b, o, i, t, this.contactPose);
          wheel.update(
            positions[i][1] - contactHubLength(contact, a, b, p, t),
            lerp(a[p + W.STEER], b[p + W.STEER], t),
            lerp(a[p + W.CAMBER], b[p + W.CAMBER], t),
            wheelPhase(a, b, o, p, t),
            wheelValue(a, b, o, p, W.LOAD, t),
            wheelValue(a, b, o, p, W.PRESSURE, t),
            wheelValue(a, b, o, p, W.DISC_TEMP, t),
            contact,
            wheelValue(a, b, o, p, W.RADIUS, t),
            wheelValue(a, b, o, p, W.OMEGA, t),
          );
        });
        for (const { mesh, link } of body.links[shown]) {
          const wheel = body.wheels[shown][link.wheel].pivot;
          this.hub.copy(link.offset).applyEuler(wheel.rotation).add(wheel.position);
          this.end.copy(this.hub).sub(link.inboard);
          const length = this.end.length();
          mesh.position.copy(link.inboard).addScaledVector(this.end, 0.5);
          mesh.quaternion.setFromUnitVectors(this.up, this.end.normalize());
          mesh.scale.set(1, length, 1);
        }
      }
      this.poseCabin(body, id, level, a, b, o, t, view);
    }
  }
  /** The near cabin: detail only for the followed car and cars within
   * CABIN_DETAIL_DISTANCE, the helmet hidden in the own cockpit view, the
   * glazing sorted last there, the wheel turned by the recorded steering and
   * the followed car's instruments redrawn from the snapshot. */
  private poseCabin(
    body: Built,
    id: number,
    level: number,
    a: Float32Array,
    b: Float32Array,
    o: number,
    alpha: number,
    view: BodyView,
  ) {
    const cabin = body.lods[0].cabin;
    if (!cabin) return;
    const followed = id === view.follow,
      own = followed && view.cockpit,
      reach = view.detailDistance ?? CABIN_DETAIL_DISTANCE;
    const near =
      level === 0 &&
      (followed ||
        (!!view.camera &&
          reach > 0 &&
          view.camera.distanceToSquared(body.root.position) < reach * reach));
    body.near = near;
    cabin.detail.visible = near;
    for (const part of cabin.wheelDetail) part.visible = near;
    cabin.head.visible = !own;
    for (const glass of cabin.glass) glass.renderOrder = own ? CABIN_GLASS_ORDER : 0;
    if (level !== 0) return;
    cabin.steering.rotation.z =
      -lerp(a[o + F.STEER], b[o + F.STEER], alpha) * cabin.layout.wheel.ratio;
    if (cabin.formulaShield) {
      const up = this.up.set(0, 1, 0).applyQuaternion(body.root.quaternion);
      const yaw =
        up.x * sampleValue(a, b, o + F.WX, alpha) +
        up.y * sampleValue(a, b, o + F.WY, alpha) +
        up.z * sampleValue(a, b, o + F.WZ, alpha);
      const speed = sampleValue(a, b, o + F.SPEED, alpha);
      const lateral = sampleValue(a, b, o + F.G_LAT, alpha);
      driverBodyPose(
        lateral,
        sampleValue(a, b, o + F.G_LONG, alpha),
        sampleValue(a, b, o + F.G_VERT, alpha),
        this.headPose,
      );
      const roll = clamp(this.headPose.headRoll * HEAD_ROLL_GAIN, -0.105, 0.105);
      cabin.head.rotation.set(
        this.headPose.headPitch,
        cornerGaze(speed, sampleValue(a, b, o + F.STEER, alpha), yaw),
        roll,
      );
      cabin.formulaShield.film.set(
        sampleValue(a, b, H.TIME, alpha),
        frameLiquidRain(snapshotSource(a, b, alpha)),
        speed,
        roll,
        lateral,
      );
    }
    // The gloves stay on the rim (and the elbows follow) as the wheel turns.
    cabin.arms?.update(cabin.steering.rotation.z);
    // Only the followed car redraws its instruments (a canvas upload each tick).
    if (followed) cabin.display?.update(snapshotSource(a, b, alpha), o);
  }
  private readonly feedShown: Built[] = [];
  private framesSinceFeed = 0;
  /** One rear-view feed pass (renderer mirror detail): every shown body at
   * the coarser of its main-view LOD and `choose(position, previous)` (its
   * size in that feed, with the feed's own hysteresis), and no cabin detail
   * (instruments, cages and harnesses are sub-pixel in a feed). The host
   * Formula representation is hidden for these bodies, so the renderer's own
   * feed LOD never reached them. `restoreFeedDetail` returns the main view. */
  showFeedDetail(choose: (position: T.Vector3, previous: number) => number) {
    this.restoreFeedDetail();
    this.framesSinceFeed = 0;
    for (const body of this.bodies.values()) {
      if (!body.root.visible) continue;
      const level = Math.max(
        body.level,
        Math.max(
          0,
          Math.min(2, Math.round(choose(body.root.position, body.feedLevel ?? body.level))),
        ),
      );
      body.feedLevel = level;
      const cabin = body.lods[0].cabin;
      if (level === body.level && !(level === 0 && cabin?.detail.visible)) continue;
      body.lods.forEach((lod, i) => (lod.group.visible = i === level));
      if (cabin) {
        cabin.detail.visible = false;
        for (const part of cabin.wheelDetail) part.visible = false;
      }
      this.feedShown.push(body);
    }
  }
  restoreFeedDetail() {
    for (const body of this.feedShown) {
      body.lods.forEach((lod, i) => (lod.group.visible = i === body.level));
      const cabin = body.lods[0].cabin;
      if (cabin) {
        cabin.detail.visible = body.near;
        for (const part of cabin.wheelDetail) part.visible = body.near;
      }
    }
    this.feedShown.length = 0;
  }
  /** The followed body's rear-view feed surfaces and the root that orients
   * them, while it is drawn near (null: none, or not a catalogue body). */
  mirrorsFor(id: number) {
    const body = this.bodies.get(id);
    const cabin = body?.lods[0].cabin;
    if (!body || !cabin || !body.root.visible || body.level !== 0 || cabin.mirrors.length !== 2)
      return null;
    return { root: body.root as T.Object3D, surfaces: cabin.mirrors, cockpitSurfaces: cabin.cockpitMirrors ?? cabin.mirrors };
  }
  /** The cabin layout of the body drawn for an entrant (diagnostics). */
  cabinOf(id: number) {
    const body = this.bodies.get(id);
    return body?.root.visible ? (body.lods[0].cabin ?? null) : null;
  }
  /** Shadow-pass substitution pairs (renderer ShadowProxies). */
  shadowSubstitutes(intactOnly = false): ShadowSubstitute[] {
    const out: ShadowSubstitute[] = [];
    for (const body of this.bodies.values()) {
      if (!body.root.visible) continue;
      if (intactOnly || body.lods[body.level].flap) {
        // The merged silhouette represents the intact catalogue shell. Use
        // the current geometry for broken parts and a replaced active wing.
        const lod = body.lods[body.level];
        if (lod.front.some((part) => !part.visible) || lod.rear.some((part) => !part.visible))
          continue;
      }
      out.push({ fine: body.fine, coarse: body.proxy });
    }
    return out;
  }
  private dispose(body: Built) {
    this.root.remove(body.root);
    const feedIndex = this.feedShown.indexOf(body);
    if (feedIndex !== -1) this.feedShown.splice(feedIndex, 1);
    // A grouped surface or suspension link can share its geometry with
    // another mesh. Release each buffer once, including the shadow proxy.
    const geometries = new Set<T.BufferGeometry>();
    body.root.traverse((o) => {
      if (o instanceof T.Mesh) geometries.add(o.geometry);
    });
    for (const geometry of geometries) geometry.dispose();
    body.lods[0].cabin?.display?.dispose();
    body.lods[0].cabin?.formulaShield?.material.dispose();
    // Paint, live lamps and wheel shaders belong to this car. Glass, trim,
    // rims, suits and optical covers are shared by the whole catalogue;
    // traversing and disposing every material would invalidate other cars.
    const { paint, accent, helmet, suit, head, tail, board } = body.materials;
    const materials = new Set<T.Material>([paint, accent, helmet, suit, head, tail, board]);
    if (body.materials.reverse) materials.add(body.materials.reverse);
    for (const wheels of body.wheels)
      for (const wheel of wheels) {
        if (wheel.tyre.customDepthMaterial) materials.add(wheel.tyre.customDepthMaterial);
        if (wheel.tyre.customDistanceMaterial) materials.add(wheel.tyre.customDistanceMaterial);
        for (const material of Array.isArray(wheel.tyre.material)
          ? wheel.tyre.material
          : [wheel.tyre.material])
          materials.add(material);
        if (wheel.disc) materials.add(wheel.disc);
      }
    for (const material of Array.isArray(body.proxy.material)
      ? body.proxy.material
      : [body.proxy.material])
      materials.add(material);
    // The board owns its canvas texture. Paint's environment map and
    // renderer-installed reflection textures have a separate lifetime.
    board.map?.dispose();
    for (const material of materials) material.dispose();
  }
  /** Retire one catalogue entry and its owned buffers on a field or garage change. */
  release(id: number) {
    const body = this.bodies.get(id);
    if (!body) return false;
    body.root.visible = false;
    this.dispose(body);
    this.bodies.delete(id);
    return true;
  }

  /** Release every built car and reset the rear-view feed state. Safe to
   * repeat; subsequent updates build fresh bodies using the same callback. */
  clear(): void {
    this.feedShown.length = 0;
    this.framesSinceFeed = 0;
    for (const body of this.bodies.values()) this.dispose(body);
    this.bodies.clear();
  }
  /** Bodies currently shown (diagnostics). */
  get count() {
    let n = 0;
    for (const body of this.bodies.values()) if (body.root.visible) n++;
    return n;
  }
}
