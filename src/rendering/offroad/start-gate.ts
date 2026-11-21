import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp } from '../../core/math.ts';
import type { OffroadCourse } from '../../simulation/offroad/course.ts';
import { GATE_DROP_SECONDS, gateSlots } from '../../simulation/offroad/session.ts';
import { H } from '../../simulation/protocol.ts';
import { PHASE } from '../../simulation/race.ts';
import { trackPoint, type Track } from '../../simulation/track.ts';
import { installScannedMaps, libraryAlbedo } from '../ground/scanned-ground.ts';
import { materials } from '../materials/index.ts';
import { installMud, mudUniforms } from './mud.ts';
import {
  MX_START_GRATE, mxStartGrate, mxStartSlab, mxStartGrateDistanceMaterial, mxStartGrateDistancePlane,
} from './mx-start-grate.ts';
import { MX_SOIL_COLOURS } from './mx-soil-detail.ts';
import { chainShaderHook, injectAfter, injectDeclarations } from '../studio/shader-hooks.ts';
import { collectOffroadMaps, disposeOffroadResources } from './owned-resources.ts';

/** Gate panel (m): a perforated steel grate hinged at its foot. */
const PANEL = Object.freeze({ height: 0.52, gap: 0.08 });

/** The starter's pad after a day of motos: a patchy skin of tracked-in soil,
 * clods shed at the gate, a worn, rubber-dark lane under every slot and the
 * soil spray the rear tyres threw back at each drop. Coordinates are the
 * slab's own metres (x across the gate, z toward it); lane spacing/offset
 * follow the session's slots. Shading only: no geometry, textures or draws. */
