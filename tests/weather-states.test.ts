import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { DEFAULT_OPTIONS, validateOptions, type WeatherPreset } from '../src/simulation/config.ts';
import {
  WEATHER_CATALOGUE,
  WEATHER_IDS,
  isWeatherId,
  weatherOptionsHtml,
} from '../src/simulation/weather-catalogue.ts';
import {
  CLEAR_VISIBILITY_M,
  CROSSWIND,
  DUST_FILM,
  KOSCHMIEDER,
  LIGHTNING,
  VISIBILITY_PACE,
  WeatherTimeline,
  crosswindForce,
  dustSettlingTarget,
  effectiveVisibilityM,
  gustEnvelope,
  lightningFlash,
  lightningIntensity,
  particulateExtinctionPerKm,
  settleDust,
  strikeInSlot,
  thunderLevel,
  trackVisibilityM,
  visibilityPace,
  weatherKeyframes,
  weatherSurfaceStart,
  windLoadFactor,
  type WeatherState,
} from '../src/simulation/weather.ts';
import { CELL_COLS, CELL_ROWS, Track, surfaceSample } from '../src/simulation/track.ts';
import { Simulation } from '../src/simulation/world.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';
import { DRS, DrsControl, type DrsContext } from '../src/simulation/drs.ts';
import { peakGrip } from '../src/simulation/tire.ts';
import { updateContamination } from '../src/simulation/contamination.ts';
import { CAR_STRIDE, H, HEADER } from '../src/simulation/protocol.ts';
import {
  adjustDaylight,
  skyVeil,
  tintLights,
  weatherAtmosphere,
  WEATHER_LOOK,
} from '../src/rendering/weather-atmosphere.ts';
import { aerialAmount, aerialExtinction } from '../src/rendering/studio/aerial-perspective.ts';
import { circuitLightState } from '../src/rendering/daylight.ts';
import { weatherAmbience } from '../src/audio/weather-ambience.ts';
import { airReadout, weatherReadout } from '../src/ui/presentation.ts';
import { WeatherPresentation, roadDustUniform } from '../src/rendering/weather-presentation.ts';
import wetRoadShader from '../src/shaders/wetRoad.frag?raw';

const NEW_STATES = ['fog', 'storm', 'dust'] as const;
const state = (): WeatherState => ({ cloud: 0, rain: 0, ambient: 0, windX: 0, windZ: 0 });
const sample = (preset: WeatherPreset, t: number) =>
  new WeatherTimeline(weatherKeyframes(preset)).sample(t, state());

