import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  GP_SUIT_MAX_FOLD,
  installGpSuitFinish,
  shapeGpSuitGeometry,
  type GpSuitRegion,
} from '../src/rendering/gp-rider-suit.ts';
import { Rider } from '../src/rendering/rider.ts';
import { gpRiderStance } from '../src/rendering/gp-rider-motion.ts';
import { BikeMaterials, BikeModel } from '../src/rendering/bike.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { studioHookKeys } from '../src/rendering/studio/shader-hooks.ts';
import { tagWeatherSurface, WeatherPresentation } from '../src/rendering/weather-presentation.ts';

beforeAll(() => {
  const context = new Proxy(
    {},
    {
      get: (_, key) => (key === 'measureText' ? () => ({ width: 10 }) : () => undefined),
      set: () => true,
    },
  );
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  });
});
afterAll(() => vi.unstubAllGlobals());

const colours = { primary: 0xc12437, secondary: 0x18212a, accent: 0xf2e9d7 };
function inventory(root: T.Object3D) {
  const materials = new Set<T.Material>(),
    textures = new Set<T.Texture>();
  let triangles = 0,
    meshes = 0;
  root.traverse((object) => {
    if (!(object instanceof T.Mesh)) return;
    meshes++;
    triangles +=
      ((object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3) *
      (object instanceof T.InstancedMesh ? object.count : 1);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material))
        if (value instanceof T.Texture) textures.add(value);
    }
  });
  return { triangles, meshes, materials, textures };
}

