import * as T from 'three';
import { clamp, Random, smooth } from '../core/math.ts';
import { envelopeCornerSpeed } from '../simulation/ai.ts';
import { GP_R1 } from '../simulation/bike-definitions.ts';
import { isGpCourse } from '../simulation/gp-corner-shape.ts';
import { racingLineFor } from '../simulation/racing-line.ts';
import { trackPoint, type Track } from '../simulation/track.ts';
import { canvasTexture } from './geometry.ts';
import { chainShaderHook, injectAfter } from './studio/shader-hooks.ts';
import { tagWeatherSurface } from './weather-presentation.ts';

/** Rubber laid by locking and spinning tyres where cars brake hard, turn in
 * and power out of slow corners. Placed from a speed profile along the solved
 * racing line (the AI's own corner envelope, a braking and a traction limit),
 * so the marks sit where the simulated cars actually brake. Original
 * procedural decals; they are presentation only and never change grip. */
export const TYRE_MARKS = Object.freeze({
  /** Metres between profile samples. */
  step: 2,
  /** Deceleration and acceleration limits of the profile, m/s^2. */
  braking: 42,
  traction: 11,
  /** A braking zone loses at least this much speed (m/s). */
  minimumDrop: 12,
  /** Slow-corner exits (wheelspin marks) start below this speed (m/s). */
  slowExit: 32,
  /** Wheel centres either side of the car's centreline, metres. */
  halfTrack: 0.8,
  /** Width of one mark, metres. */
  width: 0.3,
  /** Height above the asphalt, metres. */
  lift: 0.006,
  /** Track length per merged mesh, metres (culling granularity). */
  chunk: 400,
  /** Braking streak length range, metres: they end at (or just short of) the apex. */
  brakingLength: [20, 60] as const,
  /** Standing water (mm, the physics track state) over which the marks fade
   * out, and the share of their opacity the film hides. */
  waterCover: [0.15, 1.1] as const,
  waterHidden: 0.85,
});

/** A motorcycle leaves a single, narrower contact path. The shorter, softer
 * trails describe occasional slip, not a pair of locked car wheels through
 * every corner (REF_037, REF_047 and REF_060). */
export const BIKE_TYRE_MARKS = Object.freeze({
  width: 0.18,
  strength: [0.16, 0.37] as const,
  maximumPasses: 8,
});

/** Occasional GP slip strokes, staggered through the braking zone rather
 * than every tyre locking for the final 60 m into each apex. The original
 * REF_030/031 provide the varied contact-path cue, not measured slip data. */
export const GP_TYRE_MARKS = Object.freeze({
  width: 0.18,
  length: [6, 34] as const,
  strength: [0.14, 0.31] as const,
  maximumPasses: 8,
});

/** Permanent rubber of a used GP venue (REF_003, 030, 031, 038): years of
 * race weekends — bikes, support classes, track days — leave dense, dark,
 * curving streaks in every braking zone and arcs that run wide on the exits,
 * whichever vehicle the session follows. Only the four motorcycle-GP venues
 * carry this layer (`isGpCourse`); every other circuit is unchanged. Seeded
 * per venue, static, presentation only (grip is the simulation's). */
export const GP_VENUE_STREAKS = Object.freeze({
  seed: 8821,
  /** Streaks per braking zone, scaled by the speed lost (m/s / 2). */
  brakingPasses: [12, 30] as const,
  /** Exit arcs per slow corner. */
  exitPasses: [8, 16] as const,
  /** Tread width range, metres (bike tyres to car rears). */
  width: [0.13, 0.27] as const,
  /** Braking streak and exit arc lengths, metres. */
  brakingLength: [16, 72] as const,
  exitLength: [14, 48] as const,
  /** Peak opacity range of one streak. */
  strength: [0.26, 0.6] as const,
  /** Lateral scatter of streak starts about the racing line, metres. */
  spread: 1.7,
  /** Sideways bow of a curving streak and the drift of the crossing ones, m. */
  bow: 0.85,
  crossing: 2.6,
  crossingShare: 0.18,
  /** How far an exit arc runs wide toward the outside kerb, metres. */
  runWide: [0.6, 2.8] as const,
});

export interface TyreMarkZone {
  kind: 'braking' | 'exit';
  start: number;
  end: number;
  /** Speed lost (braking) or gained (exit) across the zone, m/s. */
  strength: number;
}

