import { TrackContactMesh, kerbHeight } from './contact.ts';
import { clamp, lerp, mod, smooth, Vec3, TAU } from '../core/math.ts';
import type { WeatherPreset } from './config.ts';
export const TRACK_NAME = 'AUREL / GRAND CIRCUIT',
  CELL_ROWS = 512,
  CELL_COLS = 7;
export const SURFACE = { ASPHALT: 0, PAINT: 1, KERB: 2, GRASS: 3, GRAVEL: 4, PIT: 5 } as const;
export interface TrackPoint {
  s: number;
  x: number;
  y: number;
  z: number;
  tx: number;
  tz: number;
  nx: number;
  nz: number;
  curvature: number;
  width: number;
  bank: number;
  gradient: number;
}
export interface SurfaceSample {
  s: number;
  width: number;
  lateral: number;
  height: number;
  normal: Vec3;
  surface: number;
  water: number;
  rubber: number;
  marbles: number;
  temp: number;
  grip: number;
  resistance: number;
  cell: number;
  pit: boolean;
}
export const trackPoint = (): TrackPoint => ({
  s: 0,
  x: 0,
  y: 0,
  z: 0,
  tx: 0,
  tz: 1,
  nx: 1,
  nz: 0,
  curvature: 0,
  width: 8,
  bank: 0,
  gradient: 0,
});
export const surfaceSample = (): SurfaceSample => ({
  s: 0,
  width: 8,
  lateral: 0,
  height: 0,
  normal: new Vec3(0, 1, 0),
  surface: 0,
  water: 0,
  rubber: 0,
  marbles: 0,
  temp: 32,
  grip: 1,
  resistance: 0.015,
  cell: 0,
  pit: false,
});
const DESIGN = [
  [-360, -180],
  [-360, 40],
  [-355, 260],
  [-270, 420],
  [-65, 465],
  [145, 410],
  [295, 300],
  [260, 180],
  [100, 140],
  [65, 15],
  [175, -85],
  [320, -190],
  [295, -345],
  [100, -430],
  [-100, -420],
  [-275, -335],
];
const catmull = (a: number, b: number, c: number, d: number, t: number) =>
  0.5 *
  (2 * b +
    (-a + c) * t +
    (2 * a - 5 * b + 4 * c - d) * t * t +
    (-a + 3 * b - 3 * c + d) * t * t * t);
/** Analytic ribbon collision surface, accelerated by a uniform spatial hash.
 * Rendering consumes these same samples and kerb elevations. */
