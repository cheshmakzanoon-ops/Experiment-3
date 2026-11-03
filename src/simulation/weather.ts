import { clamp, lerp, smooth } from '../core/math.ts';
import type { WeatherPreset } from './config.ts';
import { MATERIAL, MATERIALS, materialGrip } from './surface-material.ts';
import { H } from './protocol.ts';

/** SI units except rain (mm/hour) and explicit Celsius. Direction is where the
 * air travels: zero is +Z, pi/2 is +X; this is not meteorological 'wind from'.
 *
 * The atmosphere channels after `windDirection` are OPTIONAL: a keyframe that
 * omits them describes the original clear-air, gust-free, no-dust, no-dew
 * conditions, so every pre-existing timeline, replay and test is unchanged.
 *  - visibilityM: meteorological visibility of the air itself (m), what a fog,
 *    mist or dust bank leaves. Rain's own extinction is added separately by
 *    the renderer from the rain rate; do not pre-bake it here.
 *  - dust01: 0 water droplets (fog) .. 1 mineral dust. Sets the colour of the
 *    obscuring air and, with its extinction, how fast a loose film settles on
 *    the tarmac.
 *  - gustMS: peak extra wind speed (m/s) of the gust envelope on top of the
 *    mean wind. The envelope is a pure function of session time.
 *  - moistureMmHr: water deposited on the surface without rainfall (fog drip
 *    and dew), mm/hour water equivalent. */
export interface WeatherKeyframe {
  timeSec: number;
  cloudCover01: number;
  rainRateMmHr: number;
  ambientTempC: number;
  windSpeedMS: number;
  windDirection: number;
  visibilityM?: number;
  dust01?: number;
  gustMS?: number;
  moistureMmHr?: number;
}
export interface WeatherState {
  cloud: number;
  rain: number;
  ambient: number;
  windX: number;
  windZ: number;
  /** Optional on the type so older callers' plain objects still sample. */
  visibility?: number;
  dust?: number;
  gust?: number;
  moisture?: number;
}
const LIMITS: Record<
  Exclude<keyof WeatherKeyframe, 'visibilityM' | 'dust01' | 'gustMS' | 'moistureMmHr'>,
  readonly [number, number]
> = {
  timeSec: [0, 86400],
  cloudCover01: [0, 1],
  rainRateMmHr: [0, 100],
  ambientTempC: [-30, 60],
  windSpeedMS: [0, 40],
  windDirection: [-Math.PI * 2, Math.PI * 2],
};

/** Meteorological visibility of clear air (m). A keyframe without
 * `visibilityM` means exactly this, and its excess extinction is exactly 0. */
export const CLEAR_VISIBILITY_M = 30000;
/** Koschmieder constant: ln(1 / 0.02), the 2 % contrast threshold of
 * meteorological visibility, V = 3.912 / sigma. */
export const KOSCHMIEDER = 3.912;
const OPTIONAL: Record<
  'visibilityM' | 'dust01' | 'gustMS' | 'moistureMmHr',
  readonly [number, number, number]
> = {
  visibilityM: [20, 50000, CLEAR_VISIBILITY_M],
  dust01: [0, 1, 0],
  gustMS: [0, 30, 0],
  moistureMmHr: [0, 5, 0],
};
/** The wind never exceeds the validated 40 m/s even with a gust on top. */
const MAX_WIND = LIMITS.windSpeedMS[1];

/** Extra extinction (per km) a visibility leaves beyond clear air; exactly 0
 * at or above CLEAR_VISIBILITY_M. This is the value carried in the snapshot
 * (H.EXTINCTION) and consumed by the renderer. */
export function particulateExtinctionPerKm(visibilityM: number) {
  if (!Number.isFinite(visibilityM) || visibilityM <= 0) throw new Error('Invalid visibility');
  return Math.max(
    0,
    KOSCHMIEDER / (visibilityM / 1000) - KOSCHMIEDER / (CLEAR_VISIBILITY_M / 1000),
  );
}
/** Rain's extinction per km per mm/h (renderer: AERIAL_PERSPECTIVE.rainExtinction
 * 6.25e-5 per metre). Kept here so HUD, AI and renderer agree. */
export const RAIN_EXTINCTION_PER_KM_PER_MMHR = 0.0625;
/** What the driver can actually see (m): clear air, the particulate excess and
 * the rain, combined as extinctions and bounded to the clear-air range. */
export function effectiveVisibilityM(excessExtinctionPerKm: number, rainMmHr = 0) {
  if (![excessExtinctionPerKm, rainMmHr].every(Number.isFinite))
    throw new Error('Invalid visibility inputs');
  const sigma =
    KOSCHMIEDER / (CLEAR_VISIBILITY_M / 1000) +
    Math.max(0, excessExtinctionPerKm) +
    RAIN_EXTINCTION_PER_KM_PER_MMHR * clamp(rainMmHr, 0, 60);
  return Math.min(CLEAR_VISIBILITY_M, (KOSCHMIEDER / sigma) * 1000);
}