/** Braking and slow-exit zones from a speed profile along the racing line. */
export function tyreMarkZones(track: Track, motorcycle = false): TyreMarkZone[] {
  const line = racingLineFor(track);
  // Use the existing prototype's no-downforce capability envelope. Formula
  // braking zones otherwise begin much too late for the bike scene.
  const envelope = motorcycle ? GP_R1.ai : undefined,
    braking = envelope ? envelope.brakingBase * envelope.brakingMargin : TYRE_MARKS.braking,
    traction = motorcycle ? 7.8 : TYRE_MARKS.traction;
  const n = Math.round(track.length / TYRE_MARKS.step),
    step = track.length / n;
  const corner = new Float64Array(n),
    speed = new Float64Array(n);
  for (let i = 0; i < n; i++)
    corner[i] = Math.min(
      envelope?.topSpeed ?? 92,
      envelopeCornerSpeed(line.curvatureAt(i * step), 1, 1, envelope),
    );
  // Closed-lap profile: forward (traction) and backward (braking) passes,
  // repeated so the start/finish wrap settles.
  speed.set(corner);
  for (let pass = 0; pass < 3; pass++) {
    for (let k = 1; k <= n; k++) {
      const i = k % n,
        prev = (k - 1) % n;
      speed[i] = Math.min(speed[i], Math.sqrt(speed[prev] ** 2 + 2 * traction * step));
    }
    for (let k = n - 1; k >= 0; k--) {
      const i = k % n,
        next = (k + 1) % n;
      speed[i] = Math.min(speed[i], Math.sqrt(speed[next] ** 2 + 2 * braking * step));
    }
  }
  const zones: TyreMarkZone[] = [];
  // Braking: maximal runs where speed falls; keep the heavy ones.
  let i = 0;
  const start = speed.indexOf(Math.max(...speed));
  for (let visited = 0; visited < n; ) {
    const a = (start + i) % n;
    const b = (a + 1) % n;
    if (speed[b] < speed[a] - 1e-6) {
      let j = i;
      while (j - i < n && speed[(start + j + 1) % n] < speed[(start + j) % n] - 1e-6) j++;
      const from = (start + i) % n,
        to = (start + j) % n,
        drop = speed[from] - speed[to];
      if (drop >= TYRE_MARKS.minimumDrop)
        zones.push({
          kind: 'braking',
          start: from * step,
          end: from * step + (j - i) * step,
          strength: drop,
        });
      visited += j - i + 1;
      i = j + 1;
    } else {
      visited++;
      i++;
    }
  }
  // Slow-corner exits: from the apex (slowest point) while still slow, and
  // never into the next braking zone.
  const brakingStarts = new Set(zones.map((z) => Math.round(z.start / step) % n));
  for (const zone of zones.filter((z) => z.kind === 'braking')) {
    const apex = Math.round(zone.end / step) % n;
    if (speed[apex] >= TYRE_MARKS.slowExit) continue;
    let j = apex;
    while (
      speed[(j + 1) % n] < TYRE_MARKS.slowExit + 14 &&
      j - apex < n / 8 &&
      !brakingStarts.has((j + 1) % n)
    )
      j++;
    zones.push({
      kind: 'exit',
      start: apex * step,
      end: j * step,
      strength: speed[j % n] - speed[apex],
    });
  }
  return zones.sort((a, b) => a.start - b.start);
}

export interface TyreMark {
  /** Track distance of each sample, metres (may exceed one lap). */
  s: Float32Array;
  /** Lateral offset of each sample, metres. */
  lateral: Float32Array;
  /** Opacity of each sample. */
  alpha: Float32Array;
  /** Full tread width in metres; legacy car marks use TYRE_MARKS.width. */
  width?: number;
}

/** Individual marks: pairs of wheel tracks from several passes, each a little
 * off the line, densest where wheels lock at the end of a braking zone. */