export class Track {
  readonly points: TrackPoint[] = [];
  readonly water = new Float32Array(CELL_ROWS * CELL_COLS);
  readonly rubber = new Float32Array(CELL_ROWS * CELL_COLS);
  readonly marbles = new Float32Array(CELL_ROWS * CELL_COLS);
  readonly temperature = new Float32Array(CELL_ROWS * CELL_COLS);
  readonly hash = new Map<string, number[]>();
  readonly length: number;
  private contactMesh: TrackContactMesh | null = null;
  cast(origin: Vec3, down: Vec3, maximum: number, out: SurfaceSample) {
    this.contactMesh ??= new TrackContactMesh(this);
    return this.contactMesh.cast(origin, down, maximum, out);
  }
  private queryPoint = trackPoint();
  rain = 0;
  cloud = 0.12;
  ambient = 24;
  windX = 1.5;
  windZ = 0.6;
  surfaceClock = 0;
  constructor(
    readonly preset: WeatherPreset = 'clear',
    readonly flat = false,
  ) {
    const count = 1536;
    let distance = 0;
    for (let i = 0; i <= count; i++) {
      const t = (i / count) * DESIGN.length,
        k = Math.floor(t),
        f = t - k,
        n = DESIGN.length;
      const a = DESIGN[mod(k - 1, n)],
        b = DESIGN[mod(k, n)],
        c = DESIGN[mod(k + 1, n)],
        d = DESIGN[mod(k + 2, n)];
      const p = trackPoint();
      p.x = catmull(a[0], b[0], c[0], d[0], f);
      p.z = catmull(a[1], b[1], c[1], d[1], f);
      if (i) distance += Math.hypot(p.x - this.points[i - 1].x, p.z - this.points[i - 1].z);
      p.s = distance;
      this.points.push(p);
    }
    this.length = distance;
    for (let i = 0; i < count; i++) {
      const p = this.points[i],
        prev = this.points[mod(i - 1, count)],
        next = this.points[(i + 1) % count];
      const len = Math.hypot(next.x - prev.x, next.z - prev.z);
      p.tx = (next.x - prev.x) / len;
      p.tz = (next.z - prev.z) / len;
      p.nx = p.tz;
      p.nz = -p.tx;
      const theta = (p.s / this.length) * TAU;
      p.y = flat ? 0 : 1.5 * Math.sin(theta) + 0.65 * Math.sin(3 * theta);
      p.gradient = flat
        ? 0
        : ((1.5 * Math.cos(theta) + 1.95 * Math.cos(3 * theta)) * TAU) / this.length;
      p.bank = flat ? 0 : 0.018 * Math.sin(2 * theta);
      p.width = 8 + 0.6 * Math.sin(theta) ** 2;
      const hx = Math.floor(p.x / 32),
        hz = Math.floor(p.z / 32);
      for (let dx = -1; dx <= 1; dx++)
        for (let dz = -1; dz <= 1; dz++) {
          const key = `${hx + dx},${hz + dz}`,
            list = this.hash.get(key);
          if (list) list.push(i);
          else this.hash.set(key, [i]);
        }
    }
    for (let i = 0; i < count; i++) {
      const prev = this.points[mod(i - 2, count)],
        next = this.points[(i + 2) % count],
        p = this.points[i];
      const ds = mod(next.s - prev.s, this.length) || 1;
      p.curvature =
        Math.atan2(prev.tz * next.tx - prev.tx * next.tz, prev.tx * next.tx + prev.tz * next.tz) /
        ds;
    }
    Object.assign(this.points[count], this.points[0], { s: this.length });
    for (let i = 0; i < this.water.length; i++) {
      this.temperature[i] = preset === 'rain' ? 22 : 34;
      this.water[i] = preset === 'rain' ? 0.7 + 0.35 * (0.5 + 0.5 * Math.sin(i * 0.27)) : 0;
      this.rubber[i] = Math.abs((i % CELL_COLS) - 3) < 2 ? 0.2 : 0.035;
    }
    if (preset === 'rain') {
      this.rain = 24;
      this.cloud = 0.95;
      this.ambient = 19;
    }
  }
  at(s: number, out: TrackPoint): TrackPoint {
    s = mod(s, this.length);
    let lo = 0,
      hi = this.points.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.points[mid].s <= s) lo = mid;
      else hi = mid;
    }
    const a = this.points[lo],
      b = this.points[hi],
      t = (s - a.s) / (b.s - a.s || 1);
    out.s = s;
    out.x = lerp(a.x, b.x, t);
    out.y = lerp(a.y, b.y, t);
    out.z = lerp(a.z, b.z, t);
    out.tx = lerp(a.tx, b.tx, t);
    out.tz = lerp(a.tz, b.tz, t);
    const len = Math.hypot(out.tx, out.tz);
    out.tx /= len;
    out.tz /= len;
    out.nx = out.tz;
    out.nz = -out.tx;
    out.width = lerp(a.width, b.width, t);
    out.bank = lerp(a.bank, b.bank, t);
    out.gradient = lerp(a.gradient, b.gradient, t);
    out.curvature = lerp(a.curvature, b.curvature, t);
    return out;
  }
  nearest(x: number, z: number, out: TrackPoint): number {
    const candidates = this.hash.get(`${Math.floor(x / 32)},${Math.floor(z / 32)}`);
    let best = Infinity,
      bestS = 0;
    const scan = (i: number) => {
      const a = this.points[i],
        b = this.points[i + 1],
        dx = b.x - a.x,
        dz = b.z - a.z,
        t = clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz), 0, 1),
        d = (x - a.x - dx * t) ** 2 + (z - a.z - dz * t) ** 2;
      if (d < best) {
        best = d;
        bestS = lerp(a.s, b.s, t);
      }
    };
    if (candidates) {
      for (const i of candidates) scan(i);
    } else for (let i = 0; i < this.points.length - 1; i++) scan(i);
    this.at(bestS, out);
    return (x - out.x) * out.nx + (z - out.z) * out.nz;
  }
  pitOffset(s: number) {
    s = mod(s, this.length);
    if (s > this.length - 220) return 22 * smooth(this.length - 220, this.length - 100, s);
    if (s < 215) return 22;
    if (s < 330) return 22 * (1 - smooth(215, 330, s));
    return 0;
  }
  boundary(s: number, side: number) {
    const p = this.at(s, trackPoint());
    return side < 0 ? p.width + 11 : Math.max(p.width + 11, this.pitOffset(s) + 5);
  }
  isPitSection(s: number) {
    return s > this.length - 190 || s < 300;
  }
  sample(x: number, z: number, out: SurfaceSample): SurfaceSample {
    const p = this.queryPoint,
      l = this.nearest(x, z, p),
      a = Math.abs(l),
      pitOffset = this.pitOffset(p.s),
      pit = this.isPitSection(p.s) && pitOffset > 3 && Math.abs(l - pitOffset) < 3.6;
    let surface: number = SURFACE.ASPHALT,
      grip = 1,
      resistance = 0.015,
      kerb = 0;
    if (pit) surface = SURFACE.PIT;
    else if (a > p.width + 4) {
      surface = p.curvature * l < -0.009 ? SURFACE.GRAVEL : SURFACE.GRASS;
      grip = surface === SURFACE.GRAVEL ? 0.4 : 0.53;
      resistance = surface === SURFACE.GRAVEL ? 0.16 : 0.08;
    } else if (a > p.width + 1.1) {
      surface = SURFACE.PAINT;
      grip = 0.93;
    } else if (a > p.width) {
      surface = SURFACE.KERB;
      grip = 0.91;
      kerb = kerbHeight(p.s, a - p.width);
    } else if (a > p.width - 0.18) {
      surface = SURFACE.PAINT;
      grip = 0.94;
    }
    const row = Math.min(CELL_ROWS - 1, Math.floor((p.s / this.length) * CELL_ROWS)),
      col = clamp(Math.floor(((l / p.width) * 0.5 + 0.5) * CELL_COLS), 0, CELL_COLS - 1),
      cell = row * CELL_COLS + col;
    out.s = p.s;
    out.lateral = l;
    out.width = p.width;
    out.height = p.y + p.bank * clamp(l, -12, 12) + kerb;
    out.pit = pit;
    out.normal
      .set(-p.tx * p.gradient - p.nx * p.bank, 1, -p.tz * p.gradient - p.nz * p.bank)
      .normalize();
    out.surface = surface;
    out.grip = grip;
    out.resistance = resistance;
    out.cell = cell;
    out.water = this.water[cell];
    out.rubber = this.rubber[cell];
    out.marbles = this.marbles[cell];
    out.temp = this.temperature[cell];
    return out;
  }
  evolve(dt: number, time: number) {
    this.surfaceClock += dt;
    if (this.surfaceClock < 0.5) return;
    const step = this.surfaceClock;
    this.surfaceClock = 0;
    if (this.preset === 'changeable') {
      this.cloud = lerp(0.16, 0.95, smooth(25, 115, time));
      this.rain = 36 * smooth(60, 135, time);
      this.ambient = lerp(25, 19, smooth(60, 180, time));
    }
    for (let r = 0; r < CELL_ROWS; r++)
      for (let c = 0; c < CELL_COLS; c++) {
        const i = r * CELL_COLS + c,
          depression = 0.65 + 0.35 * Math.sin(r * 0.113 + c * 0.4) ** 2,
          rainfall = (this.rain / 3600) * depression,
          drainage = this.water[i] * (0.002 + (0.003 * Math.abs(c - 3)) / 3),
          evaporation = (1 - this.cloud) * 0.0006;
        this.water[i] = Math.max(0, this.water[i] + (rainfall - drainage - evaporation) * step);
        this.rubber[i] = Math.max(0, this.rubber[i] - this.rain * 0.000001 * step);
        const target = this.ambient + 14 * (1 - this.cloud);
        this.temperature[i] += (target - this.temperature[i]) * 0.015 * step;
      }
  }
  interact(cell: number, load: number, energy: number, speed: number, dt: number) {
    this.rubber[cell] = Math.min(1, this.rubber[cell] + (load * 1e-9 + energy * 8e-10) * dt);
    this.water[cell] = Math.max(0, this.water[cell] - Math.abs(speed) * 0.00025 * dt);
    const c = cell % CELL_COLS,
      edge = cell - c + (c < 3 ? 0 : 6);
    this.marbles[edge] = Math.min(1, this.marbles[edge] + energy * 2e-9 * dt);
  }
  meanWater() {
    let total = 0;
    for (const w of this.water) total += w;
    return total / this.water.length;
  }
}