/** What a driver can see on this track right now (m): the air's own visibility
 * and the rain, as extinctions. */
export function trackVisibilityM(track: { visibility: number; rain: number }) {
  return effectiveVisibilityM(particulateExtinctionPerKm(track.visibility), track.rain);
}
/** Pace a sensible driver holds with the view that far ahead: full pace from
 * 600 m, falling smoothly to 88 % at 60 m or less. A braking zone of 150 m at
 * 70 m/s is 2 s of sight; below ~250 m the limit is what the driver can stop
 * for, not what the tyres allow. Pace only: grip is the tyre model's. The
 * floor was measured, not guessed: on Aurel (weather-matrix.ts) 0.80 made the
 * AI lap 17 points slower than its grip alone in fog, which would leave a
 * human driver alone at the front; 0.88 costs about 9 points. */
export const VISIBILITY_PACE = Object.freeze({ floor: 0.88, near: 60, far: 600 });
export function visibilityPace(visibilityM: number) {
  if (!Number.isFinite(visibilityM)) throw new Error('Invalid visibility');
  return (
    VISIBILITY_PACE.floor +
    (1 - VISIBILITY_PACE.floor) * smooth(VISIBILITY_PACE.near, VISIBILITY_PACE.far, visibilityM)
  );
}
/** The flap stays closed when the driver cannot see the car ahead well enough
 * to judge a closing speed (race control hook; drs.ts). */
export const DRS_MIN_VISIBILITY_M = 250;

/** Loose dust film on sealed tarmac, expressed in the existing marble-coverage
 * field (track.marbles, 0..1 per cell) so the tyre contamination, grip and
 * pickup physics are reused unchanged. Reduced model, NOT a mass balance.
 *
 * `maxCoverage` is the settled film of the worst storm. Through the tyre
 * model it costs a slick roughly 0.14 x coverage directly plus the tread dirt
 * it feeds (contamination.ts picks up ~0.025 x coverage x speed): at 0.09 and
 * 60 m/s that is about 13 % of the dry peak, enough to matter and well short
 * of gravel. The film settles with `depositSeconds` and blows off with
 * `blowSeconds` shortened by the wind (squared), and sits thinner on the
 * rubbered racing line, which the field sweeps and the rubber seals. */
export const DUST_FILM = Object.freeze({
  maxCoverage: 0.09,
  depositSeconds: 150,
  blowSeconds: 600,
  /** Share of the film the laid rubber removes at full rubber coverage. */
  lineSweep: 0.6,
  /** Dust extinction (per km) at which the supply saturates (~190 m). */
  fullSupplyPerKm: 20,
});
/** The film coverage the air would settle to for this dust, visibility and
 * local laid rubber (0..0.45). 0 when the air carries no dust. */
export function dustSettlingTarget(dust01: number, visibilityM: number, rubber: number) {
  if (![dust01, visibilityM, rubber].every(Number.isFinite))
    throw new Error('Invalid dust settling input');
  if (dust01 <= 0) return 0;
  const dustExtinction = particulateExtinctionPerKm(visibilityM) * clamp(dust01, 0, 1),
    supply = smooth(1, DUST_FILM.fullSupplyPerKm, dustExtinction),
    sweep = 1 - DUST_FILM.lineSweep * clamp(rubber / 0.45, 0, 1);
  return DUST_FILM.maxCoverage * supply * sweep;
}
/** Exact first-order relaxation of a cell's film toward its target over one
 * surface step: deposition when the air supplies more, blow-off (faster in a
 * strong wind) when it supplies less. Bounded, monotone, step-size stable. */
export function settleDust(coverage: number, target: number, dt: number, windMS: number) {
  if (![coverage, target, dt, windMS].every(Number.isFinite) || dt < 0)
    throw new Error('Invalid dust settling step');
  const rate =
    target >= coverage
      ? 1 / DUST_FILM.depositSeconds
      : (1 + (Math.max(0, windMS) / 6) ** 2) / DUST_FILM.blowSeconds;
  return clamp(target + (coverage - target) * Math.exp(-rate * dt), 0, 1);
}

/** Lightning is scenery, not physics: a deterministic schedule that is a pure
 * function of the session time and how violent the rain is, so the flash a
 * replay shows at 61.4 s is the flash the live session showed, and the
 * thunder the audio plays arrives at the same moment. One candidate strike per
 * `slotSec` slot, present with probability 0.72 x intensity, at a hashed time
 * and a hashed distance (0.6-6 km). Intensity is the rain rate's own measure of
 * a convective cell: none below 40 mm/h, full from 58 mm/h. */
