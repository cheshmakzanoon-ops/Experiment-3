import * as T from 'three';

/**
 * Knee-slider sparks of a GP prototype at full lean (vehicle art 3, hero frame GP-R1).
 *
 * The rider solver already folds a knee back until its slider just skims the road
 * (`gpClearJoint`, `Rider.kneeDown`): the slider is on the asphalt exactly when that
 * clamp engages. This turns that contact into a burst of sparks, drawn the way the
 * disc glow is: a pure function of the presented snapshot, no particle pool and no
 * clock of its own. Spark `i` of burst cycle `n` leaves the slider at `time`-phase
 * `fract(time * rate + h(i))` with a velocity hashed from `(i, n)`, drifts back along
 * the machine, up and out, falls under world gravity and fades, so a held frame or a
 * replay seek shows the same sparks and nothing is emitted by wall-clock time.
 *
 * Gated twice: the clamp must be engaged (the knee is on the road) AND the lean must be
 * past `leanFrom` (a brushed kerb at 20 degrees is not a scrape). The burst ramps in over
 * `leanFrom..leanTo` so it never pops. Drawn as additive points in the rider's own frame
 * (the sprung frame, bike-aligned): one small `Points` object, two draws at most.
 */
export const SLIDER_SPARKS = Object.freeze({
  /** Sparks per slider. */
  count: 36,
  /** |lean| (rad) below which a clamped knee throws nothing, and where the burst is full. */
  leanFrom: 0.72,
  leanTo: 1.0,
  /** Burst cycles per second (a cycle is 1 / rate s), and the share of a cycle a spark is alive. */
  rate: 9,
  alive: 0.8,
  /** Launch velocity in the machine's frame (m/s): back, up, outward spread. */
  back: 13,
  up: 1.4,
  spread: 1.6,
  /** World gravity (m/s^2) and the point size (m). */
  gravity: 9.81,
  size: 0.07,
});

const smooth = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};
/** Cheap deterministic hash in [0, 1). */
function hash(i: number, salt = 0) {
  const s = Math.sin(i * 12.9898 + salt * 78.233 + 4.1414) * 43758.5453;
  return s - Math.floor(s);
}
/** 0..1: how hard the slider is scraping. `down` is the road-clamp state (0/1), `lean` the
 * chassis lean in rad. */
export function sliderSparkLevel(down: number, lean: number) {
  if (![down, lean].every(Number.isFinite)) return 0;
  return (
    (down > 0.5 ? 1 : 0) * smooth(SLIDER_SPARKS.leanFrom, SLIDER_SPARKS.leanTo, Math.abs(lean))
  );
}
export interface SparkSample {
  /** Offset from the slider in the machine's frame (x right, y up, z forward), metres. */
  x: number;
  y: number;
  z: number;
  /** Brightness 0..1 (0 = not alive). */
  alpha: number;
}
/** Spark `i` at presentation `time` (s) for a machine leaned `lean` rad (+ left, toward +x):
 * world gravity in the machine's frame is (sin lean, -cos lean, 0). `side` (-1/+1) is the
 * slider's side, so the outward spread follows the slider. Pure. */
export function sparkAt(
  i: number,
  time: number,
  lean: number,
  side: number,
  out: SparkSample = { x: 0, y: 0, z: 0, alpha: 0 },
): SparkSample {
  const S = SLIDER_SPARKS;
  const phase = time * S.rate + hash(i, 1);
  const cycle = Math.floor(phase);
  const t = phase - cycle;
  // Flight is the first `alive` share of the cycle; the rest of it the spark is out.
  const flight = t / S.alive;
  if (!Number.isFinite(flight) || flight >= 1) {
    out.alpha = 0;
    return out;
  }
  const age = (flight * S.alive) / S.rate;
  const k = i + cycle * 31;
  const back = S.back * (0.55 + 0.9 * hash(k, 2));
  const up = S.up * (0.4 + 1.2 * hash(k, 3));
  const lateral = (hash(k, 4) - 0.35) * S.spread * side;
  const gx = Math.sin(lean),
    gy = -Math.cos(lean);
  out.x = lateral * age + 0.5 * S.gravity * gx * age * age;
  out.y = up * age + 0.5 * S.gravity * gy * age * age;
  out.z = -back * age;
  out.alpha = (1 - flight) ** 1.6 * (0.6 + 0.4 * hash(k, 5));
  return out;
}

