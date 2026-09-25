import { afterEach, describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import {
  WeatherPresentation,
  WEATHER_SURFACES,
  roadWeatherUniform,
  surfaceDampness,
  weatherSurface,
} from '../src/rendering/weather-presentation.ts';
import { installWetRoad } from '../src/rendering/materials.ts';
import { installVenueFinish } from '../src/rendering/venue-materials.ts';
import { installCrewSkin } from '../src/rendering/crew-pose.ts';
import { applyCircuitLightPalette } from '../src/rendering/lighting-coherence.ts';
import { circuitLightState, type LightingMode } from '../src/rendering/daylight.ts';
import { AdaptiveExposurePass } from '../src/rendering/adaptive-exposure.ts';
import { ReflectionSystem } from '../src/rendering/reflections.ts';
import {
  LocalAtmosphere,
  fogSegmentIntegral,
  pocketDensity,
} from '../src/rendering/local-atmosphere.ts';
import { RainStreaks } from '../src/rendering/rain-streaks.ts';
import { SprayClouds } from '../src/rendering/spray-clouds.ts';
import { precipitationLighting } from '../src/rendering/precipitation-light.ts';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { Track } from '../src/simulation/track.ts';
import { H, HEADER } from '../src/simulation/protocol.ts';

afterEach(() => vi.restoreAllMocks());
function frame(time = 1, rain = 24, water = 0.7) {
  const f = new Float32Array(HEADER);
  f[H.TIME] = time;
  f[H.RAIN] = rain;
  f[H.WATER] = water;
  f[H.WIND_X] = 3;
  f[H.WIND_Z] = -2;
  return f;
}
function shaderFor(material: T.Material) {
  const shader = {
    vertexShader: T.ShaderLib.physical.vertexShader,
    fragmentShader: T.ShaderLib.physical.fragmentShader,
    uniforms: T.UniformsUtils.clone(T.ShaderLib.physical.uniforms),
  } as T.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as T.WebGLRenderer);
  return shader;
}

