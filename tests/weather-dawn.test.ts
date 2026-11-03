import { describe, expect, it } from 'vitest';
import * as T from 'three';
import {
  WeatherTimeline,
  groundCloud,
  weatherKeyframes,
  type WeatherState,
} from '../src/simulation/weather.ts';
import { WEATHER_IDS } from '../src/simulation/weather-catalogue.ts';
import { Track } from '../src/simulation/track.ts';
import { CAR_STRIDE, H, HEADER, carBase, F } from '../src/simulation/protocol.ts';
import { circuitLightState } from '../src/rendering/daylight.ts';
import {
  adjustDaylight,
  tintLights,
  weatherAtmosphere,
} from '../src/rendering/weather-atmosphere.ts';
import { Effects, PARTICLE_KIND } from '../src/rendering/effects.ts';
import { MIST, mistAmount } from '../src/rendering/mist.ts';
import { FogLightShafts, SHAFTS, shaftDensity } from '../src/rendering/fog-light-shafts.ts';
import { VenueLighting } from '../src/rendering/venue-lighting.ts';

const state = (): WeatherState => ({ cloud: 0, rain: 0, ambient: 0, windX: 0, windZ: 0 });
const frame = (over: Partial<Record<keyof typeof H, number>> = {}) => {
  const f = new Float32Array(HEADER + CAR_STRIDE);
  f[H.AMBIENT] = 10;
  f[H.CARS] = 1;
  f[carBase(0) + F.QW] = 1;
  for (const [k, v] of Object.entries(over)) f[H[k as keyof typeof H]] = v as number;
  return f;
};

describe('fog cover: a clear sky over a shallow bank', () => {
  it('keeps the preset at the cover it always had on the pavement, and a clear sky above', () => {
    const legacy = [
      [0, 0.82],
      [180, 0.82],
      [420, 0.7],
      [720, 0.5],
      [1020, 0.3],
      [1500, 0.2],
    ];
    const timeline = new WeatherTimeline(weatherKeyframes('fog')),
      s = state();
    for (const [t, cover] of legacy) {
      timeline.sample(t, s);
      expect(s.cloud, `sky@${t}`).toBeCloseTo(0.12, 12);
      expect(groundCloud(s.cloud, s.fogCover!), `ground@${t}`).toBeCloseTo(cover, 3);
    }
  });
  it('is zero in every other preset and exactly the sky where there is no fog cover', () => {
    for (const id of WEATHER_IDS.filter((x) => x !== 'fog')) {
      for (const k of weatherKeyframes(id)) expect(k.fogCover01 ?? 0, id).toBe(0);
    }
    expect(groundCloud(0.37, 0)).toBe(0.37);
    expect(groundCloud(0.12, 0.7955)).toBeCloseTo(0.82, 3);
    expect(groundCloud(1, 0.5)).toBe(1);
  });
  it('writes the SKY into the snapshot and warms the road as it did before', () => {
    const track = new Track('fog');
    track.evolve(0.5, 0.5);
    expect(track.cloud).toBeCloseTo(0.12, 12);
    expect(track.fogCover).toBeGreaterThan(0.7);
    for (let t = 1; t <= 300; t += 0.5) track.evolve(0.5, t);
    let mean = 0;
    for (const v of track.temperature) mean += v;
    mean /= track.temperature.length;
    // 8.4533 C at 300 s with the old whole-sky cloud of 0.76 (measured on the baseline commit).
    expect(mean).toBeCloseTo(8.4533, 2);
  });
});

