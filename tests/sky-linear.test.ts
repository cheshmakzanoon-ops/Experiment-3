import { describe, it, expect } from 'vitest';
import * as T from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { GRADE_PROFILES } from '../src/rendering/broadcast-grade.ts';
import {
  SUN_OFFSET,
  SUNSET_OFFSET,
  SKY_GRADE,
  circuitLightState,
  configureSky,
  daylightState,
  preethamSky,
  skyGrade,
  skyLinearGain,
} from '../src/rendering/daylight.ts';

const luma = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const saturation = (c: number[]) => (Math.max(...c) - Math.min(...c)) / Math.max(...c);
/** A view direction at `elevation` degrees, 90 degrees in azimuth from the sun. */
function across(sun: T.Vector3, elevation: number) {
  const side = new T.Vector3(-sun.z, 0, sun.x).normalize();
  const r = T.MathUtils.degToRad(elevation);
  return side.multiplyScalar(Math.cos(r)).setY(Math.sin(r));
}

describe('linear Preetham sky', () => {
  const turbidity = daylightState(0.12, 0).turbidity;
  it('keeps the blue that a second display curve removed', () => {
    // linearMin applies to the dome as rendered: Preetham x the day grade.
    for (const [elevation, linearMin, encodedMax] of [
      [8, 0.75, 0.3],
      [15, 0.8, 0.45],
      [40, 0.8, 0.6],
    ]) {
      const direction = across(SUN_OFFSET, elevation);
      const { linear, encoded } = preethamSky(direction, SUN_OFFSET, turbidity);
      const grade = skyGrade(direction.y);
      expect(saturation(linear.map((c, i) => c * grade[i]))).toBeGreaterThan(linearMin);
      expect(saturation(linear)).toBeGreaterThan(saturation(encoded) + 0.08);
      expect(saturation(encoded)).toBeLessThan(encodedMax);
      // The encoded value is exactly three's pow(texColor, 1/2.4) for a high sun.
      for (let i = 0; i < 3; i++) expect(encoded[i]).toBeCloseTo(linear[i] ** (1 / 2.4), 12);
    }
    // Brighter towards the horizon, darker and bluer at the zenith.
    const low = preethamSky(across(SUN_OFFSET, 3), SUN_OFFSET, turbidity).linear,
      high = preethamSky(new T.Vector3(0, 1, 0), SUN_OFFSET, turbidity).linear;
    expect(luma(low)).toBeGreaterThan(2 * luma(high));
  });
  it('matches the encoded sky hemispherical luminance, for day and sunset', () => {
    // Clear weather (turbidity 2.56), a hazier 2.3 sky and a 5.6 sunset, for
    // the 52-degree day sun and the 10-degree sunset sun (rayleigh 3.4).
    for (const [sun, t, expected] of [
      [SUN_OFFSET, turbidity, 0.424],
      [SUN_OFFSET, 2.3, 0.427],
      [SUNSET_OFFSET, 5.6, 1.064],
    ] as const) {
      const gain = skyLinearGain(sun, t);
      expect(gain).toBeCloseTo(expected, 2);
      expect(skyLinearGain(sun, t)).toBe(gain);
      // Independent, finer integration: linear x gain carries the same
      // cosine-weighted luminance as the encoded dome (the environment light).
      let encoded = 0,
        linear = 0;
      const disc = sun.clone().normalize();
      for (let i = 0; i < 40; i++)
        for (let j = 0; j < 80; j++) {
          const el = ((i + 0.5) / 40) * (Math.PI / 2),
            az = ((j + 0.5) / 80) * 2 * Math.PI;
          const d = new T.Vector3(
            Math.cos(el) * Math.cos(az),
            Math.sin(el),
            Math.cos(el) * Math.sin(az),
          );
          if (d.dot(disc) > 0.99995) continue;
          const s = preethamSky(d, sun, t);
          const w = Math.sin(el) * Math.cos(el);
          encoded += luma(s.encoded) * w;
          linear += luma(s.linear) * w * gain;
        }
      expect(linear / encoded).toBeCloseTo(1, 2);
    }
    expect(() => skyLinearGain(SUN_OFFSET, 0)).toThrow();
  });
  it('routes the linear radiance into the dome and keeps the solar disc', () => {
    const sky = new Sky();
    configureSky(sky);
    const shader = sky.material.fragmentShader;
    expect(shader).toContain('uniform float skyLinearGain');
    expect(shader).toContain('*skyLinearGain,retColor,sundisk)');
    expect(sky.material.uniforms.skyLinearGain.value).toBeCloseTo(0.43, 2); // turbidity 1.9
    // The old saturation boost for the encoded dome is gone.
    expect(shader).not.toContain('Deepen the clear zenith');
  });

  it('grades the clear dome to the art-bible blue through ACES and the day grade', () => {
    // CPU model of the display chain: three's ACES fit at the day exposure,
    // the sRGB transfer, then the day BroadcastGradePass (contrast, split tone
    // and saturation/vibrance) at the frame centre.
    const acesIn = [
      [0.59719, 0.35458, 0.04823],
      [0.076, 0.90834, 0.01566],
      [0.0284, 0.13383, 0.83777],
    ];
    const acesOut = [
      [1.60475, -0.53108, -0.07367],
      [-0.10208, 1.10813, -0.00605],
      [-0.00327, -0.07276, 1.07602],
    ];
    const mul = (m: number[][], v: number[]) =>
      m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
    const smooth = (a: number, b: number, x: number) => {
      const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    const day = circuitLightState(0.12, 0, 'day');
    const display = (radiance: number[]) => {
      const fit = mul(
        acesIn,
        radiance.map((c) => (c * day.exposure) / 0.6),
      ).map(
        (v) => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081),
      );
      let c = mul(acesOut, fit).map((v) => {
        const x = Math.min(1, Math.max(0, v));
        return x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055;
      });
      const g = GRADE_PROFILES.day;
      c = c.map((x) => x + (x * x * (3 - 2 * x) - x) * g.contrast);
      let y = luma(c);
      const tint = smooth(0.08, 0.75, y);
      c = c.map((x, i) => x * (g.shadowTint[i] + (g.highlightTint[i] - g.shadowTint[i]) * tint));
      y = luma(c);
      const chroma = Math.max(...c) - Math.min(...c);
      const boost = g.saturation * (1 + g.vibrance * (1 - smooth(0, 0.55, chroma)));
      return c.map((x) => Math.min(1, Math.max(0, y + (x - y) * boost)) * 255);
    };
    const gain = skyLinearGain(SUN_OFFSET, day.turbidity);
    const dome = (elevation: number) => {
      const direction = elevation >= 90 ? new T.Vector3(0, 1, 0) : across(SUN_OFFSET, elevation);
      const grade = skyGrade(
        direction.y,
        1,
        [0, 0, 0],
        direction.dot(SUN_OFFSET.clone().normalize()),
      );
      return display(
        preethamSky(direction, SUN_OFFSET, day.turbidity).linear.map(
          (c, i) => c * grade[i] * gain * day.skyRadiance,
        ),
      );
    };
    // Horizon band (KPI 4: B - G >= 12) stays sky blue, not lavender or cyan.
    for (const elevation of [1, 5]) {
      const [r, g, b] = dome(elevation);
      expect(b - g).toBeGreaterThanOrEqual(12);
      expect(g - r).toBeGreaterThanOrEqual(15);
      expect(b).toBeGreaterThan(220);
    }
    // KPI 4 'zenith' crops sit 15-30 degrees up in the gameplay cameras.
    for (const elevation of [15, 20, 30]) {
      const [, g, b] = dome(elevation);
      expect(g / b).toBeGreaterThanOrEqual(0.78);
      expect(g / b).toBeLessThanOrEqual(0.86);
    }
    // Zenith #6aa2d6-#70a6cb, within a few levels.
    const zenith = dome(90);
    expect(zenith[0]).toBeGreaterThan(98);
    expect(zenith[0]).toBeLessThan(120);
    expect(zenith[1] / zenith[2]).toBeGreaterThan(0.74);
    expect(zenith[1] / zenith[2]).toBeLessThan(0.84);
    // The grade belongs to the day dome only.
    expect(skyGrade(0.3, 0)).toEqual([1, 1, 1]);
    expect(skyGrade(1)).toEqual([...SKY_GRADE.zenith]);
    expect(skyGrade(-0.2)).toEqual([...SKY_GRADE.horizon]);
    const sky = new Sky();
    configureSky(sky);
    expect(sky.material.fragmentShader).toContain(
      `const vec3 skyGradeHorizon=vec3(${SKY_GRADE.horizon.join(',')});`,
    );
    expect(sky.material.fragmentShader).toContain('(1.0-sunsetAmount)*(1.0-nightAmount)');
    // A PMREM capture keeps each direction's ungraded luminance in the graded hue.
    expect(sky.material.uniforms.skyGradeLuminance.value).toBe(1);
    const probe = { getRenderTarget: () => new T.WebGLCubeRenderTarget(4) },
      screen = { getRenderTarget: () => null };
    const render = (renderer: object) =>
      sky.onBeforeRender(
        renderer as T.WebGLRenderer,
        new T.Scene(),
        new T.PerspectiveCamera(),
        sky.geometry,
        sky.material,
        null as unknown as T.Group,
      );
    render(probe);
    expect(sky.material.uniforms.skyGradeLuminance.value).toBe(0);
    render(screen);
    expect(sky.material.uniforms.skyGradeLuminance.value).toBe(1);
    expect(sky.clone().onBeforeRender).not.toBe(sky.onBeforeRender);
    expect(sky.material.fragmentShader).toContain(
      'skyGraded*=mix(dot(skyLinear,skyLuma)/max(dot(skyGraded,skyLuma),1e-9),1.0,skyGradeLuminance);',
    );
    sky.geometry.dispose();
    sky.material.dispose();
  });
});