export const LIGHTNING = Object.freeze({
  slotSec: 6.5,
  probability: 0.72,
  rainOnset: 40,
  rainFull: 58,
  minDistanceM: 600,
  maxDistanceM: 6000,
  speedOfSound: 343,
});
export function lightningIntensity(rainMmHr: number) {
  return Number.isFinite(rainMmHr) ? smooth(LIGHTNING.rainOnset, LIGHTNING.rainFull, rainMmHr) : 0;
}
/** Integer hash to [0, 1): stable across platforms (32-bit integer maths). */
function hash01(slot: number, salt: number) {
  let h = (Math.imul(slot | 0, 0x9e3779b1) ^ Math.imul(salt, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export interface Strike {
  timeSec: number;
  distanceM: number;
}
export function strikeInSlot(slot: number, intensity01: number): Strike | null {
  if (!(intensity01 > 0) || hash01(slot, 1) >= LIGHTNING.probability * intensity01) return null;
  return {
    timeSec: slot * LIGHTNING.slotSec + hash01(slot, 2) * (LIGHTNING.slotSec - 1),
    distanceM:
      LIGHTNING.minDistanceM +
      (LIGHTNING.maxDistanceM - LIGHTNING.minDistanceM) * hash01(slot, 3) ** 1.5,
  };
}
const FLICKER = [
  [0, 1, 0.045],
  [0.11, 0.6, 0.04],
  [0.24, 0.85, 0.07],
] as const;
/** Sky/scene flash 0..1 at `timeSec`: a return stroke and two re-strikes, each
 * decaying in tens of milliseconds, dimmer for a distant strike. */
export function lightningFlash(timeSec: number, intensity01: number) {
  if (!Number.isFinite(timeSec) || !(intensity01 > 0)) return 0;
  const slot = Math.floor(timeSec / LIGHTNING.slotSec);
  let flash = 0;
  for (let k = slot; k >= slot - 1; k--) {
    const strike = strikeInSlot(k, intensity01);
    if (!strike) continue;
    const reach = 1 / (1 + strike.distanceM / 4500);
    for (const [offset, amplitude, decay] of FLICKER) {
      const age = timeSec - strike.timeSec - offset;
      if (age >= 0) flash = Math.max(flash, amplitude * reach * 1.45 * Math.exp(-age / decay));
    }
  }
  return Math.min(1, flash);
}
/** Thunder level 0..1 at `timeSec`: each strike arrives after distance / 343
 * m/s with a sharp onset and a rumble that lengthens with distance. */
export function thunderLevel(timeSec: number, intensity01: number) {
  if (!Number.isFinite(timeSec) || !(intensity01 > 0)) return 0;
  const slot = Math.floor(timeSec / LIGHTNING.slotSec);
  let level = 0;
  for (let k = slot; k >= slot - 4; k--) {
    const strike = strikeInSlot(k, intensity01);
    if (!strike) continue;
    const age = timeSec - strike.timeSec - strike.distanceM / LIGHTNING.speedOfSound;
    if (age < 0) continue;
    const loud = 1 / (1 + strike.distanceM / 1200),
      rumble = 1.2 + strike.distanceM / 1800;
    level = Math.max(level, loud * 1.8 * (1 - Math.exp(-age / 0.12)) * Math.exp(-age / rumble));
  }
  return Math.min(1, level);
}

/** Wind that loads the bodywork sideways. The cars' existing calibration
 * (lap references, wake and drag fits) already contains the mild breezes of
 * the original presets (<= 4.2 m/s), so the lateral aerodynamic force is
 * blended in only above that: `windLoadFactor` is exactly 0 up to 4.5 m/s
 * and 1 from 7 m/s (a strong breeze, Beaufort 4 to 5). Below the knee a car
 * behaves, bit for bit, as before.
 *
 * Linearised side force of a body in yaw: F = 1/2 rho |V| (Cy_beta A) w_lat,
 * where V is the airspeed, w_lat the wind component across the body, and
 * Cy_beta A = sideSlope x (side planform area, 4 hy hz of the collision box):
 * about 2.1 m^2/rad for the Formula car, 1.3 for a GP motorcycle. At 70 m/s
 * with a 12 m/s crosswind that is 0.18 g on the Formula car. The force acts a
 * little ahead of the centre of mass (centrePressure x wheelbase). */
export const CROSSWIND = Object.freeze({
  kneeLow: 4.5,
  kneeHigh: 7,
  sideSlope: 0.55,
  centrePressure: 0.05,
});
export function windLoadFactor(windSpeedMS: number) {
  return Number.isFinite(windSpeedMS) ? smooth(CROSSWIND.kneeLow, CROSSWIND.kneeHigh, windSpeedMS) : 0;
}
/** Side force (N, along the body-frame direction the wind blows across the
 * body) for the airspeed, lateral wind component and collision half extents. */
export function crosswindForce(
  airspeed: number,
  lateralWind: number,
  halfY: number,
  halfZ: number,
  load: number,
  airDensity = 1.225,
) {
  return (
    0.5 * airDensity * CROSSWIND.sideSlope * 4 * halfY * halfZ * Math.abs(airspeed) * lateralWind * load
  );
}

/** Wind gust envelope, 0..1: three incommensurate periods (about 9.1 s, 4.3 s
 * and 17.9 s) combined and thresholded so gusts arrive as separate surges
 * with lulls between them, never as a steady sine. A pure function of the
 * session time: seekable, replay-safe and independent of how often it is
 * sampled. */
export function gustEnvelope(timeSec: number) {
  if (!Number.isFinite(timeSec)) throw new Error('Invalid gust time');
  const tau = Math.PI * 2;
  const slow = 0.5 + 0.5 * Math.sin((tau * timeSec) / 17.9 + 2.2),
    mid = 0.5 + 0.5 * Math.sin((tau * timeSec) / 9.1 + 1.3),
    fast = 0.5 + 0.5 * Math.sin((tau * timeSec) / 4.3 + 0.4);
  return smooth(0.38, 0.92, 0.5 * mid + 0.3 * fast + 0.2 * slow);
}

/** Validated, immutable weather data. Sampling is allocation-free, seekable and
 * independent of the number or spacing of calls (including replay rewinds).
 * Smooth bounded interpolation never creates negative rain or overshoot. */
export class WeatherTimeline {
  readonly keyframes: readonly Readonly<WeatherKeyframe>[];
  constructor(frames: readonly WeatherKeyframe[]) {
    if (!Array.isArray(frames) || frames.length < 1 || frames.length > 256)
      throw new Error('Weather timeline requires 1–256 keyframes');
    this.keyframes = Object.freeze(
      frames.map((frame, index) => {
        if (!frame || typeof frame !== 'object') throw new Error('Invalid weather keyframe');
        const copy = {} as WeatherKeyframe;
        for (const key of Object.keys(LIMITS) as (keyof typeof LIMITS)[]) {
          const value = frame[key],
            [min, max] = LIMITS[key];
          if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
            throw new Error(`Invalid weather ${key}`);
          copy[key] = value;
        }
        // Optional atmosphere channels: absent means the original clear air.
        for (const key of Object.keys(OPTIONAL) as (keyof typeof OPTIONAL)[]) {
          const [min, max, fallback] = OPTIONAL[key],
            value = frame[key] ?? fallback;
          if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
            throw new Error(`Invalid weather ${key}`);
          copy[key] = value;
        }
        if (
          (index === 0 && copy.timeSec !== 0) ||
          (index > 0 && copy.timeSec <= frames[index - 1].timeSec)
        )
          throw new Error('Weather times must start at zero and increase strictly');
        return Object.freeze(copy);
      }),
    );
  }
  sample(timeSec: number, out: WeatherState): WeatherState {
    if (!Number.isFinite(timeSec)) throw new Error('Invalid weather sample time');
    const frames = this.keyframes;
    let lo = 0,
      hi = frames.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >>> 1;
      if (frames[mid].timeSec <= timeSec) lo = mid;
      else hi = mid;
    }
    const a = frames[lo],
      b = frames[hi];
    const t = hi === lo ? 0 : smooth(a.timeSec, b.timeSec, timeSec);
    out.cloud = lerp(a.cloudCover01, b.cloudCover01, t);
    out.rain = lerp(a.rainRateMmHr, b.rainRateMmHr, t);
    out.ambient = lerp(a.ambientTempC, b.ambientTempC, t);
    // Visibility is interpolated in the log domain: fog lifts at a constant
    // rate of improvement, not as a jump from 150 m to a kilometre.
    out.visibility =
      a.visibilityM === b.visibilityM
        ? a.visibilityM!
        : Math.exp(lerp(Math.log(a.visibilityM!), Math.log(b.visibilityM!), t));
    out.dust = lerp(a.dust01!, b.dust01!, t);
    out.moisture = lerp(a.moistureMmHr!, b.moistureMmHr!, t);
    const gustPeak = lerp(a.gustMS!, b.gustMS!, t);
    out.gust = gustPeak > 0 ? gustPeak * gustEnvelope(timeSec) : 0;
    // Interpolate direction on the short arc: 350° -> 10° crosses north, not south.
    const angle =
      a.windDirection +
      Math.atan2(
        Math.sin(b.windDirection - a.windDirection),
        Math.cos(b.windDirection - a.windDirection),
      ) *
        t;
    const mean = lerp(a.windSpeedMS, b.windSpeedMS, t),
      speed = Math.min(MAX_WIND, mean + out.gust);
    // A gust is a surge in speed that also veers the air (up to ~0.4 rad) in
    // proportion to its share of the wind; a lull is steadier.
    const veer =
      out.gust > 0 ? 0.4 * Math.sin(timeSec * 0.83 + 0.7) * (out.gust / (mean + out.gust)) : 0;
    out.windX = Math.sin(angle + veer) * speed;
    out.windZ = Math.cos(angle + veer) * speed;
    return out;
  }
}

/** Precipitation phase. The timeline carries ONE precipitation channel
 * (`rainRateMmHr`, water equivalent) and the air temperature decides what it
 * falls as: rain at or above `rainAboveC`, snow at or below `snowBelowC`, a
 * smooth sleet blend between. Everything that reads the channel for liquid
 * water (spray, wet look, lens drops, rain hiss) takes `liquidRain`, so no
 * header slot or protocol change is needed and every preset that stays above
 * 2 C (all the original ones) is untouched: `snowShare` is exactly 0 there. */
export const PRECIPITATION = Object.freeze({ snowBelowC: 0, rainAboveC: 2 });
export function snowShare(ambientC: number) {
  return Number.isFinite(ambientC)
    ? 1 - smooth(PRECIPITATION.snowBelowC, PRECIPITATION.rainAboveC, ambientC)
    : 0;
}
/** The part of a precipitation rate that arrives as liquid water (mm/h). */
export function liquidRain(precipMmHr: number, ambientC: number) {
  const snow = snowShare(ambientC);
  return snow === 0 ? precipMmHr : precipMmHr * (1 - snow);
}
/** Liquid precipitation (mm/h) of a presented snapshot: what wets surfaces,
 * throws spray and speckles a lens. Snow is `snowfallMmHr` of the same slots. */
export function frameLiquidRain(frame: ArrayLike<number>) {
  return liquidRain(frame[H.RAIN], frame[H.AMBIENT]);
}
/** The part that arrives as snow (mm/h water equivalent). */
export function snowfallMmHr(precipMmHr: number, ambientC: number) {
  const snow = snowShare(ambientC);
  return snow === 0 ? 0 : precipMmHr * snow;
}

/** Frozen cover on the road: snow that has fallen, or a water film that has
 * frozen, held per surface cell as millimetres of water equivalent. Reduced
 * model with the physics that matters at a race pace:
 *  - Snowfall adds to the cover at the water-equivalent rate (plus the cell's
 *    catchment variation). A short session barely changes it (3.4 mm/h is
 *    0.06 mm a minute): the cover is mostly the state the day starts in.
 *  - Phase change is an enthalpy balance on the thin surface node
 *    (`settlePhase`): a surface above 0 C with cover melts it, spending
 *    `surfaceCapacity x T` joules at 334 kJ/kg and pinning the surface at 0 C
 *    while any cover remains; a surface below 0 C with liquid water freezes
 *    it and the latent heat warms the node toward 0 C. So a thaw is slow and
 *    a hard frost glazes only as much water as the cold road can freeze.
 *  - Grip (`frozenGripFactor`) blends loose snow (surface-material.ts SNOW,
 *    mu 0.30 of dry asphalt) with polished ice (ICE, 0.12) by how much the
 *    cell is glazed, and both stiffen as it gets colder
 *    (`materialGrip` meltSensitive: -21 % at -4 C, -45 % at 0.5 C). A winter
 *    construction recovers a share of what the cover takes away.
 * `rubber` (laid by the earlier sessions along the racing line) stands for
 * traffic polish: where cars have driven the cover is worn thin and the rest
 * compacted and glazed (dark, polished wheel tracks, partly bare), beside the
 * line it is deep, loose snow. Fresh cover thicker than a few millimetres of
 * water equivalent hides the glaze again. */
export const FROST = Object.freeze({
  /** Water equivalent (mm) at which the cell counts as fully covered. */
  fullCoverMm: 0.8,
  /** Cap of accumulation (mm w.e.): ploughing and drift keep a road below it. */
  maxCoverMm: 6,
  /** Latent heat of fusion: J per kg, which is J per m^2 per mm of water. */
  latentHeat: 3.34e5,
  /** Rubber coverage that counts as a fully polished racing line. */
  polishRubber: 0.45,
  /** Fresh cover (mm w.e.) that starts, and completely, hiding the glaze. */
  hideFrom: 0.8,
  hideTo: 4,
  /** Rolling resistance a fully covered road adds (coefficient). */
  rolling: 0.012,
  /** Share of the way from loose snow to bare ice that a fully polished
   * (traffic-compacted) cover reaches. Packed snow is not glare ice: half way
   * keeps a polished line near 0.17 of dry grip against 0.25 for fresh snow
   * at -4.5 C, which is what compacted snow measures (mu 0.15 to 0.25). */
  glazeIce: 0.5,
});
/** Coverage 0..1 of a cell: a trace is a patchy frost, 0.8 mm w.e. a white road. */
export function frozenCover(frozenMm: number) {
  return frozenMm > 0 ? smooth(0, FROST.fullCoverMm, frozenMm) : 0;
}
/** Glaze 0..1: how polished the cover is (the racing line) rather than fresh. */
export function glazeShare(rubber: number, frozenMm: number) {
  return (
    clamp(rubber / FROST.polishRubber, 0, 1) * (1 - 0.6 * smooth(FROST.hideFrom, FROST.hideTo, frozenMm))
  );
}
/** Share of the loss to snow and ice a tyre construction wins back (sipes,
 * snow-trapping blocks, studs): independent recoveries of compound and family. */
export function winterRecovery(compoundShare: number, familyShare = 0) {
  return 1 - (1 - compoundShare) * (1 - familyShare);
}
/** Friction of the covered surface relative to dry racing asphalt (the same
 * scale as `MATERIALS[..].grip`), 0..1, for a cell with `frozenMm` of cover.
 * 1 exactly when there is none. */
export function frozenGripFactor(
  frozenMm: number,
  rubber: number,
  waterMm: number,
  tempC: number,
  recovery = 0,
) {
  const cover = frozenCover(frozenMm);
  if (cover <= 0) return 1;
  const snow = materialGrip(MATERIALS[MATERIAL.SNOW], waterMm, tempC),
    ice = materialGrip(MATERIALS[MATERIAL.ICE], waterMm, tempC),
    glaze = glazeShare(rubber, frozenMm),
    base = lerp(snow, ice, glaze * FROST.glazeIce);
  return lerp(1, base + (1 - base) * recovery, cover);
}
/** The surface id a wheel reports in the snapshot (W.SURFACE): the road's own
 * id, unless the cell is at least half covered, when the tread is rolling on
 * snow, or on ice where the cover is glazed. Audio and spray then hear and
 * throw what is really under the tyre; the physics keeps its own contact. */
export function reportedSurface(surface: number, frozenMm: number | undefined, rubber: number) {
  if (!frozenMm || frozenMm <= 0 || surface > 5 || frozenCover(frozenMm) < 0.5) return surface;
  return glazeShare(rubber, frozenMm) > 0.5 ? MATERIAL.ICE : MATERIAL.SNOW;
}
/** Race control's reading of the conditions: how little the drivers can see
 * and how much water the road carries. Original rules (not a claim of any
 * sporting regulation), built on the same two numbers the drivers use:
 *  - `safePaceMS(V)`: the speed from which a driver can stop inside the
 *    visible distance V with a 1 s reaction and 8 m/s^2 of braking in poor
 *    conditions, v = a (sqrt(t^2 + 2 V / a) - t). 100 m of view is 32.8 m/s,
 *    the virtual-safety-car pace; 60 m is 24 m/s; 35 m is 17 m/s.
 *  - Levels: 1 reduced pace (virtual safety car) below 100 m or 3.5 mm of
 *    standing water on average; 2 safety car below 60 m or 5 mm; 3 suspended
 *    (red flag: the field stops behind a stationary safety car) below 35 m or
 *    7 mm. A level is left only when the reading is 25 % clear of its
 *    threshold, so a fog bank or a squall that flickers around a line does not
 *    flap the race between flags.
 * The shipped presets sit outside the lines on purpose: Dawn fog opens at
 * 110 m, the dust storm at 170 m, the thunderstorm holds 2.1 to 2.5 mm; a
 * denser bank (authored weather, a keyframe table with a lower visibility)
 * or a deluge crosses them. */
export const VISIBILITY_RULES = Object.freeze({
  reducedBelowM: 100,
  safetyCarBelowM: 60,
  suspendBelowM: 35,
  waterReducedMm: 3.5,
  waterSafetyCarMm: 5,
  waterSuspendMm: 7,
  release: 1.25,
  braking: 8,
  reaction: 1,
});
export type RaceHazard = 0 | 1 | 2 | 3;
export function safePaceMS(visibilityM: number) {
  if (!Number.isFinite(visibilityM) || visibilityM <= 0) return 0;
  const { braking: a, reaction: t } = VISIBILITY_RULES;
  return a * (Math.sqrt(t * t + (2 * visibilityM) / a) - t);
}
export function raceHazard(
  visibilityM: number,
  meanWaterMm: number,
  previous: RaceHazard = 0,
): RaceHazard {
  if (!Number.isFinite(visibilityM) || !Number.isFinite(meanWaterMm)) return previous;
  const r = VISIBILITY_RULES,
    // 1 + number of lines crossed, with the release margin for the level held.
    level = (held: boolean, level: number, vis: number, water: number): boolean => {
      const margin = held ? r.release : 1,
        v = [r.reducedBelowM, r.safetyCarBelowM, r.suspendBelowM][level - 1],
        w = [r.waterReducedMm, r.waterSafetyCarMm, r.waterSuspendMm][level - 1];
      return vis < v * margin || water > w / margin;
    };
  let hazard: RaceHazard = 0;
  for (const l of [1, 2, 3] as const) if (level(previous >= l, l, visibilityM, meanWaterMm)) hazard = l;
  return hazard;
}

/** Pace a driver holds on a covered road (1 on a clear one). Snow and ice give
 * a low, flat friction peak with a long, gentle slide beyond it: a car on the
 * edge does not snap, it creeps wide, and corrections come late. Drivers keep
 * a margin below what the grip alone would allow: the floor is the share of
 * the envelope speed kept on a fully covered road. Pace only, like
 * `visibilityPace`; the tyre model's grip is untouched. */
export const FROST_PACE = Object.freeze({ floor: 0.7 });
export function frozenPace(frozenMm: number | undefined) {
  return frozenMm && frozenMm > 0 ? 1 - (1 - FROST_PACE.floor) * frozenCover(frozenMm) : 1;
}
/** Enthalpy-limited phase change of one surface cell over a step: melts cover
 * above 0 C, freezes liquid water below 0 C, conserving
 * `capacity x dT = L x dm` (capacity J/m^2/K, masses mm w.e.). */
export interface PhaseCell {
  surface: number;
  water: number;
  frozen: number;
}
export function settlePhase(cell: PhaseCell, capacity: number) {
  if (cell.surface > 0 && cell.frozen > 0) {
    const melt = Math.min(cell.frozen, (capacity * cell.surface) / FROST.latentHeat);
    cell.frozen -= melt;
    cell.water += melt;
    cell.surface -= (melt * FROST.latentHeat) / capacity;
  } else if (cell.surface < 0 && cell.water > 0) {
    const freeze = Math.min(cell.water, (capacity * -cell.surface) / FROST.latentHeat);
    cell.water -= freeze;
    cell.frozen = Math.min(FROST.maxCoverMm, cell.frozen + freeze);
    cell.surface += (freeze * FROST.latentHeat) / capacity;
  }
  return cell;
}

const calmSpeed = Math.hypot(1.5, 0.6),
  calmDirection = Math.atan2(1.5, 0.6);
/** Original scenario calibration, not a real-world meteorological forecast.
 * Clear and rain retain the previous constant conditions. The changing preset
 * contains a complete advancing storm and retreat, not permanent rain.
 *
 * The newer atmosphere presets use the optional channels:
 *  - fog: cold radiation fog. Visibility 110 m at the start (a car at
 *    250 km/h covers that in 1.6 s), thinning about log-linearly to 900 m by
 *    12 min and open air by 25 min as the surface warms; 0.3 mm/h of fog drip
 *    keeps a ~0.03 mm film on the tarmac, which costs a slick about 15 % grip.
 *  - storm: 52-64 mm/h cell, a 6.5-10.5 m/s wind with 4-11 m/s gusts
 *    (gust speeds to ~21 m/s, Beaufort 8-9) and a 900-4000 m rain curtain.
 *  - dust: a hot desert haboob. 39 C, 9.5-12 m/s wind gusting to 21 m/s, 170 m
 *    minimum visibility, dust-laden air that settles a loose film.
 *  - snow: a cold snowfall. -3.5 to -4 C, 2.4 to 3.4 mm/h water equivalent
 *    (heavy snow, about 3 cm/h of flakes, which the precipitation channel
 *    carries as snow because the air is below freezing), 420 to 950 m of
 *    visibility in the squall, easing to open air by 25 min; a light, steady
 *    breeze. The road starts snow-covered (`weatherSurfaceStart`). */
export function weatherKeyframes(preset: WeatherPreset): readonly WeatherKeyframe[] {
  const frame = (
    timeSec: number,
    cloudCover01: number,
    rainRateMmHr: number,
    ambientTempC: number,
    windSpeedMS = calmSpeed,
    windDirection = calmDirection,
    extra: Partial<
      Pick<WeatherKeyframe, 'visibilityM' | 'dust01' | 'gustMS' | 'moistureMmHr'>
    > = {},
  ): WeatherKeyframe => ({
    timeSec,
    cloudCover01,
    rainRateMmHr,
    ambientTempC,
    windSpeedMS,
    windDirection,
    ...extra,
  });
  switch (preset) {
    case 'clear':
      return [frame(0, 0.12, 0, 24)];
    case 'rain':
      return [frame(0, 0.95, 24, 19)];
    case 'fog':
      return [
        frame(0, 0.82, 0, 8, 0.8, 0.6, { visibilityM: 110, moistureMmHr: 0.3 }),
        frame(180, 0.82, 0, 8.5, 0.8, 0.6, { visibilityM: 130, moistureMmHr: 0.3 }),
        frame(420, 0.7, 0, 10.5, 1.1, 0.5, { visibilityM: 280, moistureMmHr: 0.22 }),
        frame(720, 0.5, 0, 13.5, 1.4, 0.4, { visibilityM: 900, moistureMmHr: 0.1 }),
        frame(1020, 0.3, 0, 16, 2, 0.3, { visibilityM: 4200, moistureMmHr: 0.02 }),
        frame(1500, 0.2, 0, 18.5, 2.4, 0.3, { visibilityM: 18000 }),
      ];
    case 'storm':
      return [
        frame(0, 0.96, 18, 19, 6.5, 0.9, { visibilityM: 4000, gustMS: 4 }),
        frame(40, 1, 60, 18, 8.5, 0.95, { visibilityM: 1500, gustMS: 8 }),
        frame(100, 1, 76, 17, 10, 1.0, { visibilityM: 900, gustMS: 10 }),
        frame(300, 1, 68, 17, 9.5, 1.1, { visibilityM: 1100, gustMS: 9 }),
        frame(480, 1, 76, 16.5, 10.5, 1.2, { visibilityM: 900, gustMS: 11 }),
        frame(720, 0.98, 52, 17, 8, 1.1, { visibilityM: 1800, gustMS: 7 }),
        frame(1000, 0.92, 30, 18, 6, 0.9, { visibilityM: 3500, gustMS: 4 }),
      ];
    case 'dust':
      return [
        frame(0, 0.5, 0, 39, 9.5, 2.4, { visibilityM: 320, dust01: 1, gustMS: 6 }),
        frame(60, 0.55, 0, 39, 11, 2.4, { visibilityM: 210, dust01: 1, gustMS: 8 }),
        frame(150, 0.55, 0, 38.5, 12, 2.5, { visibilityM: 170, dust01: 1, gustMS: 9 }),
        frame(420, 0.55, 0, 38, 11.5, 2.5, { visibilityM: 190, dust01: 1, gustMS: 8 }),
        frame(720, 0.35, 0, 37, 9, 2.4, { visibilityM: 520, dust01: 1, gustMS: 5 }),
        frame(1100, 0.2, 0, 36, 6.5, 2.3, { visibilityM: 2500, dust01: 1, gustMS: 3 }),
      ];
    case 'snow':
      return [
        frame(0, 0.96, 2.4, -3.5, 3.2, 0.7, { visibilityM: 800, gustMS: 2 }),
        frame(120, 0.98, 3.4, -4, 3.8, 0.75, { visibilityM: 420, gustMS: 3 }),
        frame(360, 0.97, 2, -4, 3, 0.7, { visibilityM: 950, gustMS: 2 }),
        frame(720, 0.9, 0.8, -3.5, 2.2, 0.6, { visibilityM: 2600, gustMS: 1 }),
        frame(1100, 0.7, 0.1, -3, 1.6, 0.5, { visibilityM: 9000 }),
        frame(1500, 0.5, 0, -2.5, 1.2, 0.4, { visibilityM: 16000 }),
      ];
    case 'changeable':
      return [
        frame(0, 0.16, 0, 25),
        frame(25, 0.16, 0, 25),
        frame(60, 0.43, 0, 25, 2.2, 1.05),
        frame(115, 0.95, 29.7, 22.4, 3.2, 0.8),
        frame(135, 0.95, 36, 20.9, 3.8, 0.65),
        frame(180, 0.95, 36, 19, 4.2, 0.55),
        frame(420, 0.95, 36, 19, 4.2, 0.55),
        frame(600, 0.8, 12, 20, 3.2, 0.2),
        frame(720, 0.58, 0, 21.5, 2.4, -0.1),
        frame(900, 0.22, 0, 24, 1.4, -0.25),
      ];
  }
}

/** Where the pavement starts a session. The original three keep their exact
 * numbers (34 C dry road, 22 C and wet under rain); the newer presets start
 * from the physics of their own morning: cold damp fog, a lukewarm storm
 * road, sun-baked desert tarmac. `waterMm` is the base film; the wet presets
 * add the same gentle spatial variation the rain preset always had. */
export function weatherSurfaceStart(preset: WeatherPreset): {
  tempC: number;
  waterMm: number;
  waterVariationMm: number;
  /** Snow cover at the start (mm water equivalent, off the racing line). */
  frozenMm?: number;
} {
  switch (preset) {
    case 'rain':
      return { tempC: 22, waterMm: 0.7, waterVariationMm: 0.35 };
    case 'fog':
      return { tempC: 8, waterMm: 0.03, waterVariationMm: 0.012 };
    case 'storm':
      return { tempC: 18, waterMm: 0.8, waterVariationMm: 0.4 };
    case 'dust':
      return { tempC: 49, waterMm: 0, waterVariationMm: 0 };
    case 'snow':
      // A cold-soaked road under 1.6 cm of settled snow (1 mm of water
      // equivalent is about 1 cm of fresh snow): the surface sits slightly
      // below the air, as a night radiating to a clear sky leaves it.
      return { tempC: -4.5, waterMm: 0, waterVariationMm: 0, frozenMm: 1.7 };
    case 'clear':
    case 'changeable':
      return { tempC: 34, waterMm: 0, waterVariationMm: 0 };
  }
}

/** Exact constant-input first-order surface step. k is drainage/second,
 * source is rainfall minus evaporation in mm/second. Unlike forward Euler,
 * bounded water and temperature remain stable for a delayed surface update. */
export function advanceWater(
  waterMm: number,
  sourceMmSec: number,
  drainagePerSec: number,
  dt: number,
) {
  if (
    !Number.isFinite(waterMm) ||
    !Number.isFinite(sourceMmSec) ||
    !Number.isFinite(drainagePerSec) ||
    !Number.isFinite(dt) ||
    waterMm < 0 ||
    drainagePerSec < 0 ||
    dt < 0
  )
    throw new Error('Invalid surface water step');
  if (drainagePerSec < 1e-12) return Math.max(0, waterMm + sourceMmSec * dt);
  const gain = -Math.expm1(-drainagePerSec * dt);
  return Math.max(0, waterMm * (1 - gain) + (sourceMmSec * gain) / drainagePerSec);
}

/** The render state is transported with each physics/replay frame, never sampled
 * from a second wall clock on the main thread. Defensive bounds are only for
 * presentation; malformed simulation state is still rejected by the worker. */
export function renderWind(value: number) {
  return Number.isFinite(value) ? clamp(value, -40, 40) : 0;
}