export function tyreMarks(
  track: Track,
  zones = tyreMarkZones(track),
  seed = 5417,
  motorcycle = false,
  grandPrix = false,
): TyreMark[] {
  grandPrix = grandPrix && motorcycle;
  const line = racingLineFor(track),
    random = new Random(seed),
    p = trackPoint(),
    marks: TyreMark[] = [];
  for (const zone of zones) {
    const length = zone.end - zone.start;
    const count = Math.round(
      motorcycle
        ? clamp(
            zone.strength / 4.5,
            3,
            grandPrix ? GP_TYRE_MARKS.maximumPasses : BIKE_TYRE_MARKS.maximumPasses,
          )
        : clamp(zone.strength / 2.2, 4, 16),
    );
    for (let m = 0; m < count; m++) {
      const passOffset = (random.next() - 0.5) * 1.4;
      // Braking streaks are pairs 20-60 m long that run into the apex, where
      // the downforce has fallen and the wheels lock; exit marks start there.
      // GP releases are stratified across the approach, with seeded variation
      // inside each share, so a long brake zone retains both early and late passes.
      const braking = zone.kind === 'braking';
      const t0 = braking
          ? grandPrix
            ? 0.44 + ((m + random.next()) / count) * 0.54
            : 0.88 + random.next() * 0.12
          : random.next() * 0.25,
        markLength = braking
          ? grandPrix
            ? Math.min(
                length,
                clamp(
                  length * (0.18 + random.next() * 0.3),
                  GP_TYRE_MARKS.length[0],
                  GP_TYRE_MARKS.length[1],
                ),
              )
            : clamp(
                length * (0.45 + random.next() * 0.5),
                TYRE_MARKS.brakingLength[0],
                TYRE_MARKS.brakingLength[1],
              )
          : clamp(length * (0.25 + random.next() * 0.45), 6, 60);
      const from =
        zone.start +
        (grandPrix && braking ? Math.max(markLength, t0 * length) : t0 * length) -
        (braking ? markLength : 0);
      const drift = (random.next() - 0.5) * (motorcycle ? 0.9 : 0.6),
        strength = motorcycle
          ? grandPrix
            ? GP_TYRE_MARKS.strength[0] +
              random.next() * (GP_TYRE_MARKS.strength[1] - GP_TYRE_MARKS.strength[0])
            : BIKE_TYRE_MARKS.strength[0] +
              random.next() * (BIKE_TYRE_MARKS.strength[1] - BIKE_TYRE_MARKS.strength[0])
          : 0.3 + random.next() * 0.32;
      // Under braking both axles mark; out of slow corners the rear pair.
      for (const side of motorcycle ? [0] : [-1, 1]) {
        if (!motorcycle && braking && random.next() < 0.25) continue;
        const width = motorcycle
          ? grandPrix
            ? GP_TYRE_MARKS.width
            : BIKE_TYRE_MARKS.width
          : TYRE_MARKS.width;
        const samples = Math.max(2, Math.ceil(markLength / 1.2) + 1);
        const s = new Float32Array(samples),
          lateral = new Float32Array(samples),
          alpha = new Float32Array(samples);
        for (let k = 0; k < samples; k++) {
          const u = k / (samples - 1),
            at = from + u * markLength;
          track.at(at, p);
          const limit = p.width - width;
          s[k] = at;
          lateral[k] = clamp(
            line.offsetAt(at) +
              passOffset +
              drift * u +
              side * TYRE_MARKS.halfTrack +
              (grandPrix ? Math.sin(u * Math.PI) * drift * 0.42 : 0),
            -limit,
            limit,
          );
          // Braking streaks build as load transfers and the tyre starts to
          // lock, darkest near the apex, then lift off within the last metres.
          // Exits fade as the tyres hook up.
          const envelope = grandPrix
            ? braking
              ? smooth(0, 0.23, u) * (1 - smooth(0.64, 1, u))
              : smooth(0, 0.08, u) * (1 - u) ** 1.3
            : braking
              ? Math.min(1, u / 0.3) ** 0.7 * Math.min(1, (1 - u) / 0.06)
              : (1 - u) ** 1.3;
          // The longitudinal slip varies as the rear hooks up; it is not an
          // unbroken ink stroke. Seeded pass variation survives replay seeks.
          const breakup = grandPrix
            ? 0.3 + 0.7 * Math.sin(u * (8.2 + m * 0.37) + m * 1.7) ** 2
            : motorcycle
              ? 0.62 + 0.38 * Math.sin(u * 10 + m * 1.7) ** 2
              : 1;
          alpha[k] = strength * envelope * breakup;
        }
        marks.push(motorcycle ? { s, lateral, alpha, width } : { s, lateral, alpha });
      }
    }
  }
  return marks;
}

