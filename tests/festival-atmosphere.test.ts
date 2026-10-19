import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { LocalAtmosphere } from '../src/rendering/local-atmosphere.ts';
import { lightingDirection } from '../src/rendering/daylight.ts';
import {
  FESTIVAL_ATMOSPHERE,
  FestivalAtmosphere,
} from '../src/rendering/open-world/festival-atmosphere.ts';
import { terrainMaterial } from '../src/rendering/open-world/terrain-material.ts';
import { installSeaWaves } from '../src/rendering/sea.ts';
import {
  AERIAL_PERSPECTIVE_FRAGMENT,
  aerialAmount,
  aerialUniforms,
} from '../src/rendering/studio/aerial-perspective.ts';
import { studioUniforms } from '../src/rendering/studio/studio-frame.ts';
import { Track } from '../src/simulation/track.ts';

const renderer = {} as T.WebGLRenderer;
function shaderFor(id: 'standard' | 'physical' | 'phong' | 'lambert' = 'standard') {
  const source = T.ShaderLib[id];
  return {
    uniforms: T.UniformsUtils.clone(source.uniforms),
    vertexShader: source.vertexShader,
    fragmentShader: source.fragmentShader,
  } as unknown as T.WebGLProgramParametersWithUniforms;
}

function amount(atmosphere: FestivalAtmosphere, from: T.Vector3, to: T.Vector3) {
  return aerialAmount(
    from,
    to,
    atmosphere.uniforms.apexAerialExtinction.value.y,
    atmosphere.uniforms,
  );
}

