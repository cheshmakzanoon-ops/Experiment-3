import { describe, it, expect } from 'vitest';
import * as T from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import {
  SUN_OFFSET,
  SUNSET_OFFSET,
  configureSky,
  daylightState,
  preethamSky,
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
    for (const [elevation, linearMin, encodedMax] of [
      [8, 0.5, 0.3],
      [15, 0.65, 0.45],
      [40, 0.8, 0.6],
    ]) {
      const { linear, encoded } = preethamSky(across(SUN_OFFSET, elevation), SUN_OFFSET, turbidity);
      expect(saturation(linear)).toBeGreaterThan(linearMin);
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
    // Clear weather (turbidity 2.96), a cleaner 2.3 sky and a 5.6 sunset, for
    // the 52-degree day sun and the 10-degree sunset sun.
    for (const [sun, t, expected] of [
      [SUN_OFFSET, turbidity, 0.454],
      [SUN_OFFSET, 2.3, 0.461],
      [SUNSET_OFFSET, 5.6, 1.081],
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
    expect(sky.material.uniforms.skyLinearGain.value).toBeCloseTo(0.461, 2); // turbidity 2.3
    // The old saturation boost for the encoded dome is gone.
    expect(shader).not.toContain('Deepen the clear zenith');
  });
});