describe('GP fitted racing leathers', () => {
  it.each(['torso', 'upper-arm', 'forearm', 'thigh', 'shin'] as GpSuitRegion[])(
    '%s folds preserve topology, metre bounds, joins and smooth UV seams',
    (region) => {
      const a = new T.CylinderGeometry(0.07, 0.095, 0.48, 20, 24, true),
        b = a.clone(),
        before = a.clone();
      shapeGpSuitGeometry(a, region);
      shapeGpSuitGeometry(b, region);
      expect(a.index!.array).toEqual(before.index!.array);
      expect(a.getAttribute('uv').array).toEqual(before.getAttribute('uv').array);
      expect(a.getAttribute('position').array).toEqual(b.getAttribute('position').array);
      expect(Object.keys(a.attributes)).toEqual(Object.keys(before.attributes));
      const old = before.getAttribute('position'),
        position = a.getAttribute('position'),
        normal = a.getAttribute('normal'),
        uv = a.getAttribute('uv');
      let changed = 0;
      for (let i = 0; i < position.count; i++) {
        const distance = Math.hypot(position.getX(i) - old.getX(i), position.getZ(i) - old.getZ(i));
        expect(distance).toBeLessThanOrEqual(GP_SUIT_MAX_FOLD + 1e-7);
        expect(position.getY(i)).toBe(old.getY(i));
        expect(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i))).toBeCloseTo(1, 5);
        if (uv.getY(i) <= 0.08 || uv.getY(i) >= 0.96) expect(distance).toBe(0);
        if (distance > 1e-6) changed++;
      }
      expect(changed).toBeGreaterThan(20);
      for (let row = 0; row <= 24; row++) {
        const first = row * 21,
          last = first + 20;
        expect(
          new T.Vector3()
            .fromBufferAttribute(normal, first)
            .distanceTo(new T.Vector3().fromBufferAttribute(normal, last)),
        ).toBeLessThan(1e-6);
      }
      for (const geometry of [a, b, before]) geometry.dispose();
    },
  );

  it('retains bike contacts, recovery poses and the original topology/material budget', () => {
    for (const detail of ['high', 'mid', 'far'] as const) {
      const legacy = new Rider(colours, detail),
        gp = new Rider(colours, detail, 'leathers', 2, true);
      const a = inventory(legacy.root),
        b = inventory(gp.root);
      // Continuous GP skins replace the capped segments and overlapping
      // joint patches; keep the original cost ceiling as topology improves.
      expect(b.triangles).toBeLessThanOrEqual(a.triangles);
      expect(b.meshes).toBeLessThanOrEqual(a.meshes);
      expect(b.materials.size).toBe(a.materials.size);
      expect(b.textures.size).toBe(a.textures.size - (detail === 'far' ? 0 : 2));
      const anchors = (rider: Rider) => {
        rider.root.updateMatrixWorld(true);
        return {
          contacts: [rider.seat, ...rider.grips, ...rider.pegs].map((v) => v.toArray()),
          torso: rider.root.getObjectByName('Rider torso')!.matrixWorld.elements,
          helmet: rider.root.getObjectByName('Rider head and helmet')!.matrixWorld.elements,
        };
      };
      for (const lean of [-1, 0, 1]) {
        const pose = { lean, offset: lean * 0.18, tuck: 0.7, braking: 0.65, steer: 0.12 };
        legacy.ride(pose);
        gp.ride(pose);
        // GP wrists/ankles now target the anatomical joint behind each held
        // contact. Their limb lengths and actual mesh contact have a separate
        // production-model contract in gp-rider-contact.test.ts.
        expect(anchors(gp).contacts).toEqual(anchors(legacy).contacts);
        // The seat anchor is shared; the GP pelvis follows its own authored
        // racing stance (deeper hang-off, low tuck) from that same anchor.
        const stance = gpRiderStance(pose, { x: 0, y: 0, z: 0, pitch: 0, into: 0, yaw: 0 });
        expect(
          gp.root
            .getObjectByName('Rider torso')!
            .position.distanceTo(gp.seat.clone().add(new T.Vector3(stance.x, stance.y, stance.z))),
        ).toBeLessThan(1e-12);
      }
      for (const phase of [0, 1, 2]) {
        legacy.separated(phase, 0.75, 2);
        gp.separated(phase, 0.75, 2);
        expect(anchors(gp)).toEqual(anchors(legacy));
        // Recovery changes only the GP foot's attachment and calf cuff.
        // Preserve the existing torso and limb trajectories for every kit.
        expect(
          gp.root.children
            .filter((child) => child instanceof T.Group)
            .filter((child) => child.name !== 'GP lumbar spine' && child.name !== 'GP upper chest')
            .map((child) => child.matrixWorld.elements),
        ).toEqual(
          legacy.root.children
            .filter((child) => child instanceof T.Group)
            .map((child) => child.matrixWorld.elements),
        );
      }
      legacy.dispose();
      gp.dispose();
    }
  });

  it.each(['gpr1', 'gpr2', 'sbk1000', 'ss600', 'cr750'])(
    'production %s opts into the GP suit only for GP prototypes',
    (id) => {
      const materials = new BikeMaterials(0),
        model = new BikeModel(VEHICLES[id], 0, 'high', materials, true),
        gp = id === 'gpr1' || id === 'gpr2',
        inspected = inventory(model.rider.root);
      expect(model.rider.gp).toBe(gp);
      expect(
        [...inspected.materials].some((material) =>
          studioHookKeys(material).some((key) => key.startsWith('gp-suit-')),
        ),
      ).toBe(gp);
      expect(model.rider.raceNumber).toBe(2);
      if (gp) expect(inventory(model.root).triangles).toBeLessThan(110000);
      model.dispose();
      materials.dispose();
    },
  );

  it('keeps clone installation honest, filters fine detail and composes wet roughness last', () => {
    const material = tagWeatherSurface(new T.MeshPhysicalMaterial(), 'leather'),
      weather = new WeatherPresentation();
    installGpSuitFinish(material, true);
    const hook = material.onBeforeCompile;
    installGpSuitFinish(material, true);
    expect(material.onBeforeCompile).toBe(hook);
    const clone = material.clone();
    installGpSuitFinish(clone, true);
    weather.installMaterial(material);
    weather.installMaterial(clone);
    const shaders = [material, clone].map((m) => {
      const shader = {
        vertexShader: T.ShaderLib.physical.vertexShader,
        fragmentShader: T.ShaderLib.physical.fragmentShader,
        uniforms: T.UniformsUtils.clone(T.ShaderLib.physical.uniforms),
      };
      m.onBeforeCompile(
        shader as Parameters<T.Material['onBeforeCompile']>[0],
        {} as T.WebGLRenderer,
      );
      expect(shader.fragmentShader).toContain('1.-smoothstep(.0012,.0042,px)');
      const dry = shader.fragmentShader.indexOf(
          'roughnessFactor=clamp(roughnessFactor+gpSuitGrain',
        ),
        wet = shader.fragmentShader.indexOf(
          'roughnessFactor = mix(roughnessFactor, min(roughnessFactor,',
        );
      expect(dry).toBeGreaterThan(0);
      expect(wet).toBeGreaterThan(dry);
      expect(wet).toBeLessThan(
        shader.fragmentShader.indexOf('#include <lights_physical_fragment>'),
      );
      expect(m.map).toBeNull();
      expect(Object.keys(shader.uniforms).some((name) => /gpSuit.*Time/i.test(name))).toBe(false);
      return shader;
    });
    expect(shaders[0].vertexShader).toBe(shaders[1].vertexShader);
    expect(shaders[0].fragmentShader).toBe(shaders[1].fragmentShader);
    weather.dispose();
    material.dispose();
    clone.dispose();
  });
});