describe('Festival aerial perspective', () => {
  it('keeps the near road clear while separating coastal valleys from higher ridges', () => {
    const atmosphere = new FestivalAtmosphere(0);
    atmosphere.update(18, 0, 0, 'day');
    const eye = new T.Vector3(0, 20, 0);
    const at = (distance: number, height = 20) =>
      amount(atmosphere, eye, new T.Vector3(distance, height, 0));
    expect(at(15)).toBeLessThan(0.002);
    expect(at(80)).toBeLessThan(0.01);
    expect(at(150)).toBeLessThan(0.02);
    expect(at(1800)).toBeGreaterThan(0.12);
    expect(at(1800)).toBeGreaterThan(at(1800, 600) * 1.5);
    expect(at(5000, 650)).toBeGreaterThan(at(1800, 600));
    expect(at(5000, 650)).toBeLessThan(0.35);
    expect(at(0)).toBe(0);
    atmosphere.dispose();
  });

  it('uses the region datum and the actual photo-camera sightline continuously', () => {
    const coast = new FestivalAtmosphere(0);
    const raised = new FestivalAtmosphere(130);
    coast.update(18, 0, 0, 'day');
    raised.update(18, 0, 0, 'day');
    const eye = new T.Vector3(0, 330, 0);
    const valley = new T.Vector3(2500, 20, 0);
    const ridge = new T.Vector3(2500, 650, 0);
    expect(amount(coast, eye, valley)).toBeGreaterThan(amount(coast, eye, ridge));
    expect(amount(coast, eye, valley)).toBeCloseTo(amount(coast, valley, eye), 12);
    const offset = new T.Vector3(0, 130, 0);
    expect(amount(raised, eye.clone().add(offset), valley.clone().add(offset))).toBeCloseTo(
      amount(coast, eye, valley),
      12,
    );
    for (const rise of [-0.001, 0, 0.001])
      expect(amount(coast, eye, new T.Vector3(1800, eye.y + rise, 0))).toBeCloseTo(
        amount(coast, eye, new T.Vector3(1800, eye.y, 0)),
        6,
      );
    expect(() => new FestivalAtmosphere(NaN)).toThrow(/datum/);
    coast.dispose();
    raised.dispose();
  });

  it('follows sunset/overcast/rain and keeps wet highland nights in the same weather', () => {
    const atmosphere = new FestivalAtmosphere(0);
    const palette = {
      antiSun: [0.08, 0.1, 0.16],
      sunSide: [0.65, 0.3, 0.19],
      overcast: [0.21, 0.22, 0.24],
    };
    atmosphere.update(22, 0, 0, 'sunset', palette);
    const glow = atmosphere.uniforms.apexAerialSunGlow.value;
    expect(glow.x).toBeCloseTo(0.57, 12);
    expect(glow.x).toBeGreaterThan(glow.z * 10);
    expect(
      atmosphere.sunDirection.value.distanceTo(lightingDirection('sunset').clone().normalize()),
    ).toBeLessThan(1e-12);
    atmosphere.update(38, 1, 0, 'day', palette);
    expect(glow.length()).toBe(0);
    const eye = new T.Vector3(0, 900, 0);
    const road = new T.Vector3(1000, 900, 0);
    const dry = amount(atmosphere, eye, road);
    atmosphere.update(38, 1, 24, 'night', palette);
    expect(glow.length()).toBe(0);
    expect(atmosphere.uniforms.apexAerialFalloff.value.y).toBeCloseTo(
      1 / FESTIVAL_ATMOSPHERE.wetScaleHeight,
      12,
    );
    expect(amount(atmosphere, eye, road)).toBeGreaterThan(0.4);
    expect(amount(atmosphere, eye, road)).toBeGreaterThan(dry * 4);
    // Rain closes distance without hiding the illuminated stretch ahead.
    expect(amount(atmosphere, eye, new T.Vector3(20, 900, 0))).toBeLessThan(0.03);
    atmosphere.dispose();
  });

  it('never changes the circuit atmosphere or the shared studio sun direction', () => {
    const air = aerialUniforms.apexAerialExtinction.value.clone();
    const falloff = aerialUniforms.apexAerialFalloff.value.clone();
    const glow = aerialUniforms.apexAerialSunGlow.value.clone();
    const sun = studioUniforms.studioSunDir.value.clone();
    const atmosphere = new FestivalAtmosphere(90);
    atmosphere.update(38, 1, 60, 'night');
    expect(aerialUniforms.apexAerialExtinction.value.equals(air)).toBe(true);
    expect(aerialUniforms.apexAerialFalloff.value.equals(falloff)).toBe(true);
    expect(aerialUniforms.apexAerialSunGlow.value.equals(glow)).toBe(true);
    expect(studioUniforms.studioSunDir.value.equals(sun)).toBe(true);
    atmosphere.dispose();
  });
});

