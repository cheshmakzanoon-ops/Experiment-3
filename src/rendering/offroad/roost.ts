import * as T from 'three';
import { disposeOffroadResources } from './owned-resources.ts';
import { clamp, Random } from '../../core/math.ts';
import { MATERIAL } from '../../simulation/surface-material.ts';
import { renderWind } from '../../simulation/weather.ts';
import {
  carBase,
  B,
  BIKE_BASE,
  F,
  H,
  O,
  OFFROAD_BASE,
  R,
  RACE_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
} from '../../simulation/protocol.ts';
import { vehicleAt, type VehicleDefinition } from '../../simulation/vehicles.ts';
import type { StartGate } from './start-gate.ts';
import { MxExhaustMist } from './mx-exhaust-mist.ts';
import { MxChassisShade } from './mx-chassis-shade.ts';
import { MotocrossAxles } from './motocross-axles.ts';
import { TrackTerrainSurface } from '../../simulation/offroad/course-terrain.ts';
import { Track, trackPoint } from '../../simulation/track.ts';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { MxDustMaterial } from './mx-dust-material.ts';
import { markItems } from '../attribute-ranges.ts';
import { chainShaderHook, injectAfter, injectDeclarations } from '../studio/shader-hooks.ts';

export interface MxWheelPatch {
  position: T.Vector3;
  normal: T.Vector3;
  forward: T.Vector3;
  station: number;
  lateral: number;
  onStartPad: boolean;
}

export function mxWheelPatch(): MxWheelPatch {
  return {
    position: new T.Vector3(),
    normal: new T.Vector3(),
    forward: new T.Vector3(),
    onStartPad: false,
    station: 0,
    lateral: 0,
  };
}

/** Loose ground a spinning tyre throws (WP41). */
const LOOSE = new Set<number>([
  MATERIAL.DIRT,
  MATERIAL.MUD,
  MATERIAL.SAND,
  MATERIAL.GRAVEL_ROAD,
  MATERIAL.GRAVEL,
  MATERIAL.GRASS,
]);
/** Particle pool size (clods and dust puffs share it). */
export const ROOST_CAPACITY = 2400;
/** Bound terrain queries independently of the number of entrants/particles. */
export const ROOST_GROUND_SAMPLES = 128;

function soilFragmentGeometry() {
  const geometry = new T.IcosahedronGeometry(0.5, 0);
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i),
      y = position.getY(i),
      z = position.getZ(i);
    // Repeated vertices receive the same offset, preserving closed faces.
    const grain = 0.82 + 0.17 * Math.sin(x * 19 + y * 31 + z * 23);
    position.setXYZ(i, x * grain, y * grain * 0.72, z * grain * 1.12);
  }
  // Weld the coincident corners so the lump also has a rounded normal field.
  // The shader blends it with the fractured face per particle wetness; the
  // twenty-triangle silhouette and draw stay exactly as before.
  geometry.deleteAttribute('normal');
  geometry.deleteAttribute('uv');
  const welded = mergeVertices(geometry);
  geometry.dispose();
  welded.computeVertexNormals();
  welded.setAttribute(
    'mxClodWet',
    new T.InstancedBufferAttribute(new Float32Array(ROOST_CAPACITY), 1).setUsage(
      T.DynamicDrawUsage,
    ),
  );
  welded.computeBoundingSphere();
  return welded;
}

/** Thrown soil as clay, not faceted gems. Dry clods keep their fractured
 * planes, crumb relief and a matte, mottled skin; wet clay slumps into a
 * rounded, darker lump whose film catches glints. Per-instance wetness is
 * the particle's own recorded soil moisture. No textures or extra draws. */