/** The GP venue's permanent streaks (GP_VENUE_STREAKS): curving braking
 * streaks scattered about the racing line into each apex, a share of them
 * crossing it, and exit arcs drifting toward the outside kerb. Deterministic
 * per track; every streak stays on the asphalt. */
export function gpVenueStreaks(track: Track, zones = tyreMarkZones(track, true)): TyreMark[] {
  const V = GP_VENUE_STREAKS,
    line = racingLineFor(track),
    random = new Random(V.seed + Math.round(track.length)),
    p = trackPoint(),
    marks: TyreMark[] = [];
  const range = (r: readonly [number, number]) => r[0] + random.next() * (r[1] - r[0]);
  for (const zone of zones) {
    const braking = zone.kind === 'braking',
      span = Math.max(zone.end - zone.start, 1);
    // The corner side: positive curvature turns toward +lateral, so the
    // outside (where exits run wide) is the opposite sign.
    let bend = 0;
    for (let d = 0; d <= 40; d += 4)
      bend += line.curvatureAt(braking ? zone.end + d - 10 : zone.start + d);
    const outside = bend > 0 ? -1 : 1;
    const count = Math.round(
      braking
        ? clamp(zone.strength / 2, V.brakingPasses[0], V.brakingPasses[1])
        : clamp(zone.strength / 1.8, V.exitPasses[0], V.exitPasses[1]),
    );
    const window = Math.min(span, braking ? 150 : 90);
    for (let m = 0; m < count; m++) {
      const width = range(V.width);
      const markLength = Math.min(range(braking ? V.brakingLength : V.exitLength), window + 15);
      // Braking streaks end through the last part of the approach (a few run
      // just past the apex); exit arcs start around the apex.
      const from = braking
        ? zone.end - window * 0.85 * random.next() ** 1.4 + (random.next() - 0.3) * 18 - markLength
        : zone.start + window * 0.35 * random.next() - 4;
      const start = (random.next() + random.next() - 1) * V.spread;
      const crossing = braking && random.next() < V.crossingShare;
      const drift = crossing
        ? (random.next() - 0.5) * 2 * V.crossing
        : braking
          ? -outside * random.next() * 0.6
          : outside * range(V.runWide);
      const bow = (random.next() - 0.5) * 2 * V.bow;
      const strength = range(V.strength) * (braking ? clamp(zone.strength / 36, 0.65, 1) : 0.85);
      const rate = 5 + random.next() * 6,
        phase = random.next() * 6.283;
      const samples = Math.max(2, Math.ceil(markLength / 1.2) + 1);
      const s = new Float32Array(samples),
        lateral = new Float32Array(samples),
        alpha = new Float32Array(samples);
      for (let k = 0; k < samples; k++) {
        const u = k / (samples - 1),
          at = from + u * markLength;
        track.at(at, p);
        const limit = Math.max(0, p.width - width / 2 - 0.12);
        s[k] = at;
        lateral[k] = clamp(
          line.offsetAt(at) +
            start * (braking ? 1 : 0.6) +
            drift * u ** (braking ? 1.2 : 1.6) +
            bow * Math.sin(u * Math.PI),
          -limit,
          limit,
        );
        const envelope = braking
          ? smooth(0, 0.16, u) * (1 - smooth(0.68, 1, u))
          : smooth(0, 0.1, u) * (1 - smooth(0.5, 1, u));
        // Slip varies along a streak: darker lock-ups and lighter stretches.
        const breakup = 0.42 + 0.58 * Math.sin(u * rate + phase) ** 2;
        alpha[k] = strength * envelope * breakup;
      }
      marks.push({ s, lateral, alpha, width });
    }
  }
  return marks;
}

/** Fine rubber streaks along a mark (u across, v along), with a soft edge. */
function markTexture() {
  return canvasTexture(64, 256, (context) => {
    const random = new Random(9127);
    context.clearRect(0, 0, 64, 256);
    for (let i = 0; i < 46; i++) {
      const x = 6 + random.next() * 52,
        width = 0.8 + random.next() * 2.4;
      const fade = Math.min(x - 2, 62 - x) / 14;
      context.fillStyle = `rgba(255,255,255,${(0.35 + random.next() * 0.65) * Math.min(1, fade)})`;
      context.fillRect(x, 0, width, 256);
    }
  });
}

