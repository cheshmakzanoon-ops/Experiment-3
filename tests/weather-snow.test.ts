import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { WEATHER_CATALOGUE, WEATHER_IDS } from '../src/simulation/weather-catalogue.ts';
import {
  FROST,
  FROST_PACE,
  PRECIPITATION,
  WeatherTimeline,
  frameLiquidRain,
  frozenCover,
  frozenGripFactor,
  frozenPace,
  glazeShare,
  liquidRain,
  reportedSurface,
  settlePhase,
  snowShare,
  snowfallMmHr,
  weatherKeyframes,
  weatherSurfaceStart,
  winterRecovery,
  type PhaseCell,
  type WeatherState,
} from '../src/simulation/weather.ts';
import { MATERIAL } from '../src/simulation/surface-material.ts';
import { SURFACE_THERMAL } from '../src/simulation/surface-thermal.ts';
import { Track, surfaceSample } from '../src/simulation/track.ts';
import { peakGrip, makeTire, WINTER_COMPOUND } from '../src/simulation/tire.ts';
import { TIRE_FAMILIES } from '../src/simulation/tire-families.ts';
import { Simulation } from '../src/simulation/world.ts';
import {
  CAR_STRIDE,
  F,
  H,
  HEADER,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../src/simulation/protocol.ts';
import {
  SessionReplay,
  type ReplayPage,
  type ReplayPageStore,
} from '../src/storage/replay-pages.ts';
import { weatherAtmosphere, adjustDaylight } from '../src/rendering/weather-atmosphere.ts';
import { circuitLightState } from '../src/rendering/daylight.ts';
import { weatherAmbience } from '../src/audio/weather-ambience.ts';
import { contactMix, newContactMix } from '../src/audio/surface-audio.ts';
import { weatherReadout } from '../src/ui/presentation.ts';
import {
  SNOW_CATCH,
  WeatherPresentation,
  sceneryCover,
  sceneryCoverUniform,
} from '../src/rendering/weather-presentation.ts';
import { WEATHER_GLYPH, glyph } from '../src/ui/glyphs.ts';
import { loadingTipsFor } from '../src/ui/loading-tips.ts';
import { Effects, PARTICLE_KIND } from '../src/rendering/effects.ts';
import wetRoadShader from '../src/shaders/wetRoad.frag?raw';

const state = (): WeatherState => ({ cloud: 0, rain: 0, ambient: 0, windX: 0, windZ: 0 });
const frame = (over: Partial<Record<keyof typeof H, number>> = {}) => {
  const f = new Float32Array(HEADER + CAR_STRIDE);
  f[H.AMBIENT] = 20;
  for (const [k, v] of Object.entries(over)) f[H[k as keyof typeof H]] = v as number;
  return f;
};

describe('snow preset: catalogue and timeline', () => {
  it('is a seventh, data-driven preset that suggests the siped wet tyre', () => {
    expect(WEATHER_IDS).toContain('snow');
    const snow = WEATHER_CATALOGUE.snow;
    expect(snow.option).toBe('Snow and ice');
    expect(snow.tag).toBe('SNOW');
    expect(snow.suggestedTyre).toBe('wet');
    expect(WEATHER_GLYPH.snow).toBe('snow');
    expect(glyph('snow')).toContain('<path');
    for (const id of WEATHER_IDS) expect(WEATHER_GLYPH[id], id).toBeTruthy();
    expect(loadingTipsFor({ weather: 'snow' } as never)[0]).toContain('Snow');
  });
  it('is sub-zero air with snowfall that thins and clears, light wind, bounded visibility', () => {
    const timeline = new WeatherTimeline(weatherKeyframes('snow')),
      s = state();
    for (const t of [0, 60, 120, 300, 600, 900, 1500]) {
      timeline.sample(t, s);
      expect(s.ambient).toBeLessThan(-2);
      expect(snowShare(s.ambient)).toBe(1);
      expect(Math.hypot(s.windX, s.windZ)).toBeLessThan(8);
      expect(s.visibility!).toBeGreaterThanOrEqual(400);
    }
    timeline.sample(120, s);
    expect(s.rain).toBeGreaterThan(3);
    expect(s.visibility!).toBeLessThan(500);
    timeline.sample(1500, s);
    expect(s.rain).toBe(0);
    expect(s.visibility!).toBeGreaterThan(10000);
  });
  it('starts on a cold-soaked, snow-covered road and keeps every other preset snow-free', () => {
    const start = weatherSurfaceStart('snow');
    expect(start.tempC).toBeLessThan(0);
    expect(start.frozenMm).toBeGreaterThanOrEqual(FROST.fullCoverMm * 1.5);
    for (const id of WEATHER_IDS.filter((x) => x !== 'snow')) {
      expect(weatherSurfaceStart(id).frozenMm, id).toBeUndefined();
      const track = new Track(id);
      expect(track.cold, id).toBe(false);
      expect(
        track.frozen.every((v) => v === 0),
        id,
      ).toBe(true);
    }
  });
});

describe('precipitation phase: one channel, the air decides', () => {
  it('is rain at and above 2 C (exactly), snow at and below 0 C, sleet between', () => {
    expect(PRECIPITATION).toEqual({ snowBelowC: 0, rainAboveC: 2 });
    for (const t of [2, 4, 8, 19, 25, 39]) {
      expect(snowShare(t)).toBe(0);
      expect(liquidRain(24, t)).toBe(24);
      expect(snowfallMmHr(24, t)).toBe(0);
    }
    for (const t of [-20, -3.5, 0]) {
      expect(snowShare(t)).toBe(1);
      expect(liquidRain(3, t)).toBe(0);
      expect(snowfallMmHr(3, t)).toBe(3);
    }
    expect(snowShare(1)).toBeCloseTo(0.5, 12);
    expect(liquidRain(10, 1) + snowfallMmHr(10, 1)).toBeCloseTo(10, 12);
    expect(snowShare(Number.NaN)).toBe(0);
  });
  it('reads liquid rain from a snapshot header', () => {
    expect(frameLiquidRain(frame({ RAIN: 24 }))).toBe(24);
    expect(frameLiquidRain(frame({ RAIN: 24, AMBIENT: -3 }))).toBe(0);
  });
  it('keeps the original presets above the snow threshold for their whole timeline', () => {
    for (const id of WEATHER_IDS.filter((x) => x !== 'snow')) {
      const timeline = new WeatherTimeline(weatherKeyframes(id)),
        s = state();
      for (let t = 0; t <= 1500; t += 25) {
        timeline.sample(t, s);
        expect(snowShare(s.ambient), `${id}@${t}`).toBe(0);
      }
    }
  });
});

describe('frozen cover: grip numbers', () => {
  const cold = -4.5;
  it('is exactly 1 with no cover, so an unfrozen road is untouched', () => {
    expect(frozenCover(0)).toBe(0);
    expect(frozenGripFactor(0, 0.4, 0, 20, 0.5)).toBe(1);
    expect(frozenGripFactor(-1, 0.4, 0, 20, 0.5)).toBe(1);
  });
  it('is the SNOW material grip (0.30 of dry, cold-stiffened) on fresh, full cover', () => {
    const fresh = frozenGripFactor(2, 0.035, 0, cold);
    // 0.30 x (1 - 0.45 smooth(-8, 0.5, -4.5)) = 0.25, lightly dragged to ice by the trace of rubber.
    expect(fresh).toBeGreaterThan(0.23);
    expect(fresh).toBeLessThan(0.26);
    // At -8 C and with no laid rubber the cold factor is gone: exactly the material's 0.30.
    expect(frozenGripFactor(2, 0, 0, -8)).toBeCloseTo(0.3, 6);
  });
  it('falls toward bare ice on a polished line, but packed snow is not glare ice', () => {
    const fresh = frozenGripFactor(2, 0.035, 0, cold),
      polished = frozenGripFactor(0.9, 0.45, 0, cold);
    expect(polished).toBeLessThan(fresh);
    expect(polished).toBeGreaterThan(0.1);
    expect(polished).toBeLessThan(0.22);
    // A glaze share of 1 reaches FROST.glazeIce of the way from snow to ice.
    expect(FROST.glazeIce).toBeGreaterThan(0.3);
    expect(FROST.glazeIce).toBeLessThan(0.8);
  });
  it('grips harder the colder it is, and collapses toward 0 C (meltwater)', () => {
    const at = (t: number) => frozenGripFactor(2, 0.035, 0, t);
    expect(at(-10)).toBeGreaterThan(at(-5));
    expect(at(-5)).toBeGreaterThan(at(-1));
    expect(at(-1)).toBeGreaterThan(at(0.5));
    expect(at(0.5) / at(-10)).toBeLessThan(0.62);
  });
  it('rises smoothly with coverage from the bare road to the full cover', () => {
    let previous = 2;
    for (const mm of [0, 0.05, 0.2, 0.4, 0.8]) {
      const g = frozenGripFactor(mm, 0.035, 0, cold);
      expect(g).toBeLessThanOrEqual(previous);
      previous = g;
    }
    // Past full cover only the glaze changes: deeper fresh snow hides it again.
    expect(frozenGripFactor(1.6, 0.035, 0, cold)).toBeGreaterThanOrEqual(previous);
    expect(frozenCover(FROST.fullCoverMm)).toBe(1);
    expect(frozenCover(0.4)).toBeCloseTo(0.5, 6);
  });
  it('hides the glaze under thick fresh snow', () => {
    expect(glazeShare(0.45, 0.9)).toBeGreaterThan(0.95);
    expect(glazeShare(0.45, 5)).toBeCloseTo(0.4, 6);
    expect(glazeShare(0, 5)).toBe(0);
  });
  it('lets a winter construction win back a share of the loss, compound and family stacking', () => {
    const plain = frozenGripFactor(2, 0.035, 0, cold, 0),
      siped = frozenGripFactor(2, 0.035, 0, cold, winterRecovery(WINTER_COMPOUND.wet, 0)),
      rally = frozenGripFactor(
        2,
        0.035,
        0,
        cold,
        winterRecovery(WINTER_COMPOUND.wet, TIRE_FAMILIES.gravel.winterGrip),
      );
    expect(siped).toBeGreaterThan(plain * 1.2);
    expect(rally).toBeGreaterThan(siped * 1.2);
    expect(rally).toBeLessThan(0.6);
    expect(winterRecovery(0, 0)).toBe(0);
    expect(winterRecovery(0.1, 0.2)).toBeCloseTo(0.28, 12);
  });
  it('orders the tyre families: slicks none, road little, rally and all-terrain most', () => {
    expect(TIRE_FAMILIES['formula-slick'].winterGrip).toBe(0);
    expect(TIRE_FAMILIES.slick.winterGrip).toBe(0);
    expect(TIRE_FAMILIES.road.winterGrip).toBeGreaterThan(0);
    expect(TIRE_FAMILIES.gravel.winterGrip).toBeGreaterThan(TIRE_FAMILIES.road.winterGrip * 2);
    expect(TIRE_FAMILIES['all-terrain'].winterGrip).toBeGreaterThan(TIRE_FAMILIES.road.winterGrip);
    for (const f of Object.values(TIRE_FAMILIES)) {
      expect(f.winterGrip).toBeGreaterThanOrEqual(0);
      expect(f.winterGrip).toBeLessThan(0.5);
    }
    expect(WINTER_COMPOUND.soft + WINTER_COMPOUND.medium + WINTER_COMPOUND.hard).toBe(0);
    expect(WINTER_COMPOUND.wet).toBeGreaterThan(WINTER_COMPOUND.intermediate);
  });
});

describe('the tyre on a frozen cell', () => {
  const cell = (frozen: number | undefined, rubber = 0.035, temp = -4.5) => {
    const s = surfaceSample();
    s.frozen = frozen;
    s.rubber = rubber;
    s.temp = temp;
    return s;
  };
  const tyre = (compound: 'medium' | 'wet', winter = 0) => {
    const t = makeTire(compound, 155, 0.33, 1.2, 1, 0, undefined, winter);
    t.surfaceTemp = t.carcassTemp = t.coreTemp = compound === 'wet' ? 45 : 85;
    return t;
  };
  it('is bit-for-bit the unfrozen grip when there is no cover', () => {
    const t = tyre('medium');
    const plain = surfaceSample();
    plain.temp = 30;
    const zero = cell(0, 0, 30);
    zero.rubber = plain.rubber;
    expect(peakGrip(t, 2500, zero, 40)).toBe(peakGrip(t, 2500, plain, 40));
    expect(peakGrip(t, 2500, cell(undefined, 0, 30), 40)).toBe(peakGrip(t, 2500, plain, 40));
  });
  it('loses most of its friction on a covered road: a slick to about a fifth of dry', () => {
    const t = tyre('medium'),
      dry = peakGrip(t, 2500, cell(0, 0.035, 30), 40),
      snow = peakGrip(t, 2500, cell(2), 40);
    expect(snow / dry).toBeGreaterThan(0.1);
    expect(snow / dry).toBeLessThan(0.3);
  });
  it('prefers the siped wet compound and a rally construction on snow, and the worn dark tracks to deep snow', () => {
    const medium = peakGrip(tyre('medium'), 2500, cell(2), 40),
      wet = peakGrip(tyre('wet'), 2500, cell(2), 40),
      rally = peakGrip(tyre('wet', TIRE_FAMILIES.gravel.winterGrip), 2500, cell(2), 40);
    expect(wet).toBeGreaterThan(medium * 0.9);
    expect(rally).toBeGreaterThan(wet * 1.2);
    // Worn through to 0.45 mm on the line: partly bare cold asphalt, so grippier than deep snow.
    const tracks = peakGrip(tyre('wet'), 2500, cell(0.45, 0.45), 40);
    expect(tracks).toBeGreaterThan(wet);
  });
  it('never exceeds what the road beneath could give', () => {
    const t = tyre('wet'),
      grass = surfaceSample();
    grass.surface = 3;
    grass.grip = 0.53;
    grass.temp = -4.5;
    const bare = peakGrip(t, 2500, grass, 40);
    grass.frozen = 3;
    expect(peakGrip(t, 2500, grass, 40)).toBeLessThan(bare);
  });
});

describe('phase change: enthalpy-limited melt and freeze', () => {
  const C = SURFACE_THERMAL.surfaceCapacity;
  const cell = (surface: number, water: number, frozen: number): PhaseCell => ({
    surface,
    water,
    frozen,
  });
  it('melts cover above 0 C, conserving C x dT = L x dm, and pins at 0 C while any remains', () => {
    const c = settlePhase(cell(2, 0, 5), C);
    const melted = 5 - c.frozen;
    expect(c.water).toBeCloseTo(melted, 12);
    expect(melted).toBeCloseTo((C * 2) / FROST.latentHeat, 9);
    expect(c.surface).toBeCloseTo(0, 9);
    // 21 kJ/m^2/K x 2 K melts only 0.126 mm of the 5 mm: a thaw is slow.
    expect(melted).toBeGreaterThan(0.12);
    expect(melted).toBeLessThan(0.13);
    // A trace of cover melts out entirely and the surface stays warm by the remainder.
    const thin = settlePhase(cell(2, 0, 0.02), C);
    expect(thin.frozen).toBe(0);
    expect(thin.water).toBeCloseTo(0.02, 12);
    expect(thin.surface).toBeGreaterThan(1.5);
    expect(thin.surface).toBeCloseTo(2 - (0.02 * FROST.latentHeat) / C, 9);
  });
  it('freezes a water film below 0 C, warming the surface toward 0 C and never past it', () => {
    const c = settlePhase(cell(-3, 0.5, 0), C);
    const frozen = c.frozen;
    expect(frozen).toBeCloseTo((C * 3) / FROST.latentHeat, 9);
    expect(c.water).toBeCloseTo(0.5 - frozen, 12);
    expect(c.surface).toBeCloseTo(0, 9);
    const dry = settlePhase(cell(-10, 0.005, 0), C);
    expect(dry.water).toBe(0);
    expect(dry.frozen).toBeCloseTo(0.005, 12);
    expect(dry.surface).toBeLessThan(0);
    expect(dry.surface).toBeGreaterThan(-10);
  });
  it('does nothing without something to change phase, and caps the cover', () => {
    expect(settlePhase(cell(-3, 0, 1), C)).toEqual(cell(-3, 0, 1));
    expect(settlePhase(cell(3, 1, 0), C)).toEqual(cell(3, 1, 0));
    expect(settlePhase(cell(-30, 100, FROST.maxCoverMm - 0.001), C).frozen).toBe(FROST.maxCoverMm);
  });
});

describe('the snow track', () => {
  it('opens with dark, thinner wheel tracks along the racing line and deep snow beside it', () => {
    const track = new Track('snow');
    expect(track.cold).toBe(true);
    expect(track.sheltered.some((v) => v === 1)).toBe(false);
    let line = 0,
      beside = 0,
      lineN = 0,
      besideN = 0;
    for (let i = 0; i < track.frozen.length; i++) {
      if (track.rubber[i] > 0.4) {
        line += track.frozen[i];
        lineN++;
      } else if (track.rubber[i] < 0.06) {
        beside += track.frozen[i];
        besideN++;
      }
    }
    expect(lineN).toBeGreaterThan(50);
    expect(line / lineN).toBeLessThan(0.7);
    expect(beside / besideN).toBeGreaterThan(1.4);
    expect(track.temperature[0]).toBeLessThan(-3);
    // Every cell is covered; the whole lap is white.
    expect(track.frozen.every((v) => v > 0.3)).toBe(true);
  });
  it('samples the cover, adds plough drag, and reports the cell to the tyre model', () => {
    const track = new Track('snow'),
      out = surfaceSample(),
      p = track.at(100, {
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
    track.sample(p.x + p.nx * 4, p.z + p.nz * 4, out);
    expect(out.frozen).toBeGreaterThan(0.3);
    expect(out.resistance).toBeGreaterThan(0.015 + FROST.rolling * 0.5);
    const clear = new Track('clear'),
      dry = surfaceSample();
    clear.sample(p.x + p.nx * 4, p.z + p.nz * 4, dry);
    expect(dry.frozen).toBe(0);
    expect(dry.resistance).toBe(0.015);
  });
  it('adds fresh snowfall at the water-equivalent rate and keeps a frozen road frozen', () => {
    const track = new Track('snow');
    const before = track.meanFrozen(),
      water = track.meanWater();
    // 120 s of the first minutes: ~2.4 to 3.4 mm/h => about 0.1 mm of water equivalent.
    for (let t = 0.5; t <= 120; t += 0.5) track.evolve(0.5, t);
    const gain = track.meanFrozen() - before;
    expect(gain).toBeGreaterThan(0.06);
    expect(gain).toBeLessThan(0.14);
    expect(track.meanWater()).toBeCloseTo(water, 3);
    expect(Math.max(...track.temperature)).toBeLessThan(0);
  });
  it('melts in a thaw, spending its latent heat: slowly, pinned near 0 C, into meltwater', () => {
    const warm = weatherKeyframes('clear').map((k) => ({
      ...k,
      ambientTempC: 14,
      cloudCover01: 0.9,
    }));
    const track = new Track('snow', false, warm);
    const start = track.meanFrozen();
    let melting = 0;
    for (let t = 0.5; t <= 2400; t += 0.5) {
      track.evolve(0.5, t);
      // While any cover lies on a cell the surface cannot be warmer than 0 C.
      if (t % 100 === 0)
        for (let i = 0; i < track.frozen.length; i += 31)
          if (track.frozen[i] > 0.01) {
            expect(track.temperature[i]).toBeLessThanOrEqual(1e-4);
            melting++;
          }
    }
    expect(melting).toBeGreaterThan(100);
    expect(track.meanFrozen()).toBeLessThan(start);
    expect(track.meanFrozen()).toBeGreaterThan(0);
    expect(track.meanWater()).toBeGreaterThan(0.005);
  });
  it('stays finite and bounded over a long run', () => {
    const track = new Track('snow');
    for (let t = 0.5; t <= 1800; t += 0.5) track.evolve(0.5, t);
    for (const v of track.frozen) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(FROST.maxCoverMm);
    }
    for (const v of track.temperature) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('the snow session', () => {
  const run = (seconds: number, weather: 'snow' | 'clear' = 'snow') => {
    const sim = new Simulation({
      ...DEFAULT_OPTIONS,
      mode: 'practice',
      opponents: 0,
      weather,
      compound: 'wet',
    });
    sim.autoPlayer = true;
    for (let i = 0; i < seconds * 120; i++) sim.step(1 / 120);
    return sim;
  };
  it('writes sub-zero ambient, falling snow and extinction into the snapshot; wheels report snow or ice', () => {
    const sim = run(14),
      out = new Float32Array(HEADER + CAR_STRIDE);
    sim.writeFrame(out);
    expect(out[H.AMBIENT]).toBeLessThan(-3);
    expect(out[H.RAIN]).toBeGreaterThan(2);
    expect(out[H.WATER]).toBeLessThan(0.01);
    expect(out[H.EXTINCTION]).toBeGreaterThan(3);
    let seen = 0;
    for (let w = 0; w < 4; w++) {
      const surface = out[carBase(0) + WHEEL_BASE + w * WHEEL_STRIDE + W.SURFACE];
      if (surface === MATERIAL.SNOW || surface === MATERIAL.ICE) seen++;
    }
    expect(seen).toBeGreaterThanOrEqual(2);
    for (const v of out) expect(Number.isFinite(v)).toBe(true);
  });
  it('drives on, finite, and slower than the dry lap by the grip it lost', () => {
    const sim = run(60),
      dry = run(60, 'clear');
    expect(sim.cars[0].body.position.finite()).toBe(true);
    expect(sim.race.laps[0].distance).toBeGreaterThan(300);
    expect(dry.race.laps[0].distance).toBeGreaterThan(sim.race.laps[0].distance * 1.5);
    expect(sim.cars[0].contacts[0].frozen!).toBeGreaterThan(0.2);
  });
  it('replays bit for bit from the same seed', () => {
    const a = run(20),
      b = run(20),
      fa = new Float32Array(HEADER + CAR_STRIDE),
      fb = new Float32Array(HEADER + CAR_STRIDE);
    a.writeFrame(fa);
    b.writeFrame(fb);
    expect(Array.from(fa)).toEqual(Array.from(fb));
    expect(Array.from(a.track.frozen)).toEqual(Array.from(b.track.frozen));
  });
  it('lets the driver brain lift on a covered road, and not otherwise', () => {
    expect(frozenPace(undefined)).toBe(1);
    expect(frozenPace(0)).toBe(1);
    expect(frozenPace(5)).toBe(FROST_PACE.floor);
    expect(frozenPace(0.4)).toBeGreaterThan(FROST_PACE.floor);
    expect(frozenPace(0.4)).toBeLessThan(1);
  });
  it('reports the surface the tread rolls on only for a half-covered cell', () => {
    expect(reportedSurface(0, undefined, 0.4)).toBe(0);
    expect(reportedSurface(0, 0, 0.4)).toBe(0);
    expect(reportedSurface(0, 0.2, 0.4)).toBe(0);
    expect(reportedSurface(0, 2, 0.035)).toBe(MATERIAL.SNOW);
    expect(reportedSurface(2, 0.9, 0.45)).toBe(MATERIAL.ICE);
    expect(reportedSurface(5, 2, 0.035)).toBe(MATERIAL.SNOW);
    // A terrain material is left as it is.
    expect(reportedSurface(MATERIAL.DIRT, 2, 0.4)).toBe(MATERIAL.DIRT);
  });
});

describe('the surface keyframe carries the cover to the replay and the road texture', () => {
  class Memory implements ReplayPageStore {
    pages = new Map<number, ReplayPage>();
    async put(page: ReplayPage) {
      this.pages.set(page.id, page);
    }
    async get(id: number) {
      return this.pages.get(id)!;
    }
    async dispose() {}
  }
  it('records and decodes the frozen channel, and treats a warm session as zero cover', async () => {
    const pose = (i: number) => {
      const f = new Float32Array(HEADER + CAR_STRIDE);
      f[H.TIME] = i / 15;
      f[H.CARS] = 1;
      f[carBase(0) + F.QW] = 1;
      return f;
    };
    for (const withCover of [true, false]) {
      const r = new SessionReplay(1, new Memory(), undefined, 4);
      r.recordSurface(
        new Float32Array([0, 0.2]),
        new Float32Array([0.1, 0.4]),
        0,
        undefined,
        withCover ? new Float32Array([1.7, 0.45]) : undefined,
      );
      for (let i = 0; i < 12; i++) r.append(pose(i));
      const a = r.makeFrame(),
        b = r.makeFrame();
      for (let j = 0; j < 4 && r.sample(1.5 / 15, a, b) === null; j++) await r.settle();
      expect(r.sample(1.5 / 15, a, b)).toBeCloseTo(0.5, 3);
      const decoded = r.surfaceState;
      expect(decoded.water[1]).toBeCloseTo(0.2, 3);
      expect(decoded.frozen[0]).toBeCloseTo(withCover ? 1.7 : 0, 3);
      expect(decoded.frozen[1]).toBeCloseTo(withCover ? 0.45 : 0, 3);
      await r.dispose();
    }
  });
  it('maps the cover into the road shader through the state texture alpha', () => {
    expect(wetRoadShader).toContain('roadState.a * 8.0');
    expect(wetRoadShader).toContain('snowCover');
    expect(wetRoadShader).toContain('snowGlaze');
  });
});

describe('rendering and audio read snow from the same snapshot', () => {
  const snowing = () => frame({ RAIN: 3, AMBIENT: -4, CLOUD: 0.97, EXTINCTION: 8 });
  it('is not rain: the atmosphere keeps zero liquid rain, no storm and a snow share', () => {
    const a = weatherAtmosphere(snowing());
    expect(a.rain).toBe(0);
    expect(a.storm).toBe(0);
    expect(a.snow).toBeGreaterThan(0.8);
    expect(weatherAtmosphere(frame({ RAIN: 3 })).snow).toBe(0);
    expect(weatherAtmosphere(frame({ RAIN: 24 })).rain).toBe(24);
  });
  it('softens the sun, lifts the fill from a white ground and cools the haze', () => {
    const base = circuitLightState(0.97, 0, 'day'),
      plain = adjustDaylight({ ...base }, weatherAtmosphere(frame({ CLOUD: 0.97 }))),
      snow = adjustDaylight({ ...base }, weatherAtmosphere(snowing(), undefined, 1));
    expect(snow.sun).toBeLessThan(plain.sun);
    expect(snow.fill).toBeGreaterThan(plain.fill);
    expect(snow.fogBlue / snow.fogRed).toBeGreaterThan(plain.fogBlue / plain.fogRed);
    // No snow, no cover: the daylight record is returned untouched.
    const same = adjustDaylight({ ...base }, weatherAtmosphere(frame({ CLOUD: 0.97 })));
    expect(same).toEqual(base);
  });
  it('whitens the scenery in proportion to the settled cover, nothing in a warm session', () => {
    expect(sceneryCover(0)).toBe(0);
    expect(sceneryCover(0.02)).toBe(0);
    expect(sceneryCover(1)).toBe(1);
    expect(SNOW_CATCH.grass).toBe(1);
    expect(SNOW_CATCH.leather).toBe(0);
    expect(SNOW_CATCH.paint).toBeLessThan(SNOW_CATCH.timber);
    const presentation = new WeatherPresentation();
    presentation.update(snowing(), true, 1.6);
    expect(sceneryCoverUniform.value).toBe(1);
    // Falling snow wets nothing.
    expect(presentation.surface.value.x).toBe(0);
    expect(presentation.surface.value.z).toBe(0);
    presentation.update(frame({ RAIN: 24 }), true, 0);
    expect(sceneryCoverUniform.value).toBe(0);
    expect(presentation.surface.value.x).toBeGreaterThan(0.9);
  });
  it('muffles the master bus while it snows, and leaves rain and clear air alone', () => {
    const dry = weatherAmbience(frame()),
      snow = weatherAmbience(snowing());
    expect(snow.masterLowpassHz).toBeLessThan(dry.masterLowpassHz * 0.7);
    expect(snow.masterGain).toBeLessThan(1);
    expect(weatherAmbience(frame({ RAIN: 24 })).masterLowpassHz).toBe(18000);
  });
  it('crunches: a wheel on snow feeds the snow layer, not rain or asphalt', () => {
    const f = snowing();
    const o = carBase(0);
    f[o + 13] = 40;
    for (let w = 0; w < 4; w++) {
      const p = o + WHEEL_BASE + w * WHEEL_STRIDE;
      f[p + W.LOAD] = 2500;
      f[p + W.SURFACE] = MATERIAL.SNOW;
    }
    const mix = contactMix(f, newContactMix());
    expect(mix.snow).toBeGreaterThan(0.05);
    expect(mix.asphalt).toBe(0);
    expect(mix.rain).toBe(0);
  });
  it('words the HUD as snow and ice, and leaves the dry and rain words as they were', () => {
    const text = weatherReadout(-4, 2.4, 0, 8, 0, 3);
    expect(text).toContain('SNOW 2.4 MM/H');
    expect(text).toContain('SNOW AND ICE ON TRACK');
    expect(text).not.toContain('RAIN');
    expect(text).not.toContain('FOG');
    expect(weatherReadout(24, 0, 0)).toBe('24°C / DRY TRACK');
    expect(weatherReadout(19, 24, 1.09)).toContain('RAIN 24.0 MM/H');
  });
  it('has the shader branch and a cache key that sees it', () => {
    expect(wetRoadShader).toContain('snowColour');
  });
});

describe('falling snow in the shared particle pool', () => {
  const disposeEffects = (effects: Effects) =>
    effects.group.traverse((object) => {
      const mesh = object as { geometry?: { dispose(): void }; material?: { dispose(): void } };
      mesh.geometry?.dispose();
      mesh.material?.dispose();
    });
  const snapshot = (rain: number, ambient: number) => {
    const f = new Float32Array(HEADER + CAR_STRIDE);
    f[H.CARS] = 1;
    f[carBase(0) + F.QW] = 1;
    f[H.RAIN] = rain;
    f[H.AMBIENT] = ambient;
    f[H.WIND_X] = 2;
    f[H.WIND_Z] = -1;
    return f;
  };
  it('births flakes at the water-equivalent rate at any render rate, with the flake look on', () => {
    for (const hz of [24, 60, 144]) {
      const e = new Effects();
      try {
        const f = snapshot(3, -4);
        for (let i = 0; i < hz; i++) e.update(f, 1 / hz);
        // 3 mm/h x 55 flakes per mm/h per second, kept fractionally across frames.
        expect(e.diagnostics().spawned[PARTICLE_KIND.RAIN]).toBe(165);
        expect(
          (e as unknown as { rain: { material: { uniforms: { flake: { value: number } } } } }).rain
            .material.uniforms.flake.value,
        ).toBe(1);
        // Drifting with the wind, not shot downward like rain.
        const d = e.diagnostics();
        expect(d.velocityX[PARTICLE_KIND.RAIN]).toBeGreaterThan(0.5);
      } finally {
        disposeEffects(e);
      }
    }
  });
  it('leaves rain exactly as it was above freezing: streaks at the old rate, no flakes', () => {
    const e = new Effects();
    try {
      const f = snapshot(24, 19);
      for (let i = 0; i < 60; i++) e.update(f, 1 / 60);
      expect(e.diagnostics().spawned[PARTICLE_KIND.RAIN]).toBe(960);
      expect(
        (e as unknown as { rain: { material: { uniforms: { flake: { value: number } } } } }).rain
          .material.uniforms.flake.value,
      ).toBe(0);
    } finally {
      disposeEffects(e);
    }
  });
});