function installStartPadDirt(material: T.MeshPhysicalMaterial, lanes: T.IUniform<T.Vector3>, indoor: boolean) {
  chainShaderHook(material, `mx-start-pad-${indoor ? 'sx' : 'mx'}-stencils-v3`, (shader) => {
    shader.uniforms.mxPadLanes = lanes;
    shader.uniforms.mxPadSoil = {
      value: new T.Color(MX_SOIL_COLOURS.hardpack),
    };
    injectDeclarations(shader, 'common', 'varying vec3 vMxPadPosition;', 'vertex');
    injectAfter(shader, 'begin_vertex', 'vMxPadPosition = position;', 'vertex');
    injectDeclarations(
      shader,
      'common',
      `
varying vec3 vMxPadPosition;
uniform vec3 mxPadLanes;
uniform vec3 mxPadSoil;
float mxPadDirt, mxPadHeight;
// A painted block numeral cut from a reusable gate stencil. Glyphs are in
// metres, with the top of each numeral facing the drop and the riding line.
float mxPadDigit( vec2 p, int digit, float aa ) {
  int bars = digit == 0 ? 63 : digit == 1 ? 6 : digit == 2 ? 91 : digit == 3 ? 79
    : digit == 4 ? 102 : digit == 5 ? 109 : digit == 6 ? 125 : digit == 7 ? 7
    : digit == 8 ? 127 : 111;
  // Reflect into each quadrant. Only the nearest vertical and horizontal
  // stroke can cover this point, even at the joins of a worn numeral.
  vec2 q = abs( p );
  int vertical = p.x > 0.0 ? (p.y > 0.0 ? 2 : 4) : (p.y > 0.0 ? 32 : 16);
  int horizontal = q.y < 0.050 ? 64 : (p.y > 0.0 ? 1 : 8);
  float dx = length( vec2( q.x - 0.047, max( abs( q.y - 0.050 ) - 0.031, 0.0 ) ) );
  float dy = length( vec2( max( q.x - 0.031, 0.0 ), min( q.y, abs( q.y - 0.100 ) ) ) );
  float d = min( (bars & vertical) != 0 ? dx : 1.0, (bars & horizontal) != 0 ? dy : 1.0 );
  return 1.0 - smoothstep( 0.010 - aa, 0.010 + aa, d );
}
float mxPadHash( vec2 p ) {
  vec3 q = fract( vec3( p.xyx ) * 0.1031 );
  q += dot( q, q.yzx + 33.33 );
  return fract( ( q.x + q.y ) * q.z );
}
float mxPadNoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mxPadHash( i ), mxPadHash( i + vec2( 1.0, 0.0 ) ), f.x ),
    mix( mxPadHash( i + vec2( 0.0, 1.0 ) ), mxPadHash( i + 1.0 ), f.x ), f.y );
}`,
      'fragment',
    );
    injectAfter(
      shader,
      'color_fragment',
      `{
  vec2 p = vMxPadPosition.xz;
  float footprint = length( fwidth( p ) );
  float fine = 1.0 - smoothstep( 0.004, 0.02, footprint );
  float broad = mxPadNoise( p * 1.3 );
  float patches = 0.6 * mxPadNoise( p * 4.3 + 11.0 ) + 0.4 * mxPadNoise( p * 11.0 + 5.0 );
  float grit = mxPadNoise( p * 37.0 + 3.0 );
  // Toward the gate (z = +1.3): soil shed by front wheels and dropped panels.
  float gate = smoothstep( 0.1, 1.3, p.y );
  // Every slot's lane: tyres sat and spun here; the spray fans out behind.
  float laneIndex = floor( ( p.x - mxPadLanes.y ) / mxPadLanes.x + 0.5 );
  float localX = p.x - mxPadLanes.y - laneIndex * mxPadLanes.x;
  float across = abs( localX );
  float behind = clamp( ( -0.35 - p.y ) / 0.95, 0.0, 1.0 );
  float lane = ( 1.0 - smoothstep( 0.04, 0.12, across ) ) * smoothstep( -0.6, -0.3, p.y )
    * ( 1.0 - smoothstep( 0.95, 1.25, p.y ) ) * ( 0.55 + 0.45 * patches );
  float spray = ( 1.0 - smoothstep( 0.05 + behind * 0.3, 0.2 + behind * 0.45, across ) )
    * ( 1.0 - smoothstep( -0.55, -0.25, p.y ) ) * smoothstep( 0.25, 0.75, patches + 0.25 * grit );
  mxPadDirt = clamp( 0.16 + 0.3 * broad + 0.34 * patches + 0.42 * gate * ( 0.5 + 0.5 * patches )
    + 0.4 * spray, 0.0, 1.0 );
  mxPadDirt *= smoothstep( 0.05, 0.45, mxPadDirt + 0.22 * ( grit - 0.5 ) * fine );
  vec3 soil = mxPadSoil * ( 0.8 + 0.34 * patches ) * ( 1.0 + ( grit - 0.5 ) * 0.25 * fine );
  diffuseColor.rgb = mix( diffuseColor.rgb, soil, mxPadDirt * 0.88 );
  // Rubber and packed soil darken the worn lanes where the tyres sat.
  diffuseColor.rgb *= 1.0 - lane * 0.28;
  mxPadHeight = mxPadDirt * ( 0.0012 + 0.0016 * grit ) * fine;
  float aa = max( 0.001, 0.55 * footprint );
  float top = smoothstep( 0.052, 0.059, vMxPadPosition.y );
  // Saw cuts split the poured pad every second slot. Dark soil remains
  // in the cut; the joint also affects the existing surface normal.
  float jointX = abs( fract( (p.x - mxPadLanes.y) / (2.0 * mxPadLanes.x) - 0.25 + 0.5 ) - 0.5 ) * (2.0 * mxPadLanes.x);
  float joint = (1.0 - smoothstep( 0.004 - aa, 0.007 + aa, jointX )) * top
    * (1.0 - smoothstep( 0.016, 0.045, footprint ));
  diffuseColor.rgb *= 1.0 - 0.46 * joint;
  mxPadHeight -= 0.0028 * joint;
  float number = laneIndex + 1.0;
  vec2 mark = vec2( -localX + 0.28, p.y + ${indoor ? '1.15' : '0.88'} );
  if ( top > 0.0 && number >= 1.0 && number <= mxPadLanes.z && abs( mark.y ) < 0.15 && abs( mark.x ) < 0.18 ) {
    int n = int( number );
    float ink = n < 10 ? mxPadDigit( mark, n, aa ) : max(
      mxPadDigit( mark + vec2( 0.066, 0.0 ), n / 10, aa ),
      mxPadDigit( mark - vec2( 0.066, 0.0 ), n % 10, aa ) );
    float wear = mix( 0.76, smoothstep( 0.17, 0.52, grit ), fine );
    vec3 chalk = vec3( 0.72, 0.65, 0.48 );
    diffuseColor.rgb = mix( diffuseColor.rgb, chalk, ink * wear * top * (1.0 - 0.76 * mxPadDirt) );
  }
}`,
      'fragment',
    );
    injectAfter(
      shader,
      'roughnessmap_fragment',
      'roughnessFactor = mix( roughnessFactor, 0.95, mxPadDirt * 0.85 );',
      'fragment',
    );
    injectAfter(
      shader,
      'normal_fragment_maps',
      `{
  vec3 dx = dFdx( -vViewPosition ), dy = dFdy( -vViewPosition );
  vec3 r1 = cross( dy, normal ), r2 = cross( normal, dx );
  float det = dot( dx, r1 );
  vec3 gradient = sign( det ) * ( dFdx( mxPadHeight ) * r1 + dFdy( mxPadHeight ) * r2 );
  normal = normalize( max( abs( det ), 1e-10 ) * normal - gradient );
}`,
      'fragment',
    );
  });
}
/**
 * Motocross / supercross start gate (WP41): one hinged steel panel per slot
 * across the start straight, a concrete starter's pad behind the line and
 * end posts. The panels stand while the field is held and fall forward
 * together over GATE_DROP_SECONDS once the session's synchronised release
 * fires (race time from the snapshot), so live play and replays agree. A
 * field larger than the venue's slots widens the gate exactly as the
 * session does (`gateSlots` with the rider count from the snapshot), so
 * every rider has a panel in front of it.
 */