/** Standing water hides the marks: the physics track state (R = water mm / 2,
 * the texture the wet road samples) fades their opacity, so the wet road's
 * mirror and sheen run unbroken over a braking zone instead of being striped
 * by dark rubber, and the marks return with the dry line. */
export function installTyreMarkWater(material: T.Material, state: T.Texture) {
  const [dry, covered] = TYRE_MARKS.waterCover;
  const uniform = { value: state };
  return chainShaderHook(material, 'tyre-mark-water-v2', (shader) => {
    shader.uniforms.apexMarkState = uniform;
    injectAfter(shader, 'common', 'attribute vec2 trackUV; varying vec2 vMarkTrackUV;', 'vertex');
    injectAfter(
      shader,
      'common',
      'uniform sampler2D apexMarkState; varying vec2 vMarkTrackUV;',
      'fragment',
    );
    injectAfter(shader, 'begin_vertex', 'vMarkTrackUV = trackUV;');
    // The lap fraction runs on across the start line within a mark (see
    // buildTyreMarks), so it wraps here, per fragment, not per vertex.
    injectAfter(
      shader,
      'alphamap_fragment',
      `diffuseColor.a *= 1.0 - ${TYRE_MARKS.waterHidden.toFixed(3)} *
        smoothstep(${dry.toFixed(3)}, ${covered.toFixed(3)}, texture2D(apexMarkState, vec2(vMarkTrackUV.x, fract(vMarkTrackUV.y))).r * 2.0);`,
    );
  });
}