describe('Festival material integration', () => {
  it.each(['standard', 'physical', 'phong', 'lambert'] as const)(
    'installs one analytic fog term after deformation on the real %s shader',
    (kind) => {
      const atmosphere = new FestivalAtmosphere(0);
      const material =
        kind === 'physical'
          ? new T.MeshPhysicalMaterial()
          : kind === 'phong'
            ? new T.MeshPhongMaterial()
            : kind === 'lambert'
              ? new T.MeshLambertMaterial()
              : terrainMaterial();
      if (material instanceof T.MeshPhysicalMaterial) installSeaWaves(material);
      const originalKey = material.customProgramCacheKey();
      const version = material.version;
      expect(atmosphere.installMaterial(material)).toBe(true);
      expect(atmosphere.installMaterial(material)).toBe(false);
      expect(material.version).toBe(version + 1);
      expect(material.customProgramCacheKey()).toBe(`${originalKey}|festival-atmosphere-v1`);
      const shader = shaderFor(kind);
      material.onBeforeCompile(shader, renderer);
      expect(shader.fragmentShader.match(/vec3 apexAerialPerspective\(/g)).toHaveLength(1);
      expect(shader.vertexShader.match(/varying vec3 vApexFogWorld;/g)).toHaveLength(1);
      expect(shader.fragmentShader).toContain(AERIAL_PERSPECTIVE_FRAGMENT);
      // The integral receives the final batched/instanced/skinned position,
      // rather than the undeformed source vertex or the tile's local height.
      expect(shader.vertexShader.indexOf('vec4 festivalFogPosition =')).toBeGreaterThan(
        shader.vertexShader.indexOf('#include <skinning_vertex>'),
      );
      expect(shader.vertexShader).toContain('batchingMatrix * festivalFogPosition');
      expect(shader.vertexShader).toContain('instanceMatrix * festivalFogPosition');
      expect(shader.vertexShader).toContain('modelMatrix * festivalFogPosition');
      expect(shader.uniforms.apexAerialFalloff).toBe(atmosphere.uniforms.apexAerialFalloff);
      expect(shader.uniforms.studioSunDir).toBe(atmosphere.sunDirection);
      if (kind === 'standard') expect(shader.fragmentShader).toContain('float owRoughness;');
      if (kind === 'physical') expect(shader.fragmentShader).toContain('vec3 seaSum =');
      material.dispose();
      atmosphere.dispose();
    },
  );

  it('leaves unlit guidance, no-fog emissives and depth passes untouched', () => {
    const atmosphere = new FestivalAtmosphere(0);
    const materials = [
      new T.MeshBasicMaterial(),
      new T.MeshStandardMaterial({ fog: false }),
      new T.MeshDepthMaterial(),
      new T.ShaderMaterial(),
      new T.PointsMaterial(),
    ];
    for (const material of materials) {
      const hook = material.onBeforeCompile;
      const version = material.version;
      expect(atmosphere.installMaterial(material)).toBe(false);
      expect(material.onBeforeCompile).toBe(hook);
      expect(material.version).toBe(version);
      material.dispose();
    }
    atmosphere.dispose();
  });

  it('preserves an existing local-atmosphere integral and its scene uniforms', () => {
    const material = new T.MeshStandardMaterial();
    const existing = new LocalAtmosphere(new Track());
    existing.installMaterial(material);
    const atmosphere = new FestivalAtmosphere(120);
    atmosphere.installMaterial(material);
    const shader = shaderFor();
    material.onBeforeCompile(shader, renderer);
    expect(shader.fragmentShader.match(/vec3 apexAerialPerspective\(/g)).toHaveLength(1);
    expect(shader.fragmentShader.match(/apexAerialPerspective\(gl_FragColor.rgb/g)).toHaveLength(1);
    expect(shader.uniforms.apexAerialFalloff).toBe(aerialUniforms.apexAerialFalloff);
    expect(shader.uniforms.apexLocalSigma).toBe(existing.sigma);
    expect(shader.vertexShader).not.toContain('festivalFogPosition');
    material.dispose();
    atmosphere.dispose();
  });

  it('installs arriving vegetation subtrees once and releases stream listeners on disposal', () => {
    const atmosphere = new FestivalAtmosphere(0);
    const root = new T.Group();
    atmosphere.watch(root);
    atmosphere.watch(root);
    const material = new T.MeshStandardMaterial();
    const version = material.version;
    const geometry = new T.BoxGeometry();
    for (let i = 0; i < 3; i++) {
      const tile = new T.Group();
      tile.add(new T.InstancedMesh(geometry, material, 2));
      root.add(tile);
    }
    expect(material.version).toBe(version + 1);
    const shader = shaderFor();
    material.onBeforeCompile(shader, renderer);
    expect(shader.uniforms.apexAerialExtinction).toBe(atmosphere.uniforms.apexAerialExtinction);
    atmosphere.dispose();
    const later = new T.MeshStandardMaterial();
    const laterVersion = later.version;
    root.add(new T.Mesh(geometry, later));
    expect(later.version).toBe(laterVersion);
    root.traverse((node) => {
      if (node instanceof T.InstancedMesh) node.dispose();
    });
    material.dispose();
    later.dispose();
    geometry.dispose();
  });
});