describe('weather catalogue: one data table for every surface that names a preset', () => {
  it('lists six presets, the original three first, with unique ids and words', () => {
    expect(WEATHER_IDS.slice(0, 3)).toEqual(['clear', 'changeable', 'rain']);
    expect(WEATHER_IDS.length).toBeGreaterThanOrEqual(6);
    const options = WEATHER_IDS.map((id) => WEATHER_CATALOGUE[id].option);
    expect(new Set(options).size).toBe(WEATHER_IDS.length);
    for (const id of WEATHER_IDS) {
      expect(WEATHER_CATALOGUE[id].id).toBe(id);
      expect(WEATHER_CATALOGUE[id].brief.length).toBeGreaterThan(15);
    }
    // The original labels are unchanged (menu, loading line, event card).
    expect(WEATHER_CATALOGUE.clear.option).toBe('Clear / Dry');
    expect(WEATHER_CATALOGUE.changeable.option).toBe('Dry → Rain');
    expect(WEATHER_CATALOGUE.rain.option).toBe('Heavy rain');
    expect(WEATHER_CATALOGUE.rain.loading).toBe('Wet');
    expect(WEATHER_CATALOGUE.changeable.card).toBe('Dry, rain expected');
    expect(WEATHER_CATALOGUE.rain.suggestedTyre).toBe('wet');
    expect(WEATHER_CATALOGUE.clear.suggestedTyre).toBeNull();
  });
  it('builds the menu select options from the catalogue, in order', () => {
    const html = weatherOptionsHtml();
    const values = [...html.matchAll(/value="([^"]+)"/g)].map((m) => m[1]);
    expect(values).toEqual([...WEATHER_IDS]);
    expect(html).toContain('<option value="clear">Clear / Dry</option>');
    expect(html).toContain('<option value="fog">');
  });
  it('validates every preset through session options and falls back to clear', () => {
    for (const id of WEATHER_IDS)
      expect(validateOptions({ ...DEFAULT_OPTIONS, weather: id }).weather).toBe(id);
    expect(validateOptions({ ...DEFAULT_OPTIONS, weather: 'blizzard' }).weather).toBe('clear');
    expect(validateOptions({ ...DEFAULT_OPTIONS, weather: undefined }).weather).toBe('clear');
    expect(isWeatherId('fog')).toBe(true);
    expect(isWeatherId('toString')).toBe(false);
  });
  it('gives each preset a validated, finite timeline with the new channels in range', () => {
    for (const id of WEATHER_IDS) {
      const timeline = new WeatherTimeline(weatherKeyframes(id));
      const out = state();
      for (let t = 0; t <= 1800; t += 7.3) {
        timeline.sample(t, out);
        for (const v of Object.values(out)) expect(Number.isFinite(v)).toBe(true);
        expect(out.rain).toBeGreaterThanOrEqual(0);
        expect(Math.hypot(out.windX, out.windZ)).toBeLessThanOrEqual(40);
        expect(out.visibility!).toBeGreaterThanOrEqual(20);
        expect(out.dust!).toBeGreaterThanOrEqual(0);
        expect(out.dust!).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('the original presets are unchanged by the atmosphere channels', () => {
  it('keeps clear, rain and changeable in clear air with no gust, dust or dew', () => {
    for (const id of ['clear', 'changeable', 'rain'] as const) {
      const timeline = new WeatherTimeline(weatherKeyframes(id)),
        out = state();
      for (let t = 0; t <= 1000; t += 11) {
        timeline.sample(t, out);
        expect(out.visibility).toBe(CLEAR_VISIBILITY_M);
        expect(out.gust).toBe(0);
        expect(out.dust).toBe(0);
        expect(out.moisture).toBe(0);
        expect(particulateExtinctionPerKm(out.visibility!)).toBe(0);
      }
    }
    const rain = sample('rain', 123);
    expect(rain).toMatchObject({ rain: 24, cloud: 0.95, ambient: 19 });
    expect(Math.hypot(rain.windX, rain.windZ)).toBeCloseTo(Math.hypot(1.5, 0.6), 12);
    expect(sample('clear', 5)).toMatchObject({ rain: 0, cloud: 0.12, ambient: 24 });
    expect(sample('changeable', 180).rain).toBe(36);
  });
  it('writes exactly zero in the two new snapshot channels for the original presets', () => {
    expect(HEADER).toBe(24);
    expect(H.EXTINCTION).toBeLessThan(HEADER);
    expect(H.DUST).toBeLessThan(HEADER);
    expect(H.EXTINCTION).not.toBe(H.DUST);
    for (const weather of ['clear', 'changeable', 'rain'] as const) {
      const sim = new Simulation({ ...DEFAULT_OPTIONS, opponents: 0, mode: 'practice', weather });
      sim.track.evolve(0.5, 150);
      const frame = new Float32Array(HEADER + CAR_STRIDE);
      sim.writeFrame(frame);
      expect(frame[H.EXTINCTION]).toBe(0);
      expect(frame[H.DUST]).toBe(0);
    }
  });
  it('leaves the marble field alone and the surface start exactly as before', () => {
    const clear = new Track('clear');
    expect(weatherSurfaceStart('clear')).toEqual({ tempC: 34, waterMm: 0, waterVariationMm: 0 });
    expect(weatherSurfaceStart('rain')).toEqual({
      tempC: 22,
      waterMm: 0.7,
      waterVariationMm: 0.35,
    });
    expect(clear.temperature[100]).toBe(34);
    const rain = new Track('rain');
    expect(rain.water[40]).toBeCloseTo(0.7 + 0.35 * (0.5 + 0.5 * Math.sin(40 * 0.27)), 6);
    for (let t = 0.5; t <= 60; t += 0.5) clear.evolve(0.5, t);
    expect(Math.max(...clear.marbles)).toBe(0);
  });
});

describe('visibility: Koschmieder extinction shared by renderer, HUD and drivers', () => {
  it('is 3.912 / V per km above clear air and exactly 0 at the clear-air range', () => {
    expect(KOSCHMIEDER).toBeCloseTo(Math.log(50), 3);
    expect(particulateExtinctionPerKm(CLEAR_VISIBILITY_M)).toBe(0);
    expect(particulateExtinctionPerKm(50000)).toBe(0);
    expect(particulateExtinctionPerKm(110)).toBeCloseTo(3.912 / 0.11 - 3.912 / 30, 6);
    expect(() => particulateExtinctionPerKm(0)).toThrow();
    expect(() => particulateExtinctionPerKm(NaN)).toThrow();
  });
  it('round-trips through the effective visibility a driver sees, rain included', () => {
    for (const v of [60, 110, 170, 900, 4200])
      expect(effectiveVisibilityM(particulateExtinctionPerKm(v))).toBeCloseTo(v, 4);
    expect(effectiveVisibilityM(0)).toBeCloseTo(CLEAR_VISIBILITY_M, 0);
    // 24 mm/h of rain alone leaves about 2.4 km; a 60 mm/h cell about 1 km.
    expect(effectiveVisibilityM(0, 24)).toBeGreaterThan(2200);
    expect(effectiveVisibilityM(0, 24)).toBeLessThan(2600);
    expect(effectiveVisibilityM(0, 60)).toBeGreaterThan(900);
    expect(effectiveVisibilityM(0, 60)).toBeLessThan(1150);
    // Fog and rain extinguish together: shorter than either alone.
    expect(effectiveVisibilityM(particulateExtinctionPerKm(200), 24)).toBeLessThan(200);
  });
  it('lifts the fog log-linearly and monotonically over the session', () => {
    const timeline = new WeatherTimeline(weatherKeyframes('fog')),
      out = state();
    let previous = 0;
    for (let t = 0; t <= 1600; t += 10) {
      const v = timeline.sample(t, out).visibility!;
      expect(v).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = v;
    }
    expect(timeline.sample(0, out).visibility).toBeCloseTo(110, 9);
    expect(timeline.sample(0, out).ambient).toBeLessThan(10);
    expect(timeline.sample(1600, out).visibility).toBeGreaterThan(15000);
    // Midway between two keyframes the (smoothed) log-domain value sits between.
    const v = timeline.sample(300, out).visibility!;
    expect(v).toBeGreaterThan(130);
    expect(v).toBeLessThan(280);
    // 110 m is dense: 35 per km of extra extinction, 9.5 m of view lost per metre driven at 250 km/h.
    expect(particulateExtinctionPerKm(110)).toBeGreaterThan(35);
  });
  it('slows drivers smoothly with the view, and not at all in clear air or rain', () => {
    expect(visibilityPace(CLEAR_VISIBILITY_M)).toBe(1);
    expect(visibilityPace(VISIBILITY_PACE.far)).toBe(1);
    expect(visibilityPace(2400)).toBe(1);
    expect(visibilityPace(VISIBILITY_PACE.near)).toBeCloseTo(VISIBILITY_PACE.floor, 12);
    expect(visibilityPace(10)).toBeCloseTo(VISIBILITY_PACE.floor, 12);
    let previous = 0;
    for (let v = 20; v <= 800; v += 20) {
      const p = visibilityPace(v);
      expect(p).toBeGreaterThanOrEqual(previous);
      previous = p;
    }
    expect(visibilityPace(110)).toBeLessThan(0.9);
    expect(visibilityPace(250)).toBeGreaterThan(0.9);
    expect(visibilityPace(250)).toBeLessThan(0.95);
    expect(() => visibilityPace(NaN)).toThrow();
    expect(trackVisibilityM({ visibility: CLEAR_VISIBILITY_M, rain: 24 })).toBeGreaterThan(600);
  });
});

describe('wind gusts', () => {
  it('has a bounded, deterministic, seekable envelope with real lulls and surges', () => {
    let low = 1,
      high = 0;
    for (let t = 0; t < 600; t += 0.25) {
      const g = gustEnvelope(t);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(1);
      low = Math.min(low, g);
      high = Math.max(high, g);
    }
    expect(low).toBe(0);
    expect(high).toBeGreaterThan(0.95);
    // Out-of-order sampling gives identical values (replays rewind).
    const forward = [10.5, 33.25, 71, 5.5].map(gustEnvelope);
    const back = [5.5, 71, 33.25, 10.5].map(gustEnvelope).reverse();
    expect(forward).toEqual(back);
    expect(() => gustEnvelope(Infinity)).toThrow();
  });
  it('adds the gust to the mean wind, veers it, and stays inside 40 m/s', () => {
    const timeline = new WeatherTimeline(weatherKeyframes('storm')),
      out = state();
    let fastest = 0,
      slowest = Infinity,
      maxGust = 0;
    const directions = new Set<number>();
    for (let t = 120; t < 420; t += 0.5) {
      timeline.sample(t, out);
      const speed = Math.hypot(out.windX, out.windZ);
      fastest = Math.max(fastest, speed);
      slowest = Math.min(slowest, speed);
      maxGust = Math.max(maxGust, out.gust!);
      directions.add(Math.round(Math.atan2(out.windX, out.windZ) * 20));
    }
    expect(fastest).toBeLessThanOrEqual(40);
    // Mean ~9.5-10 m/s, gusting 9-10 more: lulls near the mean, peaks near 19-20 m/s.
    expect(slowest).toBeGreaterThan(8.5);
    expect(slowest).toBeLessThan(11);
    expect(fastest).toBeGreaterThan(17);
    expect(maxGust).toBeGreaterThan(8);
    expect(directions.size).toBeGreaterThan(4);
    // The same time always gives the same wind.
    expect(timeline.sample(200.1, state())).toEqual(timeline.sample(200.1, state()));
  });
});

describe('crosswind loading of the bodywork', () => {
  it('is exactly zero in the original presets (<= 4.5 m/s) and full from 7 m/s', () => {
    for (const w of [0, 1.6, 4.2, 4.5]) expect(windLoadFactor(w)).toBe(0);
    expect(windLoadFactor(7)).toBe(1);
    expect(windLoadFactor(30)).toBe(1);
    expect(windLoadFactor(5.75)).toBeCloseTo(0.5, 12);
    expect(windLoadFactor(NaN)).toBe(0);
    const peakOriginal = Math.max(
      ...[0, 60, 120, 180, 300, 600, 900].map((t) => {
        const s = sample('changeable', t);
        return Math.hypot(s.windX, s.windZ);
      }),
    );
    expect(windLoadFactor(peakOriginal)).toBe(0);
  });
  it('puts about 0.2 g on a Formula car at 70 m/s in a 12 m/s crosswind', () => {
    const force = crosswindForce(70, 12, 0.38, 2.5, 1);
    // 1/2 rho |V| (0.55 x 3.8 m^2/rad) w = 1/2 x 1.225 x 70 x 2.09 x 12 = ~1.08 kN.
    expect(force).toBeGreaterThan(900);
    expect(force).toBeLessThan(1300);
    expect(force / (770 * 9.81)).toBeGreaterThan(0.12);
    expect(force / (770 * 9.81)).toBeLessThan(0.17);
    expect(crosswindForce(70, -12, 0.38, 2.5, 1)).toBeCloseTo(-force, 9);
    expect(crosswindForce(70, 12, 0.38, 2.5, 0)).toBe(0);
    expect(CROSSWIND.sideSlope).toBeGreaterThan(0);
  });
  it('pushes a real car sideways in a storm gust and does nothing in a breeze', () => {
    const drift = (windSideways: number) => {
      const track = new Track('clear', true),
        car = new Vehicle(0);
      car.place(track, 200, 0);
      const right = { x: -car.forward.z, z: car.forward.x };
      car.body.velocity.copy(car.forward).scale(60);
      for (const tire of car.tires) tire.omega = 60 / 0.33;
      // A crosswind blowing toward the car's side (body +X is the driver's left).
      track.windX = right.x * windSideways;
      track.windZ = right.z * windSideways;
      for (let i = 0; i < 160; i++) car.step(1 / 240, track);
      return car.body.velocity.x * right.x + car.body.velocity.z * right.z;
    };
    const calm = drift(0),
      breeze = drift(4.2),
      storm = drift(14),
      opposite = drift(-14);
    // Below the knee the new force is exactly zero; the old drag-direction effect remains.
    expect(Math.abs(breeze - calm)).toBeLessThan(0.05);
    // The tyres resist most of it, but 0.7 s of a 14 m/s gust still moves the car
    // about half a metre per second toward the wind, and the reverse gust the other way.
    expect(storm - calm).toBeGreaterThan(0.2);
    expect(opposite - calm).toBeLessThan(-0.2);
  });
});

describe('dust: a loose film on the open tarmac, thinner on the rubbered line', () => {
  it('settles toward a bounded target that needs dusty air and thins with distance', () => {
    expect(dustSettlingTarget(0, 170, 0)).toBe(0);
    expect(dustSettlingTarget(1, CLEAR_VISIBILITY_M, 0)).toBe(0);
    const dense = dustSettlingTarget(1, 170, 0);
    expect(dense).toBeCloseTo(DUST_FILM.maxCoverage, 6);
    expect(dustSettlingTarget(1, 700, 0)).toBeLessThan(dense * 0.6);
    expect(dustSettlingTarget(1, 2500, 0)).toBeLessThan(dense * 0.1);
    // The laid rubber line sheds 60 % of it at full coverage.
    expect(dustSettlingTarget(1, 170, 0.45)).toBeCloseTo(dense * (1 - DUST_FILM.lineSweep), 6);
    // Half the dust share, half the dust in the air: a thinner film.
    expect(dustSettlingTarget(0.5, 170, 0)).toBeLessThan(dense * 0.7);
    expect(() => dustSettlingTarget(NaN, 170, 0)).toThrow();
  });
  it('relaxes exactly, monotonically and independently of the step size', () => {
    let many = 0;
    for (let i = 0; i < 100; i++) many = settleDust(many, 0.09, 0.5, 8);
    expect(many).toBeCloseTo(settleDust(0, 0.09, 50, 8), 9);
    expect(settleDust(0, 0.09, 1e6, 8)).toBeCloseTo(0.09, 12);
    expect(settleDust(0.05, 0.09, 0, 8)).toBe(0.05);
    expect(settleDust(0.05, 0.09, 10, 8)).toBeGreaterThan(0.05);
    expect(settleDust(0.05, 0.09, 10, 8)).toBeLessThan(0.09);
    // Blow-off is faster in a strong wind than in a light one.
    expect(settleDust(0.09, 0, 30, 14)).toBeLessThan(settleDust(0.09, 0, 30, 2));
    expect(() => settleDust(0, 0, -1, 0)).toThrow();
  });
  it('lays the film on the open road at the lights and costs a slick measured grip', () => {
    const dust = new Track('dust'),
      clear = new Track('clear');
    const open = (track: Track) => {
      let sum = 0,
        n = 0;
      for (let r = 0; r < CELL_ROWS; r++) {
        if (track.sheltered[r]) continue;
        for (let c = 0; c < CELL_COLS; c++) {
          sum += track.marbles[r * CELL_COLS + c];
          n++;
        }
      }
      return sum / n;
    };
    expect(open(clear)).toBe(0);
    expect(open(dust)).toBeGreaterThan(0.02);
    expect(open(dust)).toBeLessThanOrEqual(DUST_FILM.maxCoverage);
    // Cells on the laid rubber line carry less film than the cells off it.
    let lineCell = 0,
      edgeCell = 0;
    for (let i = 0; i < dust.rubber.length; i++) {
      if (dust.rubber[i] > dust.rubber[lineCell]) lineCell = i;
      if (dust.rubber[i] < dust.rubber[edgeCell]) edgeCell = i;
    }
    expect(dust.marbles[lineCell]).toBeLessThan(dust.marbles[edgeCell]);
    // A tyre driven 6 s at 60 m/s over the settled film picks it up (the same
    // contamination model as marbles) and loses grip against clean tarmac.
    const grip = (track: Track, cell: number) => {
      const tyre = new Vehicle(0).tires[0],
        s = surfaceSample();
      s.grip = 1;
      s.water = 0;
      s.rubber = track.rubber[cell];
      s.marbles = track.marbles[cell];
      s.temp = 40;
      for (let i = 0; i < 720; i++) updateContamination(tyre, s, 2500, 60, 180, 1 / 120);
      return peakGrip(tyre, 2500, s, 60);
    };
    const loss = 1 - grip(dust, edgeCell) / grip(clear, edgeCell);
    expect(loss).toBeGreaterThan(0.03);
    expect(loss).toBeLessThan(0.2);
  });
  it('keeps settling while the storm blows and clears the film as the air clears', () => {
    const track = new Track('dust');
    const mean = () => track.marbles.reduce((a, b) => a + b, 0) / track.marbles.length;
    const start = mean();
    for (let t = 0.5; t <= 400; t += 0.5) track.evolve(0.5, t);
    expect(mean()).toBeGreaterThan(start * 0.7);
    for (let t = 400.5; t <= 1700; t += 0.5) track.evolve(0.5, t);
    // At t = 1100 s the visibility is 2.5 km: the film has largely blown off.
    expect(mean()).toBeLessThan(start * 0.5);
    for (const m of track.marbles) expect(Number.isFinite(m) && m >= 0 && m <= 1).toBe(true);
  });
});

describe('fog: cold air and a damp film', () => {
  it('holds a thin film, cold surface and slow tyre warm-up that costs a slick grip', () => {
    const fog = new Track('fog'),
      clear = new Track('clear');
    expect(weatherSurfaceStart('fog').tempC).toBeLessThan(10);
    for (let t = 0.5; t <= 600; t += 0.5) fog.evolve(0.5, t);
    const water = fog.meanWater();
    // ~0.3 mm/h of fog drip against the drains: a few hundredths of a millimetre.
    expect(water).toBeGreaterThan(0.01);
    expect(water).toBeLessThan(0.08);
    expect(clear.meanWater()).toBe(0);
    expect(Math.max(...fog.temperature)).toBeLessThan(20);
    // The same tyre on that film loses a measurable part of its dry grip.
    const tyre = new Vehicle(0).tires[0];
    const grip = (waterMm: number) => {
      const s = surfaceSample();
      s.grip = 1;
      s.water = waterMm;
      s.temp = 10;
      tyre.surfaceTemp = tyre.carcassTemp = 92;
      return peakGrip(tyre, 2500, s, 60);
    };
    const loss = 1 - grip(water) / grip(0);
    expect(loss).toBeGreaterThan(0.08);
    expect(loss).toBeLessThan(0.3);
    // No rain is falling: the readout says damp, not raining.
    expect(fog.rain).toBe(0);
  });
  it('is reported in the snapshot as visibility, with no dust share', () => {
    const sim = new Simulation({
      ...DEFAULT_OPTIONS,
      opponents: 0,
      mode: 'practice',
      weather: 'fog',
    });
    sim.track.evolve(0.5, 0.5);
    const frame = new Float32Array(HEADER + CAR_STRIDE);
    sim.writeFrame(frame);
    expect(frame[H.EXTINCTION]).toBeGreaterThan(30);
    expect(frame[H.DUST]).toBe(0);
    expect(frame[H.RAIN]).toBe(0);
    expect(frame[H.AMBIENT]).toBeLessThan(10);
    const dust = new Simulation({
      ...DEFAULT_OPTIONS,
      opponents: 0,
      mode: 'practice',
      weather: 'dust',
    });
    dust.writeFrame(frame);
    expect(frame[H.DUST]).toBe(1);
    expect(frame[H.EXTINCTION]).toBeGreaterThan(1);
  });
});

describe('storm: heavy rain with lightning', () => {
  it('is a stronger cell than the heavy-rain preset, with deeper standing water', () => {
    const storm = sample('storm', 100),
      rain = sample('rain', 100);
    expect(storm.rain).toBeGreaterThan(rain.rain * 2.5);
    expect(storm.cloud).toBe(1);
    const wet = new Track('storm'),
      heavy = new Track('rain');
    for (let t = 0.5; t <= 180; t += 0.5) {
      wet.evolve(0.5, t);
      heavy.evolve(0.5, t);
    }
    expect(wet.meanWater()).toBeGreaterThan(heavy.meanWater() * 1.3);
  });
  it('schedules lightning only in violent rain, deterministically', () => {
    expect(lightningIntensity(0)).toBe(0);
    expect(lightningIntensity(24)).toBe(0);
    expect(lightningIntensity(36)).toBe(0);
    expect(lightningIntensity(40)).toBe(0);
    expect(lightningIntensity(58)).toBe(1);
    expect(lightningIntensity(76)).toBe(1);
    expect(lightningIntensity(NaN)).toBe(0);
    for (let t = 0; t < 300; t += 0.37) {
      expect(lightningFlash(t, 0)).toBe(0);
      expect(thunderLevel(t, 0)).toBe(0);
    }
    let strikes = 0;
    for (let slot = 0; slot < 400; slot++) {
      const a = strikeInSlot(slot, 1),
        b = strikeInSlot(slot, 1);
      expect(a).toEqual(b);
      if (!a) continue;
      strikes++;
      expect(a.timeSec).toBeGreaterThanOrEqual(slot * LIGHTNING.slotSec);
      expect(a.timeSec).toBeLessThan((slot + 1) * LIGHTNING.slotSec);
      expect(a.distanceM).toBeGreaterThanOrEqual(LIGHTNING.minDistanceM);
      expect(a.distanceM).toBeLessThanOrEqual(LIGHTNING.maxDistanceM);
    }
    // ~72 % of the 6.5 s slots: a strike roughly every 9 s at full intensity.
    expect(strikes / 400).toBeGreaterThan(0.6);
    expect(strikes / 400).toBeLessThan(0.85);
    expect(
      strikeInSlot(5, 0.001) === null || typeof strikeInSlot(5, 0.001)!.timeSec === 'number',
    ).toBe(true);
  });
  it('flashes at the strike and rumbles after the speed-of-sound delay', () => {
    let slot = 0;
    while (!strikeInSlot(slot, 1)) slot++;
    const strike = strikeInSlot(slot, 1)!;
    expect(lightningFlash(strike.timeSec - 0.05, 1)).toBeLessThan(
      0.2 + lightningFlash(strike.timeSec - 6.4, 1),
    );
    expect(lightningFlash(strike.timeSec + 0.005, 1)).toBeGreaterThan(0.25);
    expect(lightningFlash(strike.timeSec + 1.5, 1)).toBeLessThan(
      0.02 + lightningFlash(strike.timeSec - 6, 1),
    );
    for (let t = 0; t < 120; t += 0.02) {
      const f = lightningFlash(t, 1);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
      const th = thunderLevel(t, 1);
      expect(th).toBeGreaterThanOrEqual(0);
      expect(th).toBeLessThanOrEqual(1);
    }
    const arrival = strike.timeSec + strike.distanceM / LIGHTNING.speedOfSound;
    // The rumble is measured at the strike's own arrival, over earlier strikes' tails.
    expect(thunderLevel(arrival + 0.4, 1)).toBeGreaterThan(0.05);
    expect(thunderLevel(strike.timeSec + 0.1, 1)).toBeLessThan(
      thunderLevel(arrival + 0.4, 1) + 1e-9,
    );
  });
});

describe('race control and drivers respond to the view', () => {
  const context = (over: Partial<DrsContext> = {}): DrsContext => ({
    racing: true,
    leaderLaps: 5,
    water: 0,
    neutralised: false,
    yellow: () => false,
    ...over,
  });
  it('locks the DRS flap out below 250 m of visibility and leaves clear air alone', () => {
    const drs = new DrsControl([], 1000, 1, [0]);
    drs.update(0.1, 10, [], context());
    expect(drs.enabled).toBe(true);
    drs.update(0.1, 10, [], context({ visibility: 30000 }));
    expect(drs.enabled).toBe(true);
    drs.update(0.1, 10, [], context({ visibility: 249 }));
    expect(drs.enabled).toBe(false);
    drs.update(0.1, 10, [], context({ visibility: 251 }));
    expect(drs.enabled).toBe(true);
    drs.update(0.1, 10, [], context({ water: DRS.wetLimit + 0.01 }));
    expect(drs.enabled).toBe(false);
  });
  it('has the AI lift in fog and dust but not in clear air or ordinary rain', () => {
    const pace = (weather: WeatherPreset, t = 0, compound: 'medium' | 'wet' = 'medium') => {
      const sim = new Simulation({ ...DEFAULT_OPTIONS, opponents: 1, weather, seed: 5, compound });
      sim.track.evolve(0.5, t + 0.5);
      const driver = sim.ai[1];
      driver.brain.update(0.5, sim.cars[1], sim.cars, sim.track, sim.race);
      return driver.brain.pace;
    };
    const clear = pace('clear'),
      rain = pace('rain', 0, 'wet'),
      fog = pace('fog'),
      dust = pace('dust', 150),
      lifted = pace('fog', 1500);
    expect(clear).toBeGreaterThan(0.97);
    expect(rain).toBeGreaterThan(0.9);
    expect(fog).toBeLessThan(clear * 0.92);
    expect(dust).toBeLessThan(clear * 0.93);
    expect(lifted).toBeGreaterThan(fog + 0.1);
  });
});

describe('atmosphere rendering state (pure functions of the presented snapshot)', () => {
  const frame = (over: Partial<Record<keyof typeof H, number>> = {}) => {
    const f = new Float32Array(HEADER + CAR_STRIDE);
    for (const [k, v] of Object.entries(over)) f[H[k as keyof typeof H]] = v as number;
    return f;
  };
  const daylight = () => circuitLightState(0.7, 0, 'day');
  it('is the identity in clear air and ordinary rain', () => {
    for (const f of [frame(), frame({ RAIN: 24, CLOUD: 0.95 }), frame({ RAIN: 36 })]) {
      const air = weatherAtmosphere(f);
      expect(air.fog + air.dustAmount + air.storm).toBe(0);
      expect(air.sunScale).toBe(1);
      expect(air.exposureScale).toBe(1);
      const before = { ...daylight() },
        after = adjustDaylight(daylight(), air);
      expect(after).toEqual(before);
      const sun = { color: new T.Color(0.9, 0.8, 0.7) },
        hemisphere = { color: new T.Color(0.4, 0.5, 0.6) },
        sunBefore = sun.color.toArray(),
        skyBefore = hemisphere.color.toArray();
      tintLights(sun, hemisphere, air);
      expect(sun.color.toArray()).toEqual(sunBefore);
      expect(hemisphere.color.toArray()).toEqual(skyBefore);
      expect(skyVeil(air, 0.4, 0.5, 0.6).w).toBe(0);
    }
  });
  it('treats missing or corrupt channels (older recordings) as clear air', () => {
    const bad = frame();
    bad[H.EXTINCTION] = NaN;
    bad[H.DUST] = Infinity;
    const air = weatherAtmosphere(bad);
    expect(air.extinctionPerKm).toBe(0);
    expect(air.visibilityM).toBeGreaterThan(29000);
  });
  it('smothers the sun and veils the dome in dense fog, hazing the unlit fallback', () => {
    const air = weatherAtmosphere(
      frame({ EXTINCTION: particulateExtinctionPerKm(110), CLOUD: 0.82 }),
    );
    expect(air.fog).toBeCloseTo(1, 6);
    expect(air.dustAmount).toBe(0);
    expect(air.visibilityM).toBeCloseTo(110, 3);
    expect(air.sunScale).toBeCloseTo(WEATHER_LOOK.fog.sun, 6);
    expect(air.fillScale).toBeGreaterThan(1.3);
    const light = adjustDaylight(daylight(), air),
      base = daylight();
    expect(light.sun).toBeLessThan(base.sun * 0.5);
    expect(light.fill).toBeGreaterThan(base.fill);
    // The unlit FogExp2 reaches ~98 % at the visibility: (d V)^2 = 3.912.
    expect(light.fogDensity).toBeGreaterThan(0.017);
    expect(1 - Math.exp(-((light.fogDensity * 110) ** 2))).toBeGreaterThan(0.97);
    const veil = skyVeil(air, base.fogRed, base.fogGreen, base.fogBlue);
    expect(veil.w).toBeGreaterThan(0.85);
    expect(veil.x).toBeCloseTo(base.fogRed, 6);
  });
  it('turns the light, haze and veil amber under dust and darkens a storm deck', () => {
    const dust = weatherAtmosphere(
      frame({ EXTINCTION: particulateExtinctionPerKm(170), DUST: 1, CLOUD: 0.55 }),
    );
    expect(dust.dustAmount).toBeCloseTo(1, 6);
    expect(dust.fog).toBe(0);
    const base = daylight(),
      light = adjustDaylight(daylight(), dust);
    expect(light.sun).toBeLessThan(base.sun * 0.2);
    expect(light.fogRed).toBeGreaterThan(light.fogGreen);
    expect(light.fogGreen).toBeGreaterThan(light.fogBlue);
    expect(base.fogBlue).toBeGreaterThan(base.fogRed * 0.9);
    const sun = { color: new T.Color(1, 1, 1) },
      hemisphere = { color: new T.Color(0.5, 0.6, 0.7) };
    tintLights(sun, hemisphere, dust);
    expect(sun.color.r).toBeGreaterThan(sun.color.g);
    expect(sun.color.g).toBeGreaterThan(sun.color.b);
    const storm = weatherAtmosphere(frame({ RAIN: 70, CLOUD: 1, TIME: 12 }));
    expect(storm.storm).toBe(1);
    const dark = adjustDaylight(daylight(), storm);
    expect(dark.exposure).toBeLessThan(daylight().exposure * 0.9);
    const veil = skyVeil(storm, 0.3, 0.3, 0.3);
    expect(veil.w).toBeGreaterThan(0.5);
    expect(veil.x).toBeLessThan(0.1);
  });
  it('adds a lightning flash to the lights only while the flash lasts', () => {
    let slot = 0;
    while (!strikeInSlot(slot, 1)) slot++;
    const strike = strikeInSlot(slot, 1)!;
    const during = weatherAtmosphere(frame({ RAIN: 70, TIME: strike.timeSec + 0.005 }));
    const quiet = weatherAtmosphere(frame({ RAIN: 70, TIME: strike.timeSec - 0.2 }));
    expect(during.flash).toBeGreaterThan(0.25);
    const lit = adjustDaylight(daylight(), during),
      dim = adjustDaylight(daylight(), quiet);
    expect(lit.fill).toBeGreaterThan(dim.fill);
    expect(lit.environment).toBeGreaterThan(dim.environment);
  });
  it('extinguishes by the Beer-Lambert law, greying for fog and tanning for dust', () => {
    const clearAir = aerialExtinction(18),
      fog = aerialExtinction(18, 0, new T.Vector3(), 35.5, 0),
      dust = aerialExtinction(18, 0, new T.Vector3(), 20, 1);
    expect(aerialExtinction(18, 0, new T.Vector3(), 0, 0).toArray()).toEqual(clearAir.toArray());
    // 110 m of fog: green channel ~0.0356 / m on top of the clear air.
    expect(fog.y - clearAir.y).toBeCloseTo(0.0355, 6);
    expect(fog.x - clearAir.x).toBeCloseTo(fog.z - clearAir.z, 12);
    expect(dust.z - clearAir.z).toBeGreaterThan(dust.y - clearAir.y);
    expect(dust.y - clearAir.y).toBeGreaterThan(dust.x - clearAir.x);
    const camera = new T.Vector3(0, 1.5, 0);
    const at = (d: number, e: T.Vector3) => aerialAmount(camera, new T.Vector3(0, 1.5, d), e.y);
    expect(
      at(110, aerialExtinction(18, 0, new T.Vector3(), particulateExtinctionPerKm(110), 0)),
    ).toBeGreaterThan(0.95);
    expect(at(110, clearAir)).toBeLessThan(0.02);
    expect(() => aerialExtinction(18, 0, new T.Vector3(), -1, 0)).toThrow();
  });
});

describe('weather ambience and HUD words', () => {
  const frame = (over: Partial<Record<keyof typeof H, number>> = {}) => {
    const f = new Float32Array(HEADER + CAR_STRIDE);
    for (const [k, v] of Object.entries(over)) f[H[k as keyof typeof H]] = v as number;
    return f;
  };
  it('is silent in clear air and ordinary rain', () => {
    for (const f of [
      frame(),
      frame({ RAIN: 24, WIND_X: 1.5, WIND_Z: 0.6 }),
      frame({ RAIN: 36, WIND_X: 4 }),
    ]) {
      const a = weatherAmbience(f);
      // Under the 3 m/s breeze the gale bed is shut; 4 m/s opens it by a hair.
      expect(a.gale).toBeLessThan(1e-4);
      expect(a.grit).toBe(0);
      expect(a.thunder).toBe(0);
      expect(a.masterLowpassHz).toBe(18000);
      expect(a.masterGain).toBe(1);
    }
  });
  it('howls in a gale, hisses with sand, rumbles with thunder and hushes in fog', () => {
    const gale = weatherAmbience(frame({ WIND_X: 12, WIND_Z: 5 }));
    expect(gale.gale).toBeGreaterThan(0.1);
    expect(gale.gale).toBeLessThanOrEqual(0.2);
    expect(weatherAmbience(frame({ WIND_X: 18 })).galeHz).toBeGreaterThan(gale.galeHz);
    const sand = weatherAmbience(frame({ WIND_X: 12, EXTINCTION: 20, DUST: 1 }));
    expect(sand.grit).toBeGreaterThan(0.05);
    expect(weatherAmbience(frame({ WIND_X: 12, EXTINCTION: 20, DUST: 0 })).grit).toBe(0);
    let slot = 0;
    while (!strikeInSlot(slot, 1)) slot++;
    const strike = strikeInSlot(slot, 1)!;
    const arrival = strike.timeSec + strike.distanceM / LIGHTNING.speedOfSound + 0.4;
    expect(weatherAmbience(frame({ RAIN: 70, TIME: arrival })).thunder).toBeGreaterThan(0.02);
    const fog = weatherAmbience(frame({ EXTINCTION: 35, DUST: 0 }));
    expect(fog.masterLowpassHz).toBeLessThan(8000);
    expect(fog.masterGain).toBeLessThan(0.9);
    expect(weatherAmbience(frame({ EXTINCTION: 35, DUST: 1 })).masterLowpassHz).toBe(18000);
    expect(weatherAmbience(frame({ EXTINCTION: NaN, WIND_X: NaN })).gale).toBe(0);
  });
  it('reads visibility and strong wind into the HUD without disturbing the old readout', () => {
    expect(weatherReadout(24, 0, 0)).toBe('24°C / DRY TRACK');
    expect(weatherReadout(19, 24, 1.1)).toBe('19°C / RAIN 24.0 MM/H · TRACK AVG 1.10 MM WATER');
    expect(airReadout(0, 0, 1.6)).toBe('');
    expect(airReadout(particulateExtinctionPerKm(110), 0, 0.8)).toBe('FOG 110 M · ');
    expect(airReadout(particulateExtinctionPerKm(170), 1, 12.4)).toBe(
      'DUST 170 M · WIND 12 M/S · ',
    );
    expect(airReadout(particulateExtinctionPerKm(1500), 0, 0)).toBe('FOG 1.5 KM · ');
    expect(airReadout(particulateExtinctionPerKm(8000), 0, 0)).toBe('');
    expect(weatherReadout(9, 0, 0.03, particulateExtinctionPerKm(120), 0, 0.8)).toBe(
      '9°C / FOG 120 M · DAMP TRACK',
    );
    expect(weatherReadout(NaN, 0, 0)).toBe('WEATHER DATA UNAVAILABLE');
  });
  it('names all six states in the new catalogue (G6: six weather states)', () => {
    expect(NEW_STATES.every((id) => isWeatherId(id))).toBe(true);
    expect(WEATHER_IDS.length).toBeGreaterThanOrEqual(6);
  });
});

describe('road surface presentation of damp and dust', () => {
  const frame = (over: Partial<Record<keyof typeof H, number>> = {}) => {
    const f = new Float32Array(HEADER + CAR_STRIDE);
    f[H.TIME] = 1;
    for (const [k, v] of Object.entries(over)) f[H[k as keyof typeof H]] = v as number;
    return f;
  };
  it('shares one dust uniform: zero outside a dust storm, full inside one, off when disabled', () => {
    const presentation = new WeatherPresentation();
    presentation.update(frame());
    expect(roadDustUniform.value).toBe(0);
    presentation.update(frame({ EXTINCTION: 35, DUST: 0 }));
    expect(roadDustUniform.value).toBe(0);
    presentation.update(frame({ EXTINCTION: 20, DUST: 1 }));
    expect(roadDustUniform.value).toBe(1);
    presentation.update(frame({ EXTINCTION: 1.2, DUST: 1 }));
    expect(roadDustUniform.value).toBeGreaterThan(0);
    expect(roadDustUniform.value).toBeLessThan(0.1);
    presentation.update(frame({ EXTINCTION: 20, DUST: 1 }), false);
    expect(roadDustUniform.value).toBe(0);
    presentation.update(frame());
    expect(roadDustUniform.value).toBe(0);
  });
  it('lets the road shader read a fine film as damp and the settled film as sand', () => {
    // A 0.03 mm film (fog drip) is already damp; the sheet still starts at 0.65 mm.
    expect(wetRoadShader).toContain('roadDamp = smoothstep(0.004, 0.05, waterMm)');
    expect(wetRoadShader).toContain('smoothstep(0.0, 0.65, waterMm)');
    expect(wetRoadShader).toContain('float puddle = smoothstep(0.65, 1.5, waterMm)');
    expect(wetRoadShader).toContain('roadDust');
    // Black rubber pellets are suppressed by exactly the dust share.
    expect(wetRoadShader).toContain('(1.0 - roadDust)');
  });
});

describe('determinism: every new state replays bit for bit', () => {
  it('produces identical snapshots from identical seeds, and finite state throughout', () => {
    for (const weather of NEW_STATES) {
      const run = () => {
        const sim = new Simulation({
          ...DEFAULT_OPTIONS,
          opponents: 2,
          weather,
          seed: 91,
          compound: WEATHER_CATALOGUE[weather].suggestedTyre ?? 'medium',
        });
        sim.autoPlayer = true;
        const frame = new Float32Array(HEADER + 3 * CAR_STRIDE);
        for (let i = 0; i < 900; i++) {
          sim.step(1 / 120);
          for (const c of sim.cars)
            expect(Number.isFinite(c.speed) && c.body.position.finite()).toBe(true);
        }
        sim.writeFrame(frame);
        return frame;
      };
      const a = run(),
        b = run();
      expect(Array.from(a)).toEqual(Array.from(b));
      expect(a.every(Number.isFinite)).toBe(true);
    }
  });
});