describe('golden hour over a fog bank is a warm dawn', () => {
  const light = () => circuitLightState(0.12, 0, 'sunset');
  const fog = () => weatherAtmosphere(frame({ EXTINCTION: 20, CLOUD: 0.12 }));
  it('keeps most of the low sun that the bank smothers at midday, and warms the haze', () => {
    const day = adjustDaylight({ ...light() }, fog(), false, false),
      dawn = adjustDaylight({ ...light() }, fog(), false, true);
    expect(dawn.sun).toBeGreaterThan(day.sun * 1.7);
    expect(dawn.fogRed / dawn.fogBlue).toBeGreaterThan((day.fogRed / day.fogBlue) * 1.15);
    expect(dawn.fogRed).toBeGreaterThan(dawn.fogGreen);
    expect(dawn.fogGreen).toBeGreaterThan(dawn.fogBlue);
  });
  it('warms the key and sky light under golden fog, and only then', () => {
    const colours = () => ({
      sun: { color: new T.Color(1, 1, 1) },
      sky: { color: new T.Color(1, 1, 1) },
    });
    const gold = colours(),
      plain = colours();
    tintLights(gold.sun, gold.sky, fog(), true);
    tintLights(plain.sun, plain.sky, fog(), false);
    expect(gold.sun.color.b).toBeLessThan(gold.sun.color.r);
    expect(gold.sky.color.b).toBeLessThan(gold.sky.color.r);
    expect(plain.sun.color.r).toBe(1);
    expect(plain.sun.color.b).toBe(1);
    const clear = colours();
    tintLights(clear.sun, clear.sky, weatherAtmosphere(frame()), true);
    expect(clear.sun.color.b).toBe(1);
  });
  it('changes nothing in clear air, at night or without golden lighting', () => {
    const base = light(),
      clear = weatherAtmosphere(frame());
    expect(adjustDaylight({ ...base }, clear, false, true)).toEqual(base);
    const night = adjustDaylight({ ...light() }, fog(), true, true),
      nightPlain = adjustDaylight({ ...light() }, fog(), true, false);
    expect(night.sun).toBe(nightPlain.sun);
    expect(night.fogRed).toBe(nightPlain.fogRed);
  });
});

describe('ground mist wisps', () => {
  const disposeEffects = (effects: Effects) =>
    effects.group.traverse((object) => {
      const mesh = object as { geometry?: { dispose(): void }; material?: { dispose(): void } };
      mesh.geometry?.dispose();
      mesh.material?.dispose();
    });
  it('is a fog bank only: none in clear air, dust or snow, full from about 500 m of view', () => {
    expect(mistAmount(0, 0)).toBe(0);
    expect(mistAmount(1, 0)).toBe(0);
    expect(mistAmount(8, 0)).toBe(1);
    expect(mistAmount(35, 0)).toBe(1);
    expect(mistAmount(20, 1)).toBe(0);
    expect(mistAmount(20, 0, 1)).toBe(0);
    expect(mistAmount(4.5, 0)).toBeGreaterThan(0.3);
    expect(mistAmount(4.5, 0)).toBeLessThan(0.7);
    expect(mistAmount(Number.NaN, 0)).toBe(0);
  });
  it('births a bounded number of faint wisps per second, at any render rate', () => {
    for (const hz of [24, 60, 144]) {
      const e = new Effects();
      try {
        const f = frame({ EXTINCTION: 35, WIND_X: 1.5 });
        for (let i = 0; i < hz * 4; i++) e.update(f, 1 / hz);
        const spawned = e.diagnostics().spawned[PARTICLE_KIND.SMOKE];
        expect(spawned).toBe(MIST.rate * 4);
        expect(MIST.alpha).toBeLessThan(0.2);
      } finally {
        disposeEffects(e);
      }
    }
  });
  it('is silent in clear air, dust and snow', () => {
    for (const f of [
      frame(),
      frame({ EXTINCTION: 35, DUST: 1 }),
      frame({ EXTINCTION: 35, RAIN: 3, AMBIENT: -4 }),
    ]) {
      const e = new Effects();
      try {
        for (let i = 0; i < 120; i++) e.update(f, 1 / 60);
        expect(e.diagnostics().spawned[PARTICLE_KIND.SMOKE]).toBe(0);
      } finally {
        disposeEffects(e);
      }
    }
  });
});