function installClodFinish(material: T.MeshStandardMaterial) {
  chainShaderHook(material, 'mx-roost-clod-v1', (shader) => {
    injectDeclarations(
      shader,
      'common',
      'attribute float mxClodWet;\nvarying float vMxClodWet;\nvarying vec3 vMxClodPosition;',
      'vertex',
    );
    injectAfter(
      shader,
      'begin_vertex',
      'vMxClodWet = mxClodWet;\nvMxClodPosition = position;',
      'vertex',
    );
    injectDeclarations(
      shader,
      'common',
      `
varying float vMxClodWet;
varying vec3 vMxClodPosition;
float mxClodRelief, mxClodMottle;
float mxClodHash( vec3 p ) {
  p = fract( p * 0.3183099 + 0.1 );
  p *= 17.0;
  return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
}
float mxClodNoise( vec3 x ) {
  vec3 i = floor( x ), f = fract( x );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mix( mxClodHash( i ), mxClodHash( i + vec3( 1, 0, 0 ) ), f.x ),
      mix( mxClodHash( i + vec3( 0, 1, 0 ) ), mxClodHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
    mix( mix( mxClodHash( i + vec3( 0, 0, 1 ) ), mxClodHash( i + vec3( 1, 0, 1 ) ), f.x ),
      mix( mxClodHash( i + vec3( 0, 1, 1 ) ), mxClodHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
}`,
      'fragment',
    );
    injectAfter(
      shader,
      'color_fragment',
      `{
  // Unit-lump coordinates: the grain scales with each clod, so it reads as
  // crumbs at every size and fades before it can sparkle.
  float resolved = 1.0 - smoothstep( 0.08, 0.3, length( fwidth( vMxClodPosition ) ) );
  float crumb = mxClodNoise( vMxClodPosition * 9.0 );
  float fine = mxClodNoise( vMxClodPosition * 23.0 + 5.1 );
  float dry = 1.0 - clamp( vMxClodWet, 0.0, 1.0 );
  mxClodMottle = crumb * 0.7 + fine * 0.3;
  mxClodRelief = ( ( crumb - 0.5 ) * 0.024 + ( fine - 0.5 ) * 0.01 ) * resolved
    * ( 0.35 + 0.65 * dry );
  // Dry fines dust the skin paler; wet clay is darker and more uniform.
  diffuseColor.rgb *= mix( 0.92, 0.84 + 0.3 * mxClodMottle, mix( 0.35, 1.0, dry ) );
  diffuseColor.rgb *= 1.0 - 0.12 * ( 1.0 - dry );
}`,
      'fragment',
    );
    injectAfter(
      shader,
      'normal_fragment_maps',
      `{
  // Fractured faces for dry crumbs, a slumped rounded lump for wet clay.
  vec3 faceNormal = normalize( cross( dFdx( vViewPosition ), dFdy( vViewPosition ) ) );
  faceNormal *= sign( dot( faceNormal, normal ) + 1e-6 );
  normal = normalize( mix( faceNormal, normal, 0.25 + 0.75 * clamp( vMxClodWet, 0.0, 1.0 ) ) );
  vec3 dx = dFdx( -vViewPosition ), dy = dFdy( -vViewPosition );
  vec3 r1 = cross( dy, normal ), r2 = cross( normal, dx );
  float det = dot( dx, r1 );
  float scale = length( dx ) / max( length( dFdx( vMxClodPosition ) ), 1e-6 );
  vec3 gradient = sign( det ) * scale *
    ( dFdx( mxClodRelief ) * r1 + dFdy( mxClodRelief ) * r2 );
  normal = normalize( max( abs( det ), 1e-10 ) * normal - gradient );
}`,
      'fragment',
    );
    injectAfter(
      shader,
      'roughnessmap_fragment',
      `roughnessFactor = mix( roughnessFactor, 0.42 + 0.22 * mxClodMottle,
        smoothstep( 0.25, 0.95, vMxClodWet ) );`,
      'fragment',
    );
  });
}
function softDisc(soft = false) {
  const size = 64,
    data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5,
        dy = (y + 0.5) / size - 0.5,
        r = Math.sqrt(dx * dx + dy * dy) * 2,
        a = clamp(1 - r, 0, 1) ** (soft ? 1.35 : 0.8);
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  const texture = new T.DataTexture(data, size, size, T.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}
/**
 * Roost: clods and dust thrown back by driven wheels spinning on loose
 * ground, from each entrant's snapshot (wheel load, slip and surface, body
 * pose, O.MOISTURE). Presentation only: its own random stream, never read by
 * the simulation, emitted the same way live and in replays. Wet soil throws
 * dark, heavy clods; dry soil adds pale dust that hangs.
 */
export class Roost {
  private disposed = false;
  readonly points: T.Points;
  readonly exhaust: MxExhaustMist | null;
  /** Solid soil shares the existing pool; this is one additional bounded draw. */
  readonly clods: T.InstancedMesh | null;
  readonly contactShadows: T.InstancedMesh | null;
  private readonly chassisShade: MxChassisShade | null;
  /** Optional displayed terrain sampler, including live/replayed rut depth. */
  startPad: Pick<StartGate, 'padHeightAt'> | null = null;
  groundHeight: ((s: number, lateral: number, plane?: T.Plane) => number) | null = null;
  private readonly positions = new Float32Array(ROOST_CAPACITY * 3);
  private readonly velocities = new Float32Array(ROOST_CAPACITY * 3);
  private readonly colours = new Float32Array(ROOST_CAPACITY * 3);
  private readonly life = new Float32Array(ROOST_CAPACITY);
  private readonly maxLife = new Float32Array(ROOST_CAPACITY);
  private readonly floor = new Float32Array(ROOST_CAPACITY);
  private readonly groundX = new Float32Array(ROOST_CAPACITY);
  private readonly groundZ = new Float32Array(ROOST_CAPACITY);
  private readonly groundNormal = new Float32Array(ROOST_CAPACITY * 3);
  private readonly groundAge = new Float32Array(ROOST_CAPACITY);
  private readonly particleWet = new Float32Array(ROOST_CAPACITY);
  private readonly bounced = new Uint8Array(ROOST_CAPACITY);
  private readonly settled = new Uint8Array(ROOST_CAPACITY);
  private readonly age = new Float32Array(ROOST_CAPACITY);
  private readonly settledAge = new Float32Array(ROOST_CAPACITY);
  private readonly drag = new Float32Array(ROOST_CAPACITY);
  private readonly sizes = new Float32Array(ROOST_CAPACITY);
  private readonly bornSize = new Float32Array(ROOST_CAPACITY);
  private readonly opacity = new Float32Array(ROOST_CAPACITY);
  /** Dust/clod kind and a stable silhouette seed, in the same bounded draw. */
  private readonly shapes = new Float32Array(ROOST_CAPACITY * 2);
  private readonly bornOpacity = new Float32Array(ROOST_CAPACITY);
  private readonly dust = new Uint8Array(ROOST_CAPACITY);
  private readonly emission = new Float64Array(64 * 4);
  private readonly wasAirborne = new Uint8Array(64);
  private readonly lastEmitter = new Float32Array(128 * 3);
  private readonly lastMachine = new Uint16Array(128);
  private readonly patchVelocity = new T.Vector3();
  private readonly angular = new T.Vector3();
  /** Each end consumes its own contact edge after a jump. */
  private readonly pendingImpact = new Uint8Array(64);
  private readonly impactSpeed = new Float32Array(64);
  private readonly impactAge = new Float32Array(64);
  private random = new Random(40817);
  private readonly q = new T.Quaternion();
  private readonly v = new T.Vector3();
  private readonly back = new T.Vector3();
  private readonly groundPlane = new T.Plane();
  private readonly contactNormal = new T.Vector3(0, 1, 0);
  private readonly point = trackPoint();
  private readonly shadowPose = new T.Object3D();
  private readonly hub = new T.Vector3();
  private readonly axle = new T.Vector3();
  private readonly side = new T.Vector3();
  private readonly basis = new T.Matrix4();
  private readonly patches: (MxWheelPatch | undefined)[] = [];
  private readonly loaded = new Uint8Array(128);
  private readonly clodPose = new T.Object3D();
  private readonly clodColour = new T.Color();
  private readonly terrain: TrackTerrainSurface | null;
  private readonly motocross: boolean;
  private readonly windExposed: boolean;
  private cursor = 0;
  private collisionCursor = 0;
  enabled = true;
  density = 1;
  constructor(private readonly track?: Track) {
    const surface = track ? Track.offroadOf(track) : null;
    this.terrain = surface instanceof TrackTerrainSurface ? surface : null;
    this.motocross = surface?.kind === 'motocross' || surface?.kind === 'supercross';
    this.windExposed = this.motocross && !this.terrain?.course.spec.indoor;
    const g = new T.BufferGeometry();
    g.setAttribute(
      'position',
      new T.BufferAttribute(this.positions, 3).setUsage(T.DynamicDrawUsage),
    );
    g.setAttribute('color', new T.BufferAttribute(this.colours, 3).setUsage(T.DynamicDrawUsage));
    g.setAttribute(
      'mxParticleSize',
      new T.BufferAttribute(this.sizes, 1).setUsage(T.DynamicDrawUsage),
    );
    g.setAttribute(
      'mxParticleAlpha',
      new T.BufferAttribute(this.opacity, 1).setUsage(T.DynamicDrawUsage),
    );
    if (this.motocross) {
      g.setAttribute(
        'mxParticleShape',
        new T.BufferAttribute(this.shapes, 2).setUsage(T.DynamicDrawUsage),
      );
      // Indices address the simulation ring directly. Only live fines enter
      // the transparent draw; solid fragments have their own opaque mesh.
      g.setIndex(new T.BufferAttribute(new Uint16Array(ROOST_CAPACITY), 1).setUsage(T.DynamicDrawUsage));
      g.setDrawRange(0, 0);
      // Birth floor of each particle: the dust shader fades a puff into it.
      g.setAttribute(
        'mxParticleFloor',
        new T.BufferAttribute(this.floor, 1).setUsage(T.DynamicDrawUsage),
      );
    }
    const material = this.motocross
      ? new MxDustMaterial()
      : new T.PointsMaterial({
          size: 0.11,
          sizeAttenuation: true,
          vertexColors: true,
          map: softDisc(),
          transparent: true,
          alphaTest: 0.04,
          depthWrite: false,
        });
    this.points = new T.Points(g, material);
    if (material instanceof MxDustMaterial)
      this.points.onBeforeRender = (renderer) => material.updateViewport(renderer);
    this.exhaust = material instanceof MxDustMaterial ? new MxExhaustMist(material) : null;
    if (this.exhaust) this.points.add(this.exhaust.points);
    this.points.name = 'Roost (clods and dust)';
    this.points.frustumCulled = false;
    this.clods = this.motocross
      ? new T.InstancedMesh(
          soilFragmentGeometry(),
          (() => {
            const material = new T.MeshStandardMaterial({ roughness: 0.94, metalness: 0 });
            installClodFinish(material);
            return material;
          })(),
          ROOST_CAPACITY,
        )
      : null;
    if (this.clods) {
      this.clods.name = 'MX lit soil fragments';
      this.clods.instanceMatrix.setUsage(T.DynamicDrawUsage);
      this.clods.setColorAt(0, this.clodColour);
      this.clods.instanceColor!.setUsage(T.DynamicDrawUsage);
      this.clods.count = 0;
      this.clods.frustumCulled = false;
      this.clods.receiveShadow = true;
    }
    this.life.fill(0);
    this.contactShadows = this.motocross
      ? new T.InstancedMesh(
          new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
          new T.MeshBasicMaterial({
            color: 0x100d09,
            map: softDisc(true),
            transparent: true,
            opacity: 0.38,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1,
            toneMapped: false,
          }),
          128,
        )
      : null;
    this.chassisShade = this.contactShadows
      ? new MxChassisShade((this.contactShadows.material as T.MeshBasicMaterial).map!)
      : null;
    if (this.contactShadows && this.chassisShade) {
      this.contactShadows.add(this.chassisShade.mesh);
      this.contactShadows.name = 'MX loaded tyre contact shadows';
      this.contactShadows.instanceMatrix.setUsage(T.DynamicDrawUsage);
      this.contactShadows.count = 0;
      this.contactShadows.frustumCulled = false;
      this.contactShadows.renderOrder = 1;
    }
    // Parked below the world until born.
    for (let i = 0; i < ROOST_CAPACITY; i++) this.positions[i * 3 + 1] = -1e4;
  }
  private spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    wet: number,
    dust: boolean,
  ) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % ROOST_CAPACITY;
    const r = this.random;
    this.positions.set([x, y, z], i * 3);
    this.velocities.set([vx, vy, vz], i * 3);
    const tone = 0.85 + 0.3 * r.next();
    // Linear albedo: dry loam dust to wet clay.
    const dry = dust ? [0.42, 0.35, 0.27] : [0.3, 0.23, 0.16],
      mud = [0.075, 0.055, 0.038];
    for (let c = 0; c < 3; c++) this.colours[i * 3 + c] = (dry[c] + (mud[c] - dry[c]) * wet) * tone;
    this.maxLife[i] = this.life[i] = dust ? 1.2 + r.next() : 0.6 + 0.6 * r.next();
    this.floor[i] = y - (this.motocross ? 0.045 : 0.35);
    this.groundX[i] = x;
    this.groundZ[i] = z;
    this.groundNormal[i * 3] = this.contactNormal.x;
    this.groundNormal[i * 3 + 1] = this.contactNormal.y;
    this.groundNormal[i * 3 + 2] = this.contactNormal.z;
    this.groundAge[i] = 0;
    this.particleWet[i] = wet;
    this.bounced[i] = this.settled[i] = 0;
    this.age[i] = this.settledAge[i] = 0;
    this.drag[i] = dust ? 2.5 : 0.25;
    this.dust[i] = dust ? 1 : 0;
    this.shapes[i * 2] = dust ? 1 : 0;
    this.shapes[i * 2 + 1] = (i * 0.61803398875) % 1;
    this.bornSize[i] = this.sizes[i] = this.motocross
      ? dust
        ? 0.34 + r.next() * 0.36
        : 0.035 + r.next() * 0.065
      : 1;
    this.bornOpacity[i] = this.opacity[i] = dust ? 0.24 * (1 - wet * 0.7) : 0.95;
    // Dry fines hang behind a pack as a visible trail (references 023/036/
    // 066): denser, broader and longer-lived than the first MX pass, still
    // translucent and suppressed further by moisture. The first frame keeps
    // its faint birth; the update's fade-in carries it to bornOpacity.
    if (this.motocross && dust) {
      this.bornOpacity[i] = 0.34 * (1 - wet * 0.8);
      this.opacity[i] = this.bornOpacity[i] * 0.3;
    }
    if (this.motocross)
      this.maxLife[i] = this.life[i] = dust ? 2.1 + r.next() * 1.5 : 0.55 + r.next() * 0.5;
  }
  /** The course mesh can supply the actual face at the time displayed.
   * Intersect the world vertical through the contact with that face. The
   * two-argument sampler remains usable while scenery is being built. */
  private displayedHeight(s: number, lateral: number, x: number, z: number) {
    const plane = this.groundPlane;
    plane.normal.set(0, 0, 0);
    const height = this.groundHeight!(s, lateral, plane);
    const n = plane.normal;
    return n.y > 0.1 ? -(n.x * x + n.z * z + plane.constant) / n.y : height;
  }
  private contact(x: number, z: number, rut: number, fallback: number) {
    this.contactNormal.set(0, 1, 0);
    if (!this.track || !this.terrain) return fallback;
    const p = this.point, t = this.terrain.terrain;
    const lateral = this.track.nearest(x, z, p), s = p.s;
    const height = this.groundHeight;
    const y = height
      ? this.displayedHeight(s, lateral, x, z)
      : t.baseHeight(s, lateral) - clamp(rut, 0, 0.3);
    if (height && this.groundPlane.normal.y > 0.1) {
      this.contactNormal.copy(this.groundPlane.normal);
      return y;
    }
    const across = height
      ? (height(s, lateral + 0.2) - height(s, lateral - 0.2)) / 0.4
      : (t.baseHeight(s, lateral + 0.2) - t.baseHeight(s, lateral - 0.2)) / 0.4;
    const along = height
      ? (height(s + 0.2, lateral) - height(s - 0.2, lateral)) / 0.4
      : (t.baseHeight(s + 0.2, lateral) - t.baseHeight(s - 0.2, lateral)) / 0.4;
    this.contactNormal
      .set(-across * p.nx - along * p.tx, 1, -across * p.nz - along * p.tz)
      .normalize();
    return y;
  }
  /** Last independently loaded tyre on the displayed frame. The renderer
   * owns these vectors; callers may read them until the next update. */
  wheelPatch(id: number, front: boolean): Readonly<MxWheelPatch> | undefined {
    const slot = id * 2 + (front ? 0 : 1);
    return this.loaded[slot] ? this.patches[slot] : undefined;
  }

  /** Use a raw worker sample to record the trace independently of camera
   * cadence. The supplied result is private to the caller. */
  recordedWheel(
    frame: Float32Array,
    o: number,
    front: boolean,
    def: VehicleDefinition,
    patch: MxWheelPatch,
  ) {
    this.q.set(frame[o + F.QX], frame[o + F.QY], frame[o + F.QZ], frame[o + F.QW]);
    this.sampleWheel(frame, o, front, def, patch);
  }

  private sampleWheel(
    frame: Float32Array,
    o: number,
    front: boolean,
    def: VehicleDefinition,
    patch: MxWheelPatch,
  ) {
    patch.onStartPad = false;
    const rut = frame[o + OFFROAD_BASE + (front ? O.RUT_FRONT : O.RUT_REAR)];
    const axles = def.bike?.offroad ? MotocrossAxles.of(def) : undefined;
    if (axles) {
      const b = o + BIKE_BASE;
      axles.hub(
        front,
        frame[b + (front ? B.FORK : B.SHOCK)],
        frame[b + B.STEER],
        this.hub,
        this.axle,
      );
    } else {
      this.hub.fromArray(def.wheelPositions[front ? 0 : 2]);
      this.axle.set(1, 0, 0);
    }
    this.hub.applyQuaternion(this.q);
    this.hub.x += frame[o + F.X];
    this.hub.y += frame[o + F.Y];
    this.hub.z += frame[o + F.Z];
    this.axle.applyQuaternion(this.q);
    const height = this.contact(this.hub.x, this.hub.z, rut, this.hub.y - def.spec.wheelRadius);
    patch.normal.copy(this.contactNormal);
    if (!axles) {
      patch.position.set(this.hub.x, height, this.hub.z);
      patch.forward.crossVectors(this.axle, patch.normal).normalize();
      return;
    }
    axles.groundPoint(front, this.hub, this.axle, patch.normal, patch.position, patch.forward);
    if (this.track && this.terrain) {
      // The contact moves sideways under lean and rearward under fork travel.
      // Re-sample the displayed height at that point, including deformed ruts.
      const lateral = this.track.nearest(patch.position.x, patch.position.z, this.point);
      patch.station = this.point.s;
      patch.lateral = lateral;
      patch.position.y = this.groundHeight
        ? this.displayedHeight(patch.station, lateral, patch.position.x, patch.position.z)
        : this.terrain.terrain.baseHeight(patch.station, lateral) - clamp(rut, 0, 0.3);
      if (this.groundHeight && this.groundPlane.normal.y > 0.1) {
        // Lean can place the tread on the other triangle of a rut. Use its
        // face for the ejection, print width and tyre shadow together.
        patch.normal.copy(this.groundPlane.normal);
        axles.rollingTangent(this.axle, patch.normal, patch.forward);
      }
    }
    const pad = this.startPad?.padHeightAt(patch.position.x, patch.position.z) ?? -Infinity;
    if (pad >= patch.position.y - 0.001) {
      patch.onStartPad = true;
      patch.normal.set(0, 1, 0);
      patch.forward.projectOnPlane(patch.normal).normalize();
      patch.position.y = pad;
    }
  }

  private shadows(frame: Float32Array) {
    const mesh = this.contactShadows;
    if (!mesh) return;
    let count = 0;
    this.loaded.fill(0);
    this.chassisShade?.begin();
    for (let id = 0; id < Math.min(64, frame[H.CARS]); id++) {
      const o = carBase(id),
        def = vehicleAt(Math.round(frame[o + RACE_BASE + R.VEHICLE]));
      if (def.dynamicsKind !== 'bike' || frame[o + F.RETIRED] > 0.5) continue;
      this.q.set(frame[o + F.QX], frame[o + F.QY], frame[o + F.QZ], frame[o + F.QW]);
      if (this.track && this.groundHeight && def.bike?.offroad)
        this.chassisShade?.add(frame[o + F.X], frame[o + F.Y], frame[o + F.Z], this.q,
          def.spec.wheelbase, this.track, this.groundHeight, this.startPad);
      if (frame[o + OFFROAD_BASE + O.AIRBORNE] > 0.5) continue;
      for (const wheel of [0, 2]) {
        const w = o + WHEEL_BASE + wheel * WHEEL_STRIDE;
        if (frame[w + W.LOAD] < 45) continue;
        const slot = id * 2 + (wheel === 0 ? 0 : 1);
        const patch = (this.patches[slot] ??= mxWheelPatch());
        this.sampleWheel(frame, o, wheel === 0, def, patch);
        this.loaded[slot] = 1;
        const pose = this.shadowPose;
        pose.position.copy(patch.position);
        pose.position.y += 0.022;
        this.side.crossVectors(patch.normal, patch.forward).normalize();
        pose.quaternion.setFromRotationMatrix(
          this.basis.makeBasis(this.side, patch.normal, patch.forward),
        );
        const load = clamp(frame[w + W.LOAD] / 650, 0.25, 1);
        pose.scale.set(0.38 + load * 0.12, 1, 0.6 + load * 0.2);
        pose.updateMatrix();
        mesh.setMatrixAt(count++, pose.matrix);
      }
    }
    this.chassisShade?.end();
    mesh.count = count;
    markItems(mesh.instanceMatrix, 0, count - 1);
  }
  /** A driven knobby cuts backwards, a locked wheel ploughs forward, and a
   * sliding rear pushes earth across the racing line. Resolve all three in
   * the tyre's actual contact plane, including yaw at this end of the bike. */
  private throwFromTyre(
    frame: Float32Array, body: number, wheel: number, id: number,
    patch: MxWheelPatch, step: number, wet: number,
  ) {
    const p = body + WHEEL_BASE + wheel * WHEEL_STRIDE;
    const rear = wheel === 2, slot = id * 4 + wheel, end = id * 2 + Number(rear);
    const speed = frame[body + F.SPEED], radius = frame[p + W.RADIUS];
    const treadSpeed = frame[p + W.OMEGA] * radius;
    if (Math.max(speed, treadSpeed) < 1.5) {
      this.emission[slot] = this.lastMachine[end] = 0;
      return;
    }
    const normal = patch.normal, forward = patch.forward, side = this.side.crossVectors(normal, forward);
    const velocity = this.patchVelocity.fromArray(frame, body + F.VX);
    this.v.fromArray(frame, body + F.X).sub(patch.position).negate();
    this.angular.fromArray(frame, body + F.WX).cross(this.v);
    velocity.add(this.angular);
    const along = velocity.dot(forward), across = clamp(velocity.dot(side), -12, 12);
    // Older/sparse frames without radius still carry a rear wheel-slip estimate.
    const mismatch = radius > 0 ? treadSpeed - along : rear ? Math.abs(frame[p + W.SLIP]) * speed : 0;
    const drive = rear ? clamp(mismatch - 0.6, 0, 24) : 0;
    const plough = clamp(-mismatch - 0.8, 0, 22);
    const scrub = clamp(Math.abs(across) - 0.55, 0, 10);
    const shear = clamp((drive + 0.63 * plough + 0.7 * scrub) / 3, 0, 1.5);
    const pressure = clamp(frame[p + W.LOAD] / 650, 0.15, 1.4);
    const rate = pressure * this.density * (shear * (48 + 5 * speed) +
      (1 - wet) * speed * (rear ? 1.32 : 0.4));
    const carry = this.emission[slot], quota = rate * step;
    const births = Math.floor(carry + quota);
    this.emission[slot] = carry + quota - births;
    const k = end * 3, previous = this.lastEmitter;
    const { x, y, z } = patch.position, machine = Math.round(frame[body + RACE_BASE + R.VEHICLE]) + 1;
    const dx = x - previous[k], dy = y - previous[k + 1], dz = z - previous[k + 2];
    // A seek, remount or replacement rider cannot lay a bridge of particles.
    const contiguous = this.lastMachine[end] === machine &&
      dx * dx + dy * dy + dz * dz <= (0.35 + 1.8 * speed * step) ** 2;
    const rng = this.random;
    for (let b = 0; b < Math.min(40, births); b++) {
      const t = contiguous ? clamp((b + 1 - carry) / quota, 0, 1) : 1;
      const dust = shear < 0.12 || rng.next() < (1 - wet) * (0.31 + 0.14 * Math.min(1, scrub));
      const sweep = across * (dust ? 0.18 : 0.48) + (rng.next() - 0.5) * (1.2 + 0.13 * plough);
      const fling = (0.09 * along + 0.28 * plough - 0.85 * drive) * (0.7 + 0.5 * rng.next());
      const lift = (dust ? 0.48 + shear * 0.7 : 1.2 + 0.23 * drive + 0.08 * plough + 0.16 * scrub) *
        (0.7 + 0.65 * rng.next());
      this.spawn(
        x - (1 - t) * dx, y - (1 - t) * dy + 0.045, z - (1 - t) * dz,
        forward.x * fling + side.x * sweep + normal.x * lift,
        forward.y * fling + side.y * sweep + normal.y * lift,
        forward.z * fling + side.z * sweep + normal.z * lift, wet, dust,
      );
    }
    previous[k] = x;
    previous[k + 1] = y;
    previous[k + 2] = z;
    this.lastMachine[end] = machine;
  }
  private publish() {
    const g = this.points.geometry;
    const mesh = this.clods;
    if (!mesh) {
      for (const name of ['position', 'color', 'mxParticleSize', 'mxParticleAlpha'])
        g.getAttribute(name).needsUpdate = true;
      return;
    }
    mesh.visible = this.enabled;
    const index = g.index!;
    let dustCount = 0, firstDust = ROOST_CAPACITY, lastDust = -1;
    let firstIndex = ROOST_CAPACITY, lastIndex = -1, count = 0;
    const pose = this.clodPose,
      clodWet = mesh.geometry.getAttribute('mxClodWet') as T.InstancedBufferAttribute;
    for (let i = 0; i < ROOST_CAPACITY; i++) {
      if (this.life[i] <= 0) continue;
      if (this.dust[i]) {
        if (index.getX(dustCount) !== i) {
          index.setX(dustCount, i);
          firstIndex = Math.min(firstIndex, dustCount);
          lastIndex = dustCount;
        }
        firstDust = Math.min(firstDust, i);
        lastDust = i;
        dustCount++;
        continue;
      }
      const k = i * 3,
        seed = this.shapes[i * 2 + 1];
      // Rotating lit faces preserve depth as the camera moves. Contract into
      // the soil at expiry instead of alpha-blending opaque fragments.
      const age = this.settled[i] ? this.settledAge[i] : this.age[i];
      const spin = age * (5 + seed * 17);
      const size = this.bornSize[i] * clamp(this.life[i] / 0.16, 0, 1);
      pose.position.set(this.positions[k], this.positions[k + 1], this.positions[k + 2]);
      pose.rotation.set(seed * 11 + spin, seed * 23 + spin * 0.67, seed * 7 - spin * 0.43);
      pose.scale.set(size * (0.7 + seed * 0.6), size, size * (1.2 - seed * 0.4));
      pose.updateMatrix();
      mesh.setMatrixAt(count, pose.matrix);
      this.clodColour.setRGB(this.colours[k], this.colours[k + 1], this.colours[k + 2]);
      clodWet.setX(count, this.particleWet[i]);
      mesh.setColorAt(count++, this.clodColour);
    }
    g.setDrawRange(0, dustCount);
    markItems(index, firstIndex, lastIndex);
    for (const attribute of Object.values(g.attributes))
      markItems(attribute as T.BufferAttribute, firstDust, lastDust);
    mesh.count = count;
    markItems(mesh.instanceMatrix, 0, count - 1);
    markItems(mesh.instanceColor!, 0, count - 1);
    markItems(clodWet, 0, count - 1);
  }
  update(frame: Float32Array, dt: number) {
    if (this.disposed) return;
    if (!Number.isFinite(dt) || dt < 0) return;
    this.points.visible = this.enabled;
    this.exhaust?.update(frame, this.enabled ? this.density : 0, this.windExposed);
    this.shadows(frame);
    if (this.clods) {
      this.clods.visible = this.enabled;
      // A camera move or a held race snapshot can change the contact shadow
      // projection above. The debris itself has no elapsed time to advance.
      if (dt === 0) return;
    }
    const step = Math.min(dt, 0.05);
    const windX = this.windExposed ? renderWind(frame[H.WIND_X]) : 0,
      windZ = this.windExposed ? renderWind(frame[H.WIND_Z]) : 0;
    let groundSamples = 0;
    // Rotate the starting slot so a full pool shares the ground-query budget.
    for (let slot = 0; slot < ROOST_CAPACITY; slot++) {
      const i = (slot + this.collisionCursor) % ROOST_CAPACITY;
      if (this.life[i] <= 0) continue;
      this.life[i] -= step;
      this.age[i] += step;
      const k = i * 3;
      const drag = Math.exp(-this.drag[i] * step);
      if (!this.settled[i]) {
        // Suspended fines entrain the recorded near-ground wind. The clods
        // that land beside the rut keep their much heavier ballistic path.
        // Arena Nord's roof and walls shelter the cloud from outdoor wind.
        const couple = this.dust[i] ? 0.65 * (1 - drag) : 0;
        this.velocities[k] = this.velocities[k] * drag + windX * couple;
        this.velocities[k + 2] = this.velocities[k + 2] * drag + windZ * couple;
        this.velocities[k + 1] =
          this.velocities[k + 1] * drag -
          9.81 * step * (this.drag[i] > 1 ? (this.motocross ? 0.025 : 0.08) : 1);
        this.positions[k] += this.velocities[k] * step;
        this.positions[k + 1] += this.velocities[k + 1] * step;
        this.positions[k + 2] += this.velocities[k + 2] * step;
      }
      let ground = this.floor[i];
      if (this.motocross) {
        let freshGround = !this.terrain;
        this.groundAge[i] += step;
        const x = this.positions[k],
          z = this.positions[k + 2];
        const dx = x - this.groundX[i],
          dz = z - this.groundZ[i];
        ground -=
          (this.groundNormal[k] * dx + this.groundNormal[k + 2] * dz) /
          Math.max(0.2, this.groundNormal[k + 1]);
        if (
          step > 0 &&
          !this.dust[i] &&
          !this.settled[i] &&
          this.terrain &&
          groundSamples < ROOST_GROUND_SAMPLES &&
          (this.groundAge[i] >= 0.075 ||
            dx * dx + dz * dz > 0.36 ||
            this.positions[k + 1] < ground + this.bornSize[i] * 0.24)
        ) {
          ground = this.contact(x, z, 0, ground);
          this.floor[i] = ground;
          this.groundX[i] = x;
          this.groundZ[i] = z;
          this.groundNormal[k] = this.contactNormal.x;
          this.groundNormal[k + 1] = this.contactNormal.y;
          this.groundNormal[k + 2] = this.contactNormal.z;
          this.groundAge[i] = 0;
          freshGround = true;
          groundSamples++;
        }
        if (
          step > 0 &&
          !this.dust[i] &&
          !this.settled[i] &&
          freshGround &&
          this.positions[k + 1] < ground + this.bornSize[i] * 0.24
        ) {
          const nx = this.groundNormal[k],
            ny = this.groundNormal[k + 1],
            nz = this.groundNormal[k + 2];
          const normalSpeed =
            this.velocities[k] * nx + this.velocities[k + 1] * ny + this.velocities[k + 2] * nz;
          this.positions[k + 1] = ground + this.bornSize[i] * 0.24;
          if (!this.bounced[i] && normalSpeed < -0.8 && this.particleWet[i] < 0.65) {
            // A single damped hop for dry crumbs; wet clay sticks. These are
            // presentation dynamics, never a write to the race simulation.
            const restitution = 0.26 * (1 - this.particleWet[i]);
            const friction = 0.52 - this.particleWet[i] * 0.25;
            this.velocities[k] =
              (this.velocities[k] - nx * normalSpeed) * friction - nx * normalSpeed * restitution;
            this.velocities[k + 1] =
              (this.velocities[k + 1] - ny * normalSpeed) * friction -
              ny * normalSpeed * restitution;
            this.velocities[k + 2] =
              (this.velocities[k + 2] - nz * normalSpeed) * friction -
              nz * normalSpeed * restitution;
            this.bounced[i] = 1;
            this.life[i] = Math.min(this.life[i], 0.45);
          } else {
            this.settled[i] = 1;
            this.settledAge[i] = this.age[i];
            this.velocities[k] = this.velocities[k + 1] = this.velocities[k + 2] = 0;
            this.life[i] = Math.min(this.life[i], 0.26);
          }
        }
      }
      if (this.motocross) {
        const remaining = clamp(this.life[i] / this.maxLife[i], 0, 1);
        this.sizes[i] = this.bornSize[i] * (this.dust[i] ? 1 + (1 - remaining) * 5 : 1);
        this.opacity[i] = this.dust[i]
          ? this.bornOpacity[i] * remaining * Math.min(1, (1 - remaining) * 12 + 0.3)
          : this.bornOpacity[i] * Math.min(1, remaining * 4);
      }
      if (
        this.life[i] <= 0 ||
        ((!this.motocross || this.dust[i]) && this.positions[k + 1] < ground)
      ) {
        this.life[i] = 0;
        this.opacity[i] = 0;
        this.positions[k + 1] = -1e4;
      }
    }
    if (step > 0)
      this.collisionCursor = (this.collisionCursor + ROOST_GROUND_SAMPLES) % ROOST_CAPACITY;
    if (!this.enabled || dt === 0) {
      this.lastMachine.fill(0);
      this.publish();
      return;
    }
    const r = this.random,
      cars = Math.min(64, frame[H.CARS]);
    this.lastMachine.fill(0, cars * 2);
    for (let id = 0; id < cars; id++) {
      const o = carBase(id),
        def = vehicleAt(Math.round(frame[o + RACE_BASE + R.VEHICLE])),
        speed = frame[o + F.SPEED],
        wet = clamp(frame[o + OFFROAD_BASE + O.MOISTURE] * 1.6, 0, 1);
      this.q.set(frame[o + F.QX], frame[o + F.QY], frame[o + F.QZ], frame[o + F.QW]);
      this.back.set(0, 0, -1).applyQuaternion(this.q);
      const bike = def.dynamicsKind === 'bike';
      const airborne = frame[o + OFFROAD_BASE + O.AIRBORNE] > 0.5;
      // The whole-bike edge captures the impact, but the front and rear
      // consume it only when their own tyre is loaded. A front-first landing
      // cannot throw dirt from a rear wheel that is still above the soil.
      if (this.motocross && bike) {
        if (airborne) this.pendingImpact[id] = 0;
        else if (this.wasAirborne[id]) {
          this.pendingImpact[id] = 3;
          this.impactSpeed[id] = clamp(frame[o + OFFROAD_BASE + O.LANDING_SPEED], 0, 12);
          this.impactAge[id] = 0;
        } else {
          this.impactAge[id] += step;
          if (this.impactAge[id] > 0.3) this.pendingImpact[id] = 0;
        }
      }
      this.wasAirborne[id] = airborne ? 1 : 0;
      // MX also observes the front contact for rolling dust and touchdowns.
      const wheels = bike
        ? this.motocross
          ? [0, 2]
          : [2]
        : def.drivetrain === 'fwd'
          ? [0, 1]
          : def.drivetrain === 'rwd'
            ? [2, 3]
            : [0, 1, 2, 3];
      for (const wheel of wheels) {
        const p = o + WHEEL_BASE + wheel * WHEEL_STRIDE,
          slot = id * 4 + wheel;
        const load = frame[p + W.LOAD],
          slip = Math.abs(frame[p + W.SLIP]);
        const patch = this.motocross && bike ? this.wheelPatch(id, wheel === 0) : undefined;
        const loose = !patch?.onStartPad && LOOSE.has(Math.round(frame[p + W.SURFACE]));
        let x: number, y: number, z: number;
        if (patch) {
          x = patch.position.x;
          y = patch.position.y + 0.045;
          z = patch.position.z;
          this.contactNormal.copy(patch.normal);
          this.back.copy(patch.forward).negate();
        } else {
          const local = def.wheelPositions[wheel];
          this.v.set(local[0], local[1] - 0.25, local[2]).applyQuaternion(this.q);
          x = frame[o + F.X] + this.v.x;
          z = frame[o + F.Z] + this.v.z;
          y =
            this.motocross && loose && load >= 50
              ? this.contact(
                  x,
                  z,
                  frame[o + OFFROAD_BASE + (wheel === 0 ? O.RUT_FRONT : O.RUT_REAR)],
                  frame[o + F.Y] + this.v.y,
                ) + 0.045
              : frame[o + F.Y] + this.v.y;
        }
        const impactBit = wheel === 0 ? 1 : 2;
        if (
          this.motocross &&
          bike &&
          this.pendingImpact[id] & impactBit &&
          !airborne &&
          load >= 50
        ) {
          this.pendingImpact[id] &= ~impactBit;
          const impact = this.impactSpeed[id];
          const count = loose && impact > 1.2 ? Math.round((4 + impact * 1.5) * this.density) : 0;
          for (let b = 0; b < count; b++) {
            const angle = r.next() * Math.PI * 2,
              outward = 0.7 + r.next() * impact * 0.45;
            this.spawn(
              x,
              y,
              z,
              Math.cos(angle) * outward,
              0.4 + r.next() * impact * 0.23,
              Math.sin(angle) * outward,
              wet,
              wet < 0.6 && b % 3 !== 0,
            );
          }
        }
        if (this.motocross && bike) {
          if (patch && loose && load >= 50 && !airborne) {
            this.throwFromTyre(frame, o, wheel, id, patch, step, wet);
          } else {
            this.lastMachine[id * 2 + Number(wheel === 2)] = this.emission[slot] = 0;
          }
          continue;
        }
        if (!loose || load < 50 || speed < 1.5) {
          this.emission[slot] = 0;
          continue;
        }
        // Spin throws clods; plain rolling on dry ground lifts a little dust.
        const driven = !bike || wheel === 2;
        const spin = driven ? clamp((slip - 0.04) * 6, 0, 1.5) : 0,
          rate =
            (spin * (40 + speed * 6) +
              (1 - wet) * speed * (driven ? 0.6 : 0.18)) *
            (bike ? 1 : 0.7) *
            this.density;
        const sideKick = this.motocross ? clamp(frame[p + W.ANGLE], -0.5, 0.5) * speed * 0.35 : 0;
        this.emission[slot] += rate * (this.motocross ? step : dt);
        let births = Math.floor(this.emission[slot]);
        this.emission[slot] -= births;
        births = Math.min(births, 40);
        for (let b = 0; b < births; b++) {
          const throwSpeed = 2 + spin * (3 + speed * 0.25) + r.next() * 2,
            dust = spin < 0.15 || r.next() < (1 - wet) * 0.25;
          this.spawn(
            x,
            y,
            z,
            frame[o + F.VX] * 0.5 +
              this.back.x * throwSpeed -
              this.back.z * sideKick +
              (r.next() - 0.5) * 2,
            (dust ? 0.6 : 1.5 + spin * 2.5) * (0.6 + 0.8 * r.next()),
            frame[o + F.VZ] * 0.5 +
              this.back.z * throwSpeed +
              this.back.x * sideKick +
              (r.next() - 0.5) * 2,
            wet,
            dust,
          );
        }
      }
    }
    this.publish();
  }
  clear() {
    this.exhaust?.clear();
    this.life.fill(0);
    for (let i = 0; i < ROOST_CAPACITY; i++) this.positions[i * 3 + 1] = -1e4;
    this.emission.fill(0);
    this.lastMachine.fill(0);
    this.opacity.fill(0);
    this.wasAirborne.fill(0);
    this.loaded.fill(0);
    this.pendingImpact.fill(0);
    this.impactAge.fill(0);
    this.impactSpeed.fill(0);
    this.cursor = this.collisionCursor = 0;
    this.random = new Random(40817);
    if (this.motocross) this.points.geometry.setDrawRange(0, 0);
    this.points.geometry.getAttribute('position').needsUpdate = true;
    this.points.geometry.getAttribute('mxParticleAlpha').needsUpdate = true;
    this.chassisShade?.begin();
    this.chassisShade?.end();
    if (this.contactShadows) this.contactShadows.count = 0;
    if (this.clods) this.clods.count = 0;
  }
  /** Live particles (diagnostics, tests). */
  get active() {
    let n = 0;
    for (let i = 0; i < ROOST_CAPACITY; i++) if (this.life[i] > 0) n++;
    return n;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
    this.groundHeight = this.startPad = null;
    disposeOffroadResources(
      [this.points, this.clods, this.contactShadows].filter((root) => root !== null),
    );
  }
}
