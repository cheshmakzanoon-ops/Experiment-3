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
import { MX_SOIL_COLOURS } from './mx-soil-detail.ts';
import { chainShaderHook, injectAfter, injectDeclarations } from '../studio/shader-hooks.ts';

/** Gate panel (m): a perforated steel grate hinged at its foot. */
const PANEL = Object.freeze({ height: 0.52, thickness: 0.035, gap: 0.08 });

/** The starter's pad after a day of motos: a patchy skin of tracked-in soil,
 * clods shed at the gate, a worn, rubber-dark lane under every slot and the
 * soil spray the rear tyres threw back at each drop. Coordinates are the
 * slab's own metres (x across the gate, z toward it); lane spacing/offset
 * follow the session's slots. Shading only: no geometry, textures or draws. */
function installStartPadDirt(material: T.MeshPhysicalMaterial, lanes: T.IUniform<T.Vector2>) {
  chainShaderHook(material, 'mx-start-pad-dirt-v1', (shader) => {
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
uniform vec2 mxPadLanes;
uniform vec3 mxPadSoil;
float mxPadDirt, mxPadHeight;
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
  float across = abs( fract( ( p.x - mxPadLanes.y ) / mxPadLanes.x + 0.5 ) - 0.5 ) * mxPadLanes.x;
  float behind = clamp( ( -0.35 - p.y ) / 0.95, 0.0, 1.0 );
  float lane = ( 1.0 - smoothstep( 0.04, 0.12, across ) ) * smoothstep( -0.6, -0.3, p.y )
    * ( 1.0 - smoothstep( 0.95, 1.25, p.y ) ) * ( 0.55 + 0.45 * patches );
  float spray = ( 1.0 - smoothstep( 0.05 + behind * 0.3, 0.2 + behind * 0.45, across ) )
    * smoothstep( -0.25, -0.55, p.y ) * smoothstep( 0.25, 0.75, patches + 0.25 * grit );
  mxPadDirt = clamp( 0.16 + 0.3 * broad + 0.34 * patches + 0.42 * gate * ( 0.5 + 0.5 * patches )
    + 0.4 * spray, 0.0, 1.0 );
  mxPadDirt *= smoothstep( 0.05, 0.45, mxPadDirt + 0.22 * ( grit - 0.5 ) * fine );
  vec3 soil = mxPadSoil * ( 0.8 + 0.34 * patches ) * ( 1.0 + ( grit - 0.5 ) * 0.25 * fine );
  diffuseColor.rgb = mix( diffuseColor.rgb, soil, mxPadDirt * 0.88 );
  // Rubber and packed soil darken the worn lanes where the tyres sat.
  diffuseColor.rgb *= 1.0 - lane * 0.28;
  mxPadHeight = mxPadDirt * ( 0.0012 + 0.0016 * grit ) * fine;
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
  private readonly panels: T.Group[] = [];
  private body = new T.Group();
  private slots = 0;
  private readonly steel = materials.metal({ kind: 'bare', metal: 'steel', roughness: 0.48 });
  // Galvanised grates on a dark, weathered steel frame.
  private readonly frame = materials.metal({
    kind: 'cast',
    metal: 'steel',
    color: 0x3b3f44,
    roughness: 0.62,
  });
  private readonly pad = materials.concrete({ variant: 'rough', horizontal: 1 });
  private readonly lanes = { value: new T.Vector2(1, 0) };
  constructor(
    private readonly track: Track,
    private readonly course: OffroadCourse,
  ) {
    const gate = course.spec.gate!;
    const p = trackPoint();
    track.at(gate.s, p);
    this.root.name = 'Start gate';
    installScannedMaps(this.pad, 'concrete', libraryAlbedo(this.pad));
    // A gate that has dropped for every moto carries roost: a dusty film and
    // damp splatter low on the grates and frame, cleaner toward the top bar.
    const roost = mudUniforms();
    roost.offroadMud.value = 0.42;
    roost.offroadMudWet.value = 0.25;
    installMud(this.steel, roost);
    installMud(this.frame, roost);
    installStartPadDirt(this.pad, this.lanes);
    this.root.position.set(p.x, p.y, p.z);
    // Local +Z along the lap, +X along the track normal (lateral).
    this.root.rotation.y = Math.atan2(p.tx, p.tz);
    this.build(gate.slots);
  }
  /** Panels for `riders` slots (at least the venue's own), as the session lays them out. */
  private build(riders: number) {
    const gate = this.course.spec.gate!;
    this.root.remove(this.body);
    const oldGeometry = new Set<T.BufferGeometry>();
    this.body.traverse((o) => {
      if (o instanceof T.Mesh) oldGeometry.add(o.geometry);
    });
    for (const g of oldGeometry) g.dispose();
    this.body = new T.Group();
    this.panels.length = 0;
    const { lateral } = gateSlots(this.track, this.course, riders);
    this.slots = lateral.length;
    // Equally spaced slot centres: the pad's lane pattern repeats with them.
    this.lanes.value.set(gate.spacing, lateral[0] ?? 0);
    const panelWidth = gate.spacing - PANEL.gap;
    // Open welded bars reveal the soil and the front tyre through each
    // panel. The hinge and release timing are still the session's gate.
    const bars: T.BufferGeometry[] = [];
    for (let i = 0; i < 9; i++)
      bars.push(
        new T.BoxGeometry(0.022, PANEL.height, PANEL.thickness).translate(
          (i / 8 - 0.5) * (panelWidth - 0.022),
          PANEL.height / 2,
          0,
        ),
      );
    for (const y of [0.02, PANEL.height * 0.46, PANEL.height - 0.02])
      bars.push(new T.BoxGeometry(panelWidth, 0.024, PANEL.thickness).translate(0, y, 0));
    const grate = mergeGeometries(bars, false)!;
    for (const g of bars) g.dispose();
    const bar = new T.BoxGeometry(panelWidth, 0.05, 0.05);
    for (const l of lateral) {
      const hinge = new T.Group();
      hinge.position.set(l, 0.02, 0.06);
      const panel = new T.Mesh(grate, this.steel);
      panel.castShadow = panel.receiveShadow = true;
      const top = new T.Mesh(bar, this.frame);
      top.position.y = PANEL.height;
      hinge.add(panel, top);
      this.body.add(hinge);
      this.panels.push(hinge);
    }
    // The hinge beam across the whole gate and its end posts.
    const span = (lateral.length + 1) * gate.spacing;
    const beam = new T.Mesh(new T.BoxGeometry(span, 0.08, 0.12), this.frame);
    beam.position.set(0, 0.04, 0.06);
    beam.castShadow = beam.receiveShadow = true;
    this.body.add(beam);
    for (const side of [-1, 1]) {
      const post = new T.Mesh(new T.BoxGeometry(0.14, 1.1, 0.14), this.frame);
      post.position.set((side * span) / 2, 0.55, 0.06);
      post.castShadow = post.receiveShadow = true;
      this.body.add(post);
    }
    // Starter's pad (riders' side): concrete, flush with the dirt.
    const slab = new T.Mesh(new T.BoxGeometry(span, 0.12, 2.6), this.pad);
    slab.position.set(0, -0.05, -1.4);
    slab.receiveShadow = true;
    this.body.add(slab);
    this.root.add(this.body);
    this.root.updateMatrixWorld(true);
  }
  /** Panel count (the venue's slots, or the larger field it was widened for). */
  get panelCount() {
    return this.panels.length;
  }
  /** Panel angle from the snapshot: standing until the release, then falling. */
  update(frame: Float32Array) {
    const riders = Math.round(frame[H.CARS]);
    if (riders > this.slots) this.build(riders);
    const phase = frame[H.PHASE],
      t = frame[H.RACE_TIME];
    const drop = phase < PHASE.RACING ? 0 : clamp(t / GATE_DROP_SECONDS, 0, 1);
    // Falls forward (away from the riders) onto the track.
    const angle = (Math.PI / 2) * drop * drop;
    for (const panel of this.panels) panel.rotation.x = angle;
  }
  dispose() {
    const geometry = new Set<T.BufferGeometry>();
    this.root.traverse((o) => {
      if (o instanceof T.Mesh) geometry.add(o.geometry);
    });
    for (const g of geometry) g.dispose();
    this.steel.dispose();
    this.frame.dispose();
    this.pad.dispose();
    this.root.clear();
  }
}
