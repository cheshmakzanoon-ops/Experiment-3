import { afterEach, describe, expect, it } from 'vitest';
import * as T from 'three';
import {
  WEATHER_SURFACES,
  WeatherPresentation,
  sceneryCoverUniform,
  tagWeatherSurface,
  type WeatherMask,
  type WeatherSurface,
} from '../src/rendering/weather-presentation.ts';
import { H, HEADER } from '../src/simulation/protocol.ts';

afterEach(() => {
  sceneryCoverUniform.value = 0;
});

function compile(material: T.Material) {
  const shader = {
    vertexShader: T.ShaderLib.physical.vertexShader,
    fragmentShader: T.ShaderLib.physical.fragmentShader,
    uniforms: T.UniformsUtils.clone(T.ShaderLib.physical.uniforms),
  } as T.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as T.WebGLRenderer);
  return shader;
}

/** Read the condition from the production-generated shader, rather than a
 * second handwritten predicate. These scalar GLSL comparisons have the same
 * syntax and finite-number semantics in JavaScript. Pixel parity is a separate
 * WebGL check; this probe checks which exact states reach the retained body. */
function weatherBranch(source: string) {
  const match = /if \((aurelSurfaceWeather\.x[^)\n]+)\) \{/.exec(source);
  if (!match) throw new Error('Weather shader has no uniform fast path');
  const start = match.index + match[0].length;
  let depth = 1,
    end = start;
  for (; end < source.length && depth; end++) {
    if (source[end] === '{') depth++;
    else if (source[end] === '}') depth--;
  }
  if (depth) throw new Error('Weather fast path is not closed');
  return {
    condition: match[1],
    body: source.slice(start, end - 1),
    before: source.slice(0, match.index),
    after: source.slice(end),
    runs: new Function('aurelSurfaceWeather', 'aurelSnowCover', `return ${match[1]};`) as (
      weather: { x: number },
      snow: number,
    ) => boolean,
  };
}

function maskedMaterial(mask: WeatherMask) {
  const material = tagWeatherSurface(new T.MeshPhysicalMaterial(), 'fabric', 0.8, mask);
  // Supply the existing crowd's declaration contract. It stays outside the
  // weather branch, just as the real material's mask does.
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader =
      mask === 'spectator'
        ? shader.fragmentShader.replace(
            '#include <common>',
            '#include <common>\nvarying float vCrowdCloth;',
          )
        : shader.fragmentShader.replace(
            '#include <map_fragment>',
            '#include <map_fragment>\nfloat headMask = 0.25;',
          );
  };
  return material;
}