describe('27H.5 snapshot-owned material weather', () => {
  it('holds and rewinds exactly without mutating production simulation frames', () => {
    const sim = new Simulation({ ...DEFAULT_OPTIONS, weather: 'rain', opponents: 0 });
    const a = sim.makeFrame();
    for (let i = 0; i < 720; i++) sim.step(1 / 120);
    const b = sim.makeFrame(),
      savedA = a.slice(),
      savedB = b.slice();
    const weather = new WeatherPresentation(),
      road = new T.MeshPhysicalMaterial();
    const uniform = roadWeatherUniform(road);
    weather.installMaterial(road);
    weather.update(a);
    const first = weather.diagnostics(),
      firstRoad = uniform.value.toArray();
    weather.update(b);
    const forward = weather.diagnostics();
    for (let i = 0; i < 50; i++) weather.update(b);
    expect(weather.diagnostics()).toEqual(forward);
    expect(forward.time).toBeGreaterThan(first.time);
    weather.update(a);
    expect(weather.diagnostics()).toEqual(first);
    expect(uniform.value.toArray()).toEqual(firstRoad);
    expect(a).toEqual(savedA);
    expect(b).toEqual(savedB);
    weather.update(a, false);
    expect(weather.diagnostics().dampness).toBe(0);
    expect(uniform.value.x).toBe(0);
    weather.update(a);
    expect(weather.diagnostics()).toEqual(first);
    weather.dispose();
    road.dispose();
  });
  it('retains dampness after rain but dries from recorded water, not a decorative clock', () => {
    expect(surfaceDampness(0, 0)).toBe(0);
    expect(surfaceDampness(0, 0.8)).toBe(1);
    expect(surfaceDampness(18, 0)).toBe(1);
    expect(surfaceDampness(9, 0)).toBe(0.5);
    expect(surfaceDampness(-3, -1)).toBe(0);
    expect(surfaceDampness(80, 5)).toBe(1);
    for (const v of [NaN, Infinity]) expect(() => surfaceDampness(v, 0)).toThrow();
    const weather = new WeatherPresentation();
    for (const channel of [H.TIME, H.RAIN, H.WATER, H.WIND_X, H.WIND_Z]) {
      const f = frame();
      f[channel] = NaN;
      expect(() => weather.update(f)).toThrow();
    }
    expect(() => weather.update(new Float32Array())).toThrow();
    expect(() => weather.update(frame(-1))).toThrow();
    weather.dispose();
  });
  it.each(Object.keys(WEATHER_SURFACES) as (keyof typeof WEATHER_SURFACES)[])(
    '%s is explicitly classified, idempotent, instancing-safe and texture-free',
    (role) => {
      const weather = new WeatherPresentation(),
        material = new T.MeshStandardMaterial();
      material.userData.weatherSurface = role;
      let previousCalls = 0;
      material.onBeforeCompile = () => previousCalls++;
      material.customProgramCacheKey = () => 'retained-material-v1';
      const root = new T.Mesh(new T.BoxGeometry(), material),
        count = root.children.length;
      weather.install(root);
      const version = material.version,
        key = material.customProgramCacheKey();
      weather.install(root);
      weather.update(frame());
      const shader = shaderFor(material);
      expect(previousCalls).toBe(1);
      expect(material.version).toBe(version);
      expect(material.customProgramCacheKey()).toBe(key);
      expect(key).toContain('retained-material-v1');
      expect(key).toContain(role);
      expect(shader.uniforms.aurelSurfaceWeather).toBe(weather.surface);
      expect(shader.vertexShader).toContain('batchingMatrix * weatherPosition');
      expect(shader.vertexShader).toContain('instanceMatrix * weatherPosition');
      expect(shader.vertexShader).toContain(
        'inverseTransformDirection(transformedNormal, viewMatrix)',
      );
      expect(shader.fragmentShader).toContain('gl_FrontFacing');
      expect(shader.fragmentShader).toContain('fwidth(vWeatherWorld)');
      expect(shader.fragmentShader).toContain('#include <lights_fragment_begin>');
      expect(weather.diagnostics().materialRoles[role]).toBe(1);
      expect(weather.diagnostics().extraTextures).toBe(0);
      expect(root.children.length).toBe(count);
      expect(material.map).toBeNull();
      weather.dispose();
      material.dispose();
      root.geometry.dispose();
    },
  );
  it('preserves authored finishes, crew skinning and regional haze when hooks are composed', () => {
    const weather = new WeatherPresentation(),
      fog = new LocalAtmosphere(new Track());
    const material = new T.MeshStandardMaterial();
    installVenueFinish(material, 'stone');
    weather.installMaterial(material);
    fog.installMaterial(material);
    const shader = shaderFor(material);
    expect(shader.fragmentShader).toContain('venueFinishResponse()');
    expect(shader.fragmentShader).toContain('surfaceWet');
    expect(shader.fragmentShader).toContain('apexPocketIntegral');
    const suit = new T.MeshStandardMaterial(),
      atlas = new T.DataTexture(new Float32Array(60 * 180 * 4), 60, 180, T.RGBAFormat, T.FloatType);
    suit.userData.weatherSurface = 'fabric';
    installCrewSkin(suit, atlas, 180, true);
    weather.installMaterial(suit);
    fog.installMaterial(suit);
    const skinned = shaderFor(suit);
    expect(skinned.uniforms.crewBones.value).toBe(atlas);
    expect(skinned.uniforms.aurelSurfaceWeather).toBe(weather.surface);
    expect(skinned.fragmentShader).toContain('roughnessFactor');
    expect(WEATHER_SURFACES.fabric[1]).toBeGreaterThan(0.7);
    expect(WEATHER_SURFACES.grass[1]).toBeGreaterThan(0.7);
    expect(WEATHER_SURFACES.metal[0]).toBeLessThan(WEATHER_SURFACES.stone[0]);
    material.dispose();
    suit.dispose();
    atlas.dispose();
    weather.dispose();
  });
  it('does not invent wetness for unknown materials or use average water on road cells', () => {
    const weather = new WeatherPresentation();
    const material = new T.MeshPhysicalMaterial(),
      texture = new T.DataTexture(new Uint8Array(4), 1, 1);
    for (const role of ['__proto__', 'unknown', undefined]) {
      material.userData.weatherSurface = role;
      weather.installMaterial(material);
      expect(weatherSurface(material)).toBeNull();
    }
    material.userData.weatherSurface = 'paving';
    installWetRoad(material, texture, false);
    weather.installMaterial(material);
    expect(weatherSurface(material)).toBeNull();
    const shader = shaderFor(material);
    expect(shader.uniforms.trackState.value).toBe(texture);
    expect(shader.uniforms.surfaceDeposits.value).toBe(0);
    expect(shader.uniforms.aurelSurfaceWeather).toBeUndefined();
    expect(shader.fragmentShader).toContain('roadRippleResolved');
    expect(shader.fragmentShader).toContain('roadWeather.y*7.');
    expect(shader.fragmentShader).toContain(
      'clearcoatNormal = normalize(clearcoatNormal + roadRippleGain',
    );
    weather.update(frame(12, 18, 0.9));
    expect(shader.uniforms.roadWeather.value.toArray()).toEqual([18, 12, 3, -2]);
    expect(weather.diagnostics().roadMaterials).toBe(1);
    expect(weather.diagnostics().materialRoles).toEqual({});
    material.dispose();
    texture.dispose();
    weather.dispose();
  });
});