describe('floodlight shafts in fog, dust and snow at night', () => {
  const fogAir = { extinctionPerKm: 14, dust: 0, snow: 0 };
  it('has density only with particulate in the air and lamps on', () => {
    expect(shaftDensity({ extinctionPerKm: 0, dust: 0, snow: 0 }, 1)).toBe(0);
    expect(shaftDensity({ extinctionPerKm: 1.2, dust: 0, snow: 0 }, 1)).toBe(0);
    expect(shaftDensity(fogAir, 0)).toBe(0);
    expect(shaftDensity({ ...fogAir, extinctionPerKm: 10 }, 1)).toBeCloseTo(SHAFTS.ceiling, 12);
    expect(shaftDensity({ ...fogAir, extinctionPerKm: 80 }, 1)).toBeCloseTo(SHAFTS.ceiling, 12);
    expect(shaftDensity(fogAir, 0.18)).toBeCloseTo(SHAFTS.ceiling * 0.18, 12);
    const half = shaftDensity({ ...fogAir, extinctionPerKm: 5.6 }, 1);
    expect(half).toBeGreaterThan(0.05);
    expect(half).toBeLessThan(SHAFTS.ceiling);
    expect(shaftDensity({ extinctionPerKm: Number.NaN, dust: 0, snow: 0 }, 1)).toBe(0);
  });
  it('builds one aimed cone per mast and tints the beam by the air', () => {
    const sites = [
      { x: 0, z: 0, baseY: 0, topY: 14, inward: [1, 0] as const },
      { x: 50, z: 0, baseY: 1, topY: 15, inward: [0, 1] as const },
    ];
    const shafts = new FogLightShafts(sites);
    expect(shafts.mesh.count).toBe(2);
    expect(shafts.mesh.visible).toBe(false);
    expect(shafts.update({ extinctionPerKm: 0, dust: 0, snow: 0 }, 1)).toBe(0);
    expect(shafts.mesh.visible).toBe(false);
    expect(shafts.update(fogAir, 1)).toBeGreaterThan(0.3);
    expect(shafts.mesh.visible).toBe(true);
    const white = (shafts.mesh.material.uniforms.tint.value as T.Vector3).clone();
    shafts.update({ ...fogAir, dust: 1 }, 1);
    const amber = shafts.mesh.material.uniforms.tint.value as T.Vector3;
    expect(amber.x).toBeGreaterThan(amber.z * 1.8);
    expect(amber.z).toBeLessThan(white.z);
    shafts.update(fogAir, 0);
    expect(shafts.mesh.visible).toBe(false);
    // The beam runs from the lamp head to the ground, aimed toward the circuit.
    const m = new T.Matrix4(),
      apex = new T.Vector3(0, 0.5, 0),
      base = new T.Vector3(0, -0.5, 0);
    shafts.mesh.getMatrixAt(0, m);
    apex.applyMatrix4(m);
    base.applyMatrix4(m);
    expect(apex.y).toBeCloseTo(13.8, 4);
    expect(apex.x).toBeCloseTo(0, 4);
    expect(base.y).toBeCloseTo(0, 4);
    expect(base.x).toBeCloseTo(SHAFTS.aimM, 4);
    shafts.dispose();
  });
  it('lives under the venue masts and follows the night and the air', () => {
    const lighting = new VenueLighting(new Track('clear'));
    expect(lighting.shafts.mesh.count).toBe(lighting.sites.length);
    expect(lighting.hardware.children).toContain(lighting.shafts.mesh);
    const anchor = new T.Vector3();
    lighting.update(false, anchor, 1, fogAir);
    expect(lighting.shafts.mesh.visible).toBe(false);
    lighting.update(true, anchor, 1);
    expect(lighting.shafts.mesh.visible).toBe(false);
    lighting.update(true, anchor, 1, fogAir);
    expect(lighting.shafts.mesh.visible).toBe(true);
    expect(lighting.diagnostics().shaftDensity).toBeGreaterThan(0.3);
  });
});