describe('exact-zero material weather work', () => {
  it.each(Object.keys(WEATHER_SURFACES) as WeatherSurface[])(
    '%s skips only simultaneous exact-zero wetness and snow, with derivatives inside a uniform branch',
    (role) => {
      const weather = new WeatherPresentation();
      const material = tagWeatherSurface(new T.MeshPhysicalMaterial(), role);
      weather.installMaterial(material);
      const shader = compile(material),
        branch = weatherBranch(shader.fragmentShader);
      expect(branch.condition).toBe('aurelSurfaceWeather.x != 0.0 || aurelSnowCover != 0.0');
      for (const [wet, snow, runs] of [
        [0, 0, false],
        [-0, -0, false],
        [Math.fround(1e-30), 0, true],
        [0, Math.fround(1e-30), true],
        [0.5, 0, true],
        [0, 0.5, true],
        [0.5, 0.5, true],
        [1, 1, true],
      ] as const)
        expect(branch.runs({ x: wet }, snow)).toBe(runs);
      expect(branch.body).toContain('float weatherUp = vWeatherUp;');
      expect(branch.body).toContain('fwidth(vWeatherWorld)');
      expect(branch.body).toContain('gl_FrontFacing');
      expect(branch.body).toContain('float weatherBroad = sin(');
      expect(branch.body).toContain('diffuseColor.rgb *= 1.-surfaceWet');
      expect(branch.body).toContain('diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.78,.82,.88)');
      expect(branch.body).toContain('roughnessFactor = mix(roughnessFactor, .9, surfaceSnow);');
      expect(branch.before).not.toContain('fwidth(vWeatherWorld)');
      expect(branch.after).toContain('#include <lights_physical_fragment>');
      expect(branch.body).not.toContain('#include <lights_physical_fragment>');
      expect(shader.uniforms.aurelSurfaceWeather).toBe(weather.surface);
      expect(shader.uniforms.aurelSnowCover).toBe(sceneryCoverUniform);
      expect(material.customProgramCacheKey()).toContain('|exact-zero-weather-v1');
      material.dispose();
      weather.dispose();
    },
  );

  it.each(['spectator', 'impostor'] as const)(
    '%s keeps its complete existing scalar weather path unchanged',
    (mask) => {
      const weather = new WeatherPresentation(),
        material = maskedMaterial(mask),
        before = compile(material),
        previousKey = material.customProgramCacheKey();
      weather.installMaterial(material);
      const shader = compile(material),
        coverage = mask === 'spectator' ? 'vCrowdCloth' : '(1.-headMask)';
      const original = `
            float surfaceWet = aurelSurfaceWeather.x * 0.440000 * clamp(${coverage},0.,1.);
            diffuseColor.rgb *= 1.-surfaceWet*0.150;
            roughnessFactor = mix(roughnessFactor, min(roughnessFactor, 0.780), surfaceWet);
            #include <lights_physical_fragment>`;
      expect(shader.fragmentShader).toBe(
        before.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform vec4 aurelSurfaceWeather;')
          .replace('#include <lights_physical_fragment>', original),
      );
      expect(shader.vertexShader).toBe(before.vertexShader);
      expect(shader.fragmentShader).not.toContain('if (aurelSurfaceWeather');
      expect(shader.uniforms.aurelSnowCover).toBeUndefined();
      expect(material.customProgramCacheKey()).toBe(
        `${previousKey}|aurel-snapshot-dampness-v4:fabric:0.8:${mask}`,
      );
      material.dispose();
      weather.dispose();
    },
  );

  it('changes dry, wet, retained-water and snow states without recompiling or editing snapshots', () => {
    const weather = new WeatherPresentation(),
      material = tagWeatherSurface(new T.MeshPhysicalMaterial(), 'stone');
    weather.installMaterial(material);
    const shader = compile(material),
      branch = weatherBranch(shader.fragmentShader),
      version = material.version,
      key = material.customProgramCacheKey();
    const states = [
      { rain: 0, water: 0, frozen: 0, enabled: true, active: false },
      { rain: 9, water: 0, frozen: 0, enabled: true, active: true },
      { rain: 0, water: 0.2, frozen: 0, enabled: true, active: true },
      { rain: 0, water: 0, frozen: 0.5, enabled: true, active: true },
      { rain: 9, water: 0.2, frozen: 0.5, enabled: true, active: true },
      { rain: 9, water: 0.2, frozen: 0.5, enabled: false, active: false },
      { rain: 0, water: 0, frozen: 0, enabled: true, active: false },
    ];
    for (const state of states) {
      const frame = new Float32Array(HEADER);
      frame[H.TIME] = 17.25;
      frame[H.AMBIENT] = 18;
      frame[H.RAIN] = state.rain;
      frame[H.WATER] = state.water;
      frame[H.WIND_X] = 4;
      frame[H.WIND_Z] = -3;
      const saved = frame.slice();
      weather.update(frame, state.enabled, state.frozen);
      expect(
        branch.runs(
          shader.uniforms.aurelSurfaceWeather.value,
          shader.uniforms.aurelSnowCover.value,
        ),
      ).toBe(state.active);
      expect(frame).toEqual(saved);
      expect(material.version).toBe(version);
      expect(material.customProgramCacheKey()).toBe(key);
      expect(shader.uniforms.aurelSurfaceWeather).toBe(weather.surface);
    }
    material.dispose();
    weather.dispose();
  });
});