export class StartGate {
  readonly root = new T.Group();
  private hinge = new T.Group();
  private body = new T.Group();
  private slots = 0;
  private readonly padForward = new T.Vector2();
  private disposed = false;
  private readonly ownedTextures = new Set<T.Texture>();
  private readonly steel = materials.metal({ kind: 'bare', metal: 'steel', roughness: 0.48 });
  // Galvanised grates on a dark, weathered steel frame.
  private readonly frame = materials.metal({
    kind: 'cast',
    metal: 'steel',
    color: 0x3b3f44,
    roughness: 0.62,
  });
  private readonly pad = materials.concrete({ variant: 'rough', horizontal: 1 });
  private readonly lanes = { value: new T.Vector3(1, 0, 1) };
  private grateDistanceMaterial?: T.MeshStandardMaterial;
  constructor(
    private readonly track: Track,
    private readonly course: OffroadCourse,
  ) {
    const gate = course.spec.gate!;
    const p = trackPoint();
    track.at(gate.s, p);
    this.root.name = 'Start gate';
    collectOffroadMaps(this.pad, this.ownedTextures);
    installScannedMaps(this.pad, 'concrete', libraryAlbedo(this.pad));
    // A gate that has dropped for every moto carries roost: a dusty film and
    // damp splatter low on the grates and frame, cleaner toward the top bar.
    const roost = mudUniforms();
    roost.offroadMud.value = 0.42;
    roost.offroadMudWet.value = 0.25;
    installMud(this.steel, roost);
    installMud(this.frame, roost);
    installStartPadDirt(this.pad, this.lanes, course.kind === 'supercross');
    this.root.position.set(p.x, p.y, p.z);
    // Local +Z along the lap, +X along the track normal (lateral).
    this.root.rotation.y = Math.atan2(p.tx, p.tz);
    this.padForward.set(p.tx, p.tz).normalize();
    this.build(gate.slots);
  }
  /** Panels for `riders` slots (at least the venue's own), as the session lays them out. */
  private build(riders: number) {
    const gate = this.course.spec.gate!;
    this.root.remove(this.body);
    const oldGeometry = new Set<T.BufferGeometry>();
    this.body.traverse((o) => {
      if (o instanceof T.InstancedMesh) o.dispose();
      if (o instanceof T.Mesh) oldGeometry.add(o.geometry);
    });
    for (const g of oldGeometry) g.dispose();
    this.body = new T.Group();
    this.hinge = new T.Group();
    const { lateral } = gateSlots(this.track, this.course, riders);
    this.slots = lateral.length;
    // Equally spaced slot centres: the pad's lane pattern repeats with them.
    this.lanes.value.set(gate.spacing, lateral[0] ?? 0, lateral.length);
    const panelWidth = gate.spacing - PANEL.gap;
    // Identical gate leaves share a shaft and release time. One rotating
    // parent keeps the hinge pin stationary without uploading instance data.
    const half = panelWidth / 2 - 0.018;
    const crossTube = (length: number, radius: number, segments = 10) =>
      new T.CylinderGeometry(radius, radius, length, segments).rotateZ(Math.PI / 2);
    const merged = (parts: T.BufferGeometry[]) => {
      const geometry = mergeGeometries(parts, false)!;
      for (const part of parts) part.dispose();
      return geometry;
    };
    const welds: T.BufferGeometry[] = [];
    for (let i = 1; i < 8; i++)
      welds.push(
        new T.CylinderGeometry(0.0105, 0.0105, PANEL.height - 0.043, 7).translate(
          (i / 4 - 1) * half,
          PANEL.height * 0.5,
          0,
        ),
      );
    for (const y of [0.025, PANEL.height * 0.46])
      welds.push(crossTube(half * 2, 0.012).translate(0, y, -0.003));
    // Continuous bent outer hoop, rounded over the top corners.
    const bow = new T.CurvePath<T.Vector3>();
    const v = (x: number, y: number) => new T.Vector3(x, y, 0);
    const h = PANEL.height,
      r = 0.052;
    bow.add(new T.LineCurve3(v(-half, 0), v(-half, h - r)));
    bow.add(new T.QuadraticBezierCurve3(v(-half, h - r), v(-half, h), v(-half + r, h)));
    bow.add(new T.LineCurve3(v(-half + r, h), v(half - r, h)));
    bow.add(new T.QuadraticBezierCurve3(v(half - r, h), v(half, h), v(half, h - r)));
    bow.add(new T.LineCurve3(v(half, h - r), v(half, 0)));
    const tubes: T.BufferGeometry[] = [new T.TubeGeometry(bow, 48, 0.0175, 8, false)];
    for (const side of [-1, 1])
      tubes.push(crossTube(0.085, 0.026).translate(side * (half - 0.025), 0, 0));
    this.hinge.name = 'MX synchronised gate leaves';
    this.hinge.position.set(0, 0.028, 0.06);
    this.body.add(this.hinge);
    const mounts = new T.Matrix4();
    for (const [geometry, material] of [
      [merged(welds), this.steel],
      [merged(tubes), this.frame],
    ] as const) {
      const leaves = new T.InstancedMesh(geometry, material, lateral.length);
      lateral.forEach((x, i) => leaves.setMatrixAt(i, mounts.makeTranslation(x, 0, 0)));
      leaves.castShadow = leaves.receiveShadow = true;
      leaves.computeBoundingSphere();
      this.hinge.add(leaves);
    }
    const span = (lateral.length + 1) * gate.spacing;
    const hardware: T.BufferGeometry[] = [crossTube(span, 0.014).translate(0, 0.028, 0.06)];
    const anchorParts = [new T.BoxGeometry(span, 0.036, 0.12).translate(0, 0.005, 0.06)];
    for (const x of lateral)
      for (const side of [-1, 1]) {
        const lug = x + side * (half + 0.025);
        anchorParts.push(new T.BoxGeometry(0.016, 0.046, 0.07).translate(lug, 0.022, 0.06));
        hardware.push(crossTube(0.023, 0.0185).translate(lug, 0.028, 0.06));
      }
    for (const side of [-1, 1]) {
      const x = (side * span) / 2;
      anchorParts.push(new T.BoxGeometry(0.14, 1.06, 0.14).translate(x, 0.54, 0.06));
      hardware.push(new T.BoxGeometry(0.148, 0.02, 0.148).translate(x, 1.08, 0.06));
      anchorParts.push(new T.BoxGeometry(0.29, 0.024, 0.28).translate(x, 0.014, 0.06));
      for (const a of [-0.107, 0.107])
        for (const b of [-0.1, 0.1])
          hardware.push(
            new T.CylinderGeometry(0.012, 0.012, 0.012, 6).translate(x + a, 0.032, 0.06 + b),
          );
    }
    for (const [parts, material] of [
      [hardware, this.steel],
      [anchorParts, this.frame],
    ] as const) {
      const mesh = new T.Mesh(merged(parts), material);
      mesh.castShadow = mesh.receiveShadow = true;
      this.body.add(mesh);
    }
    // Starter's pad (riders' side): concrete, flush with the dirt.
    // Concrete and its scanned normal/roughness are authored in metres.
    // A unit UV square stretches a single patch across the whole starting field.
    const indoor = this.course.kind === 'supercross';
    const pattern = indoor ? MX_START_GRATE.stadium : MX_START_GRATE.outdoor;
    const slab = new T.Mesh(materials.boxProjectUv(mxStartSlab(span, lateral)), this.pad);
    const grate = new T.InstancedMesh(
      materials.boxProjectUv(mxStartGrate(pattern)), this.steel, lateral.length,
    );
    grate.name = indoor ? 'Arena Nord expanded-steel launch grates' : 'Valley Ridge expanded-steel launch grates';
    lateral.forEach((x, i) => grate.setMatrixAt(i, mounts.makeTranslation(x, -0.05, -1.4)));
    grate.castShadow = grate.receiveShadow = true;
    grate.computeBoundingSphere();
    this.grateDistanceMaterial ??= mxStartGrateDistanceMaterial(pattern);
    const proxy = new T.InstancedMesh(mxStartGrateDistancePlane(), this.grateDistanceMaterial, lateral.length);
    proxy.instanceMatrix.copy(grate.instanceMatrix);
    proxy.name = 'Filtered launch grates';
    proxy.receiveShadow = true;
    proxy.computeBoundingSphere();
    const lod = new T.LOD();
    lod.name = 'Launch grate distance levels';
    lod.addLevel(grate, 0);
    lod.addLevel(proxy, 28, 0.12);
    proxy.visible = false;
    this.body.add(lod);
    slab.name = 'MX numbered starter pad';
    slab.position.set(0, -0.05, -1.4);
    slab.receiveShadow = true;
    this.body.add(slab);
    this.root.add(this.body);
    this.root.updateMatrixWorld(true);
  }
  /** Top of the visible concrete, or no receiver outside the slab. */
  padHeightAt(x: number, z: number) {
    const dx = x - this.root.position.x,
      dz = z - this.root.position.z;
    const half = (this.slots + 1) * this.course.spec.gate!.spacing * 0.5;
    if (Math.abs(dx) > half + 2.7 || Math.abs(dz) > half + 2.7) return -Infinity;
    const along = dx * this.padForward.x + dz * this.padForward.y;
    const across = dx * this.padForward.y - dz * this.padForward.x;
    return along >= -2.7 && along <= -0.1 && Math.abs(across) <= half
      ? this.root.position.y + 0.01
      : -Infinity;
  }
  /** Only the leaves rotate when the gate drops. The slab and anchors stay in the static shadow map. */
  get movingLeaves() {
    return this.hinge;
  }
  /** Panel count (the venue's slots, or the larger field it was widened for). */
  get panelCount() {
    return this.slots;
  }
  /** Evaluate the shared hinge at the displayed instant, including during replay. */
  update(frame: Float32Array, measured = frame) {
    if (this.disposed) return;
    const riders = Math.round(frame[H.CARS]);
    if (riders > this.slots) this.build(riders);
    // The measured race and session clocks share the same green instant.
    // Only the session clock is interpolated for presentation. Reconstructing
    // elapsed time from both clocks also holds the leaves up before green
    // when the two recorded snapshots straddle the release.
    const elapsed = measured[H.RACE_TIME] - (measured[H.TIME] - frame[H.TIME]);
    const drop = measured[H.PHASE] < PHASE.RACING ? 0 : clamp(elapsed / GATE_DROP_SECONDS, 0, 1);
    // Falls forward (away from the riders) onto the track.
    const angle = (Math.PI / 2) * drop * drop;
    this.hinge.rotation.x = angle;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    disposeOffroadResources([this.root], [this.steel, this.frame, this.pad], this.ownedTextures);
    this.hinge.clear();
    this.body.clear();
    this.ownedTextures.clear();
  }
}