/** A small round, soft-edged sprite (a bright core in a short falloff). Null where there is
 * no 2D canvas (a headless unit test): the points then draw as plain squares. */
function sparkSprite() {
  try {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const context = canvas.getContext('2d');
    const gradient = context?.createRadialGradient(16, 16, 0, 16, 16, 16);
    if (!context || !gradient) return null;
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.35, 'rgba(255,255,255,0.7)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 32, 32);
    const texture = new T.CanvasTexture(canvas);
    texture.colorSpace = T.SRGBColorSpace;
    return texture;
  } catch {
    return null;
  }
}

/** The two sliders' sparks as one additive point cloud in the rider's frame. */
export class GpSliderSparks {
  readonly points: T.Points;
  private readonly positions: T.BufferAttribute;
  private readonly colours: T.BufferAttribute;
  private readonly sample: SparkSample = { x: 0, y: 0, z: 0, alpha: 0 };
  /** Strength of the last update, per slider (0 = nothing drawn). */
  readonly level = [0, 0];
  private readonly material: T.PointsMaterial;
  private readonly sprite: T.CanvasTexture | null;
  constructor() {
    const n = SLIDER_SPARKS.count * 2;
    const geometry = new T.BufferGeometry();
    this.positions = new T.BufferAttribute(new Float32Array(n * 3), 3).setUsage(T.DynamicDrawUsage);
    this.colours = new T.BufferAttribute(new Float32Array(n * 3), 3).setUsage(T.DynamicDrawUsage);
    geometry.setAttribute('position', this.positions);
    geometry.setAttribute('color', this.colours);
    // The sparks travel a metre or two behind the machine; never cull them by their rest bounds.
    geometry.boundingSphere = new T.Sphere(new T.Vector3(), 4);
    this.sprite = sparkSprite();
    this.material = new T.PointsMaterial({
      map: this.sprite,
      size: SLIDER_SPARKS.size,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      blending: T.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    this.points = new T.Points(geometry, this.material);
    this.points.name = 'Knee-slider sparks (additive points)';
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.points.castShadow = false;
    this.points.receiveShadow = false;
  }
  /** Pose the burst. `origins` are the slider centres in the rider's frame, `down` the
   * road-clamp state of each knee. Hides the object when neither slider scrapes. */
  update(
    time: number,
    lean: number,
    origins: readonly [T.Vector3, T.Vector3],
    down: readonly [number, number],
  ) {
    const count = SLIDER_SPARKS.count;
    let any = false;
    for (let s = 0; s < 2; s++) {
      const level = sliderSparkLevel(down[s], lean);
      this.level[s] = level;
      const side = s === 0 ? 1 : -1;
      for (let i = 0; i < count; i++) {
        const v = s * count + i;
        const p = sparkAt(i + s * 101, time, lean, side, this.sample);
        const alpha = level > 0 ? p.alpha * level : 0;
        any ||= alpha > 0;
        this.positions.setXYZ(v, origins[s].x + p.x, origins[s].y + p.y, origins[s].z + p.z);
        // Hot white-orange core fading to red-orange; additive, so black is invisible.
        this.colours.setXYZ(v, alpha * 1.6, alpha * (0.7 + 0.6 * alpha), alpha * alpha * 0.55);
      }
    }
    this.positions.needsUpdate = this.colours.needsUpdate = true;
    this.points.visible = any;
    return any;
  }
  dispose() {
    this.points.geometry.dispose();
    this.material.dispose();
    this.sprite?.dispose();
  }
}