function tyreMarkMaterial(state?: T.Texture) {
  const texture = markTexture();
  texture.wrapT = T.RepeatWrapping;
  texture.colorSpace = T.NoColorSpace;
  const material = new T.MeshStandardMaterial({
    color: 0x0c0c0d,
    roughness: 0.72,
    alphaMap: texture,
    transparent: true,
    depthWrite: false,
    vertexColors: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
  material.name = 'Laid tyre rubber';
  // Rain wets the marks like the painted lines around them.
  tagWeatherSurface(material, 'paint');
  if (state) installTyreMarkWater(material, state);
  return material;
}

/** Merged mark meshes, one per TYRE_MARKS.chunk metres of track. With the
 * physics state texture, every vertex carries the road's `trackUV` and the
 * marks fade under standing water (installTyreMarkWater). A family cache can
 * share its already-installed weather/atmosphere material across both layers. */
export function buildTyreMarks(
  track: Track,
  parent: T.Object3D,
  marks = tyreMarks(track),
  state?: T.Texture,
  material = tyreMarkMaterial(state),
) {
  const chunks = new Map<
    number,
    { position: number[]; uv: number[]; trackUV: number[]; color: number[]; index: number[] }
  >();
  const p = trackPoint();
  for (const mark of marks) {
    const key = Math.floor(
      (((mark.s[0] % track.length) + track.length) % track.length) / TYRE_MARKS.chunk,
    );
    let chunk = chunks.get(key);
    if (!chunk)
      chunks.set(key, (chunk = { position: [], uv: [], trackUV: [], color: [], index: [] }));
    const base = chunk.position.length / 3;
    // Lap of the mark's first sample: the state V coordinate continues past 1
    // (or below 0) instead of jumping back across the whole texture inside one
    // quad when a mark crosses the start line; the shader wraps it.
    const lap = Math.floor(mark.s[0] / track.length);
    for (let k = 0; k < mark.s.length; k++) {
      track.at(mark.s[k], p);
      for (const edge of [-0.5, 0.5]) {
        const l = mark.lateral[k] + edge * (mark.width ?? TYRE_MARKS.width);
        chunk.position.push(
          p.x + p.nx * l,
          p.y + p.bank * clamp(l, -12, 12) + TYRE_MARKS.lift,
          p.z + p.nz * l,
        );
        chunk.uv.push(edge + 0.5, (mark.s[k] - mark.s[0]) / 4);
        // The road ribbon's state coordinates (lateral share, lap fraction).
        chunk.trackUV.push(clamp((l / p.width) * 0.5 + 0.5, 0, 1), mark.s[k] / track.length - lap);
        chunk.color.push(1, 1, 1, mark.alpha[k]);
      }
      if (k > 0) {
        const a = base + (k - 1) * 2;
        chunk.index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
  }
  const meshes: T.Mesh[] = [];
  for (const [key, chunk] of chunks) {
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(chunk.position, 3));
    geometry.setAttribute('uv', new T.Float32BufferAttribute(chunk.uv, 2));
    if (state) geometry.setAttribute('trackUV', new T.Float32BufferAttribute(chunk.trackUV, 2));
    geometry.setAttribute('color', new T.Float32BufferAttribute(chunk.color, 4));
    geometry.setIndex(chunk.index);
    // Same winding as the road ribbons (lateral ascending): faces point up.
    geometry.computeVertexNormals();
    const mesh = new T.Mesh(geometry, material);
    mesh.name = `Laid tyre rubber ${key * TYRE_MARKS.chunk}-${(key + 1) * TYRE_MARKS.chunk}m`;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.renderOrder = 1;
    parent.add(mesh);
    meshes.push(mesh);
  }
  return meshes;
}

type TyreMarkFamily = 'car' | 'motorcycle' | 'gp';

/** A maximum of three cached, culled mark layers. GP uses its own history;
 * other road motorcycles retain their original surface. Switching followed vehicle,
 * replay or menus only changes visibility after a layer's first construction.
 * Geometry generation stays out of the steady-state draw loop. */
export class TyreMarkPresentation {
  readonly root = new T.Group();
  private readonly layers = new Map<TyreMarkFamily, T.Group>();
  private family: TyreMarkFamily = 'car';
  private ready = false;
  private material: T.MeshStandardMaterial | undefined;
  /** The GP venue's permanent rubber (GP_VENUE_STREAKS); null elsewhere. */
  private venue: T.Group | null = null;

  constructor(
    private readonly track: Track,
    private readonly state: T.Texture,
  ) {
    this.root.name = 'Discipline tyre rubber';
  }

  build(parent: T.Object3D) {
    if (this.ready) return;
    this.ready = true;
    parent.add(this.root);
    // A GP venue's permanent rubber, built once and shown whichever vehicle
    // family is followed (it shares the one mark material and program).
    if (isGpCourse(this.track)) {
      this.venue = new T.Group();
      this.venue.name = 'GP venue rubber history';
      buildTyreMarks(
        this.track,
        this.venue,
        gpVenueStreaks(this.track),
        this.state,
        (this.material ??= tyreMarkMaterial(this.state)),
      );
      this.root.add(this.venue);
    }
    this.showLayer();
  }

  setMotorcycle(enabled: boolean, grandPrix = false) {
    const family: TyreMarkFamily = enabled ? (grandPrix ? 'gp' : 'motorcycle') : 'car';
    if (this.family === family) return false;
    this.family = family;
    if (this.ready) this.showLayer();
    return true;
  }

  private showLayer() {
    if (!this.layers.has(this.family)) {
      const motorcycle = this.family !== 'car',
        grandPrix = this.family === 'gp';
      const layer = new T.Group();
      layer.name = grandPrix
        ? 'GP contact trails'
        : motorcycle
          ? 'Motorcycle contact trails'
          : 'Four-wheel contact trails';
      const zones = tyreMarkZones(this.track, motorcycle);
      buildTyreMarks(
        this.track,
        layer,
        tyreMarks(this.track, zones, 5417, motorcycle, grandPrix),
        this.state,
        (this.material ??= tyreMarkMaterial(this.state)),
      );
      this.layers.set(this.family, layer);
      this.root.add(layer);
    }
    for (const [family, layer] of this.layers) layer.visible = family === this.family;
    this.root.updateMatrixWorld(true);
  }

  diagnostics() {
    const active = this.layers.get(this.family);
    return {
      mode: this.family,
      cachedLayers: this.layers.size,
      activeMeshes: active?.children.length ?? 0,
      venueMeshes: this.venue?.children.length ?? 0,
      treadWidth:
        this.family === 'gp'
          ? GP_TYRE_MARKS.width
          : this.family === 'motorcycle'
            ? BIKE_TYRE_MARKS.width
            : TYRE_MARKS.width,
    };
  }
}