describe('27H.5 shared illumination, not emissive precipitation', () => {
  it.each(['day', 'sunset', 'night'] as const)(
    '%s keeps sun/fill finite and uses reversible cloud response',
    (mode) => {
      const sun = new T.DirectionalLight(),
        fill = new T.HemisphereLight();
      applyCircuitLightPalette(sun, fill, 0.12, mode);
      const before = [sun.color.toArray(), fill.color.toArray(), fill.groundColor.toArray()];
      applyCircuitLightPalette(sun, fill, 0.95, mode);
      expect(sun.color.toArray().every((v) => v >= 0 && v <= 1)).toBe(true);
      expect([sun.intensity, fill.intensity]).toEqual([1, 1]);
      applyCircuitLightPalette(sun, fill, 0.12, mode);
      expect([sun.color.toArray(), fill.color.toArray(), fill.groundColor.toArray()]).toEqual(
        before,
      );
      expect(sun.shadow.normalBias).toBe(mode === 'sunset' ? 0.004 : 0.008);
      expect(() => applyCircuitLightPalette(sun, fill, NaN, mode)).toThrow();
      expect(() => applyCircuitLightPalette(sun, fill, 0, 'invalid' as LightingMode)).toThrow();
    },
  );
  it('reduces orange sunset illumination under thick cloud and keeps night subordinate', () => {
    const sun = new T.DirectionalLight(),
      fill = new T.HemisphereLight();
    applyCircuitLightPalette(sun, fill, 0, 'sunset');
    const warm = sun.color.r - sun.color.b;
    applyCircuitLightPalette(sun, fill, 1, 'sunset');
    expect(sun.color.r - sun.color.b).toBeLessThan(warm * 0.25);
    expect(circuitLightState(0.95, 24, 'night').sun).toBeLessThan(
      circuitLightState(0.95, 24, 'day').sun,
    );
  });
  it('uses the same actual directional, hemisphere and attenuated point lights for rain and spray', () => {
    const position = new Float32Array(3),
      velocity = new Float32Array([0, -15, 0]),
      opacity = new Float32Array([0.8]);
    const rain = new RainStreaks(position, velocity, opacity);
    const spray = new SprayClouds(
      position,
      velocity,
      new Float32Array([1]),
      opacity,
      new Uint8Array([0]),
    );
    for (const material of [rain.material, spray.material]) {
      expect(material.lights).toBe(true);
      expect(material.vertexShader).toContain(precipitationLighting);
      expect(material.uniforms.directionalLights).toBeDefined();
      expect(material.uniforms.pointLights).toBeDefined();
      expect(material.vertexShader).toContain('getDistanceAttenuation');
      expect(material.depthWrite).toBe(false);
    }
    expect(rain.geometry.getAttribute('center').array).toBe(position);
    expect(rain.geometry.getAttribute('opacity').array).toBe(opacity);
    rain.geometry.dispose();
    rain.material.dispose();
    spray.geometry.dispose();
    spray.material.dispose();
  });
});

