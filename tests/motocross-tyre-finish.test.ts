import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { tyreGeometry } from '../src/rendering/bike.ts';
import { batchBikeRigidMeshes } from '../src/rendering/bike-rigid-batch.ts';
import { motocrossTread } from '../src/rendering/offroad/motocross-detail.ts';
import {
  bindMotocrossTyre,
  installMotocrossTyreFinish,
} from '../src/rendering/offroad/motocross-tyre-finish.ts';
import { installMud, mudUniforms } from '../src/rendering/offroad/mud.ts';
import type { StudioShader } from '../src/rendering/studio/shader-hooks.ts';

function compile(material: T.MeshStandardMaterial) {
  const source = T.ShaderLib.standard;
  const shader = {
    uniforms: T.UniformsUtils.clone(source.uniforms),
    vertexShader: source.vertexShader,
    fragmentShader: source.fragmentShader,
  } as StudioShader;
  material.onBeforeCompile(shader, {} as T.WebGLRenderer);
  return shader;
}

describe('recorded motocross tyre finish', () => {
  it('keeps separate front/rear observations and restores a held or rewound state exactly', () => {
    const material = new T.MeshStandardMaterial();
    const finish = installMotocrossTyreFinish(material, 0.352, 0.2667, 0.338, 0.2286);
    const a = { frontWear: 0.08, rearWear: 0.47, frontWater: 0.62, rearWater: 0 };
    const b = { frontWear: 0.1, rearWear: 0.51, frontWater: 0, rearWater: 0.83 };
    const sample = (state: typeof a) => {
      finish.update(state);
      return [...finish.front.value.toArray(), ...finish.rear.value.toArray()];
    };
    const initial = sample(a),
      changed = sample(b);
    expect(changed).not.toEqual(initial);
    expect(sample(b)).toEqual(changed);
    expect(sample(a)).toEqual(initial);
    expect(initial).toEqual([0.08, 0.62, 0.47, 0]);
    finish.update({ frontWear: NaN, rearWear: 4, frontWater: -1, rearWater: Infinity });
    expect([...finish.front.value.toArray(), ...finish.rear.value.toArray()]).toEqual([0, 0, 1, 0]);
    finish.update({});
    expect([...finish.front.value.toArray(), ...finish.rear.value.toArray()]).toEqual([0, 0, 0, 0]);
    material.dispose();
  });

  it.each([false, true])(
    'preserves the opaque mud layer regardless of install order (%s)',
    (mudFirst) => {
      const material = new T.MeshStandardMaterial(),
        mud = mudUniforms();
      if (mudFirst) installMud(material, mud);
      const finish = installMotocrossTyreFinish(material, 0.352, 0.2667, 0.338, 0.2286);
      if (!mudFirst) installMud(material, mud);
      expect(installMotocrossTyreFinish(material, 0.352, 0.2667, 0.338, 0.2286)).toBe(finish);
      const shader = compile(material),
        code = shader.fragmentShader;
      expect(shader.uniforms.mxTyreFront).toBe(finish.front);
      expect(shader.uniforms.mxTyreRear).toBe(finish.rear);
      expect(shader.uniforms.offroadMud).toBe(mud.offroadMud);
      expect(code.indexOf('diffuseColor.rgb *= (1. + scuff')).toBeLessThan(
        code.indexOf('diffuseColor.rgb = mix( diffuseColor.rgb, earth'),
      );
      expect(code.indexOf('roughnessFactor = mxTyreRoughness;')).toBeLessThan(
        code.indexOf('roughnessFactor = mix( roughnessFactor'),
      );
      expect(code.indexOf('dFdx(mxTyreHeight)')).toBeLessThan(
        code.indexOf('dFdx( offroadMudHeight )'),
      );
      expect(Object.values(material).some((value) => value instanceof T.Texture)).toBe(false);
      material.dispose();
    },
  );

  it.each(['front', 'rear'] as const)(
    '%s tread and carcass batch into one draw without losing axle coordinates or the physical envelope',
    (axle) => {
      const front = axle === 'front',
        radius = front ? 0.352 : 0.338;
      const width = front ? 0.042 : 0.06,
        rim = front ? 0.2667 : 0.2286;
      const material = new T.MeshStandardMaterial(),
        group = new T.Group();
      const carcass = bindMotocrossTyre(
        tyreGeometry(radius - 0.016, width, width * 1.15, rim + 0.012, 36),
        front,
      );
      const tread = bindMotocrossTyre(motocrossTread(radius, width, 0.016, 44, axle), front);
      const triangles = (carcass.index!.count + tread.getAttribute('position').count) / 3;
      group.add(new T.Mesh(carcass, material), new T.Mesh(tread, material));
      batchBikeRigidMeshes(group);
      const meshes: T.Mesh[] = [];
      group.traverse((object) => {
        if (object instanceof T.Mesh) meshes.push(object);
      });
      expect(meshes).toHaveLength(1);
      const geometry = meshes[0].geometry,
        position = geometry.getAttribute('position');
      const binding = geometry.getAttribute('mxTyreBind'),
        normal = geometry.getAttribute('normal');
      expect((geometry.index?.count ?? position.count) / 3).toBe(triangles);
      expect(geometry.hasAttribute('gpTyreBind')).toBe(false);
      let maximumRadius = 0;
      for (let i = 0; i < position.count; i++) {
        expect(binding.getW(i)).toBe(front ? 0 : 1);
        expect([binding.getX(i), binding.getY(i), binding.getZ(i)]).toEqual([
          position.getX(i),
          position.getY(i),
          position.getZ(i),
        ]);
        const radial = Math.hypot(position.getY(i), position.getZ(i));
        expect(radial).toBeLessThanOrEqual(radius + 1e-7);
        maximumRadius = Math.max(maximumRadius, radial);
        expect(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i))).toBeCloseTo(1, 5);
      }
      expect(maximumRadius).toBeGreaterThan(radius - 0.001);
      geometry.dispose();
      material.dispose();
    },
  );
});