describe('27H.5 camera cuts and asynchronous exposure ownership', () => {
  function adapted() {
    const pass = new AdaptiveExposurePass();
    pass.prepare(0, 'day:chase:0:0', 1, true);
    pass.adaptation.observe(-5, 1, pass.adaptation.generation);
    for (let i = 1; i <= 40; i++) pass.prepare(i / 10, 'day:chase:0:0', 1, true);
    return pass;
  }
  it('retains the adapted EV across camera cuts and holds it until the new view is metered', () => {
    const pass = adapted(),
      oldEV = pass.adaptation.ev,
      oldGeneration = pass.adaptation.generation;
    expect(oldEV).toBeGreaterThan(0.7);
    pass.prepare(4, 'day:cockpit:0:0', 1, true);
    expect(pass.adaptation.ev).toBe(oldEV);
    expect(pass.adaptation.samples).toBe(0);
    expect(pass.adaptation.observe(8, 1, oldGeneration)).toBe(false);
    for (let i = 0; i < 50; i++) pass.prepare(4, 'day:cockpit:0:0', 1, true);
    expect(pass.adaptation.ev).toBe(oldEV);
    pass.adaptation.observe(0, 1, pass.adaptation.generation);
    pass.prepare(4.1, 'day:cockpit:0:0', 1, true);
    expect(pass.adaptation.ev).toBeLessThan(oldEV);
    expect(pass.adaptation.ev).toBeGreaterThan(-0.7);
    pass.dispose();
  });
  it.each(['rewind', 'gap', 'lighting', 'disabled'] as const)(
    '%s does not reuse stale view adaptation',
    (reason) => {
      const pass = adapted();
      const value = pass.prepare(
        reason === 'rewind' ? 1 : reason === 'gap' ? 20 : 4,
        reason === 'lighting' ? 'night:chase:0:0' : 'day:chase:0:0',
        1.06,
        reason !== 'disabled',
      );
      expect(value).toBe(1.06);
      expect(pass.adaptation.samples).toBe(0);
      expect(pass.adaptation.ev).toBe(0);
      pass.dispose();
    },
  );
  it('rejects an actual delayed GPU read from before a camera cut and restores render ownership', async () => {
    const pass = adapted(),
      sentinel = new T.WebGLRenderTarget(4, 4),
      source = new T.WebGLRenderTarget(4, 4);
    let resolve!: () => void;
    const renderer = {
      autoClear: false,
      getContext: () => ({ isContextLost: () => false }),
      getRenderTarget: () => sentinel,
      getActiveCubeFace: () => 2,
      getActiveMipmapLevel: () => 1,
      setRenderTarget: vi.fn(),
      readRenderTargetPixelsAsync: vi.fn((_target, _x, _y, _w, _h, bytes: Uint8Array) => {
        for (let i = 0; i < bytes.length; i += 4) {
          bytes[i] = 50;
          bytes[i + 3] = 255;
        }
        return new Promise<void>((r) => {
          resolve = r;
        });
      }),
    };
    vi.spyOn(FullScreenQuad.prototype, 'render').mockImplementation(() => undefined);
    pass.render(renderer as unknown as T.WebGLRenderer, sentinel, source);
    expect(pass.diagnostics().pending).toBe(true);
    expect(renderer.autoClear).toBe(false);
    expect(renderer.setRenderTarget).toHaveBeenLastCalledWith(sentinel, 2, 1);
    const ev = pass.adaptation.ev;
    pass.prepare(4, 'day:pod:0:0', 1, true);
    resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(pass.adaptation.ev).toBe(ev);
    expect(pass.adaptation.samples).toBe(0);
    expect(pass.diagnostics().pending).toBe(false);
    expect(pass.failedReads).toBe(0);
    pass.dispose();
    sentinel.dispose();
    source.dispose();
  });
});

describe('27H.5 localized haze and paused reflection ownership', () => {
  it('keeps a narrow distant haze pocket visible, symmetric and close to dense integration', () => {
    const p = { x: 137, z: 0, radius: 80, floor: 0, scaleHeight: 5 };
    for (const [start, end, height] of [
      [-2500, 1800, 0],
      [-100, 240, 3],
      [130, 3800, 8],
      [-2600, 3800, 20],
    ]) {
      const from = new T.Vector3(start, height, 0),
        to = new T.Vector3(end, height, 0);
      let reference = 0;
      const samples = 20000;
      for (let i = 0; i < samples; i++)
        reference +=
          (pocketDensity(p, start + ((end - start) * (i + 0.5)) / samples, height, 0) *
            (end - start)) /
          samples;
      const value = fogSegmentIntegral([p], from, to);
      expect(value).toBeGreaterThan(0);
      expect(Math.abs(value - reference) / reference).toBeLessThan(0.012);
      expect(fogSegmentIntegral([p], to, from)).toBeCloseTo(value, 9);
    }
    expect(fogSegmentIntegral([p], new T.Vector3(), new T.Vector3())).toBe(0);
    expect(
      fogSegmentIntegral([p], new T.Vector3(-100, 0, 1000), new T.Vector3(100, 0, 1000)),
    ).toBeLessThan(1e-20);
    expect(() => fogSegmentIntegral([p], new T.Vector3(NaN, 0, 0), new T.Vector3())).toThrow();
    expect(() =>
      fogSegmentIntegral([{ ...p, radius: 0 }], new T.Vector3(), new T.Vector3()),
    ).toThrow();
  });
  it('refreshes a changed lighting environment while paused and retries failures without publishing them', () => {
    const reflection = new ReflectionSystem(),
      scene = new T.Scene(),
      car = new T.Group(),
      material = new T.MeshStandardMaterial();
    const renderer = {
      shadowMap: { autoUpdate: true },
      xr: { enabled: false },
      getRenderTarget: () => null,
      getActiveCubeFace: () => 0,
      getActiveMipmapLevel: () => 0,
      getViewport: (v: T.Vector4) => v.set(0, 0, 100, 100),
      getScissor: (v: T.Vector4) => v.set(0, 0, 100, 100),
      getScissorTest: () => false,
      setRenderTarget: vi.fn(),
      setViewport: vi.fn(),
      setScissor: vi.fn(),
      setScissorTest: vi.fn(),
    } as unknown as T.WebGLRenderer;
    const update = vi.spyOn(T.CubeCamera.prototype, 'update').mockImplementation(() => undefined);
    const day = new T.Texture(),
      night = new T.Texture();
    scene.environment = day;
    reflection.beginFrame(10, false);
    reflection.updateProbe(renderer, scene, car, [material], true);
    const completed = material.envMap;
    scene.environmentIntensity = 0.8;
    reflection.updateProbe(renderer, scene, car, [material], true);
    expect(update).toHaveBeenCalledTimes(1);
    scene.environment = night;
    update.mockImplementationOnce(() => {
      throw new Error('capture failure');
    });
    expect(() => reflection.updateProbe(renderer, scene, car, [material], true)).toThrow(
      'capture failure',
    );
    expect(material.envMap).toBe(completed);
    expect(car.visible).toBe(true);
    expect(reflection.probeUpdates).toBe(1);
    reflection.updateProbe(renderer, scene, car, [material], true);
    expect(reflection.probeUpdates).toBe(2);
    expect(material.envMap).not.toBe(completed);
    reflection.updateProbe(renderer, scene, car, [material], true);
    expect(reflection.probeUpdates).toBe(2);
    reflection.dispose();
    material.dispose();
    day.dispose();
    night.dispose();
  });
});
