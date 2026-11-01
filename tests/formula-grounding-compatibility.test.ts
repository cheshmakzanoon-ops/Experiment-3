import { afterEach, describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import {
  createStudioUniforms,
  STUDIO_UNIFORM_NAMES,
  StudioFrame,
  studioUniforms,
  type StudioUniforms,
} from '../src/rendering/studio/studio-frame.ts';
import { installCarGrounding } from '../src/rendering/studio/car-grounding.ts';
import { surfaceMaterial } from '../src/rendering/surface-detail.ts';
import { installCircuitFinish } from '../src/rendering/circuit-finish.ts';
import { studioHookKeys } from '../src/rendering/studio/shader-hooks.ts';
import {
  arrayBytes,
  decodeFloat32,
  groundingOracle,
  groundingOracleBytes,
  GROUNDING_ORACLE_SHA256,
  sha256,
  type GroundingArrayOracle,
} from './fixtures/formula-grounding-oracle.ts';

function expectBytes(actual: Float64Array, saved: GroundingArrayOracle) {
  expect(actual.constructor.name).toBe(saved.type);
  expect(actual.length).toBe(saved.length);
  const expected = Buffer.from(saved.bytes, 'base64');
  expect(sha256(expected)).toBe(saved.sha256);
  expect(sha256(arrayBytes(actual))).toBe(saved.sha256);
  expect(Buffer.compare(arrayBytes(actual), expected)).toBe(0);
}
function uniformValues(uniforms: StudioUniforms) {
  const result: number[] = [];
  for (const name of STUDIO_UNIFORM_NAMES) {
    const value = uniforms[name].value;
    for (const item of Array.isArray(value) ? value : [value])
      if (typeof item === 'number') result.push(item);
      else result.push(...item.toArray());
  }
  return new Float64Array(result);
}
function rig() {
  const camera = new T.PerspectiveCamera(58, 16 / 9, 0.045, 7000);
  const sun = new T.DirectionalLight();
  const scene = new T.Scene();
  scene.add(camera, sun, sun.target);
  sun.position.set(-140, 235, -115);
  camera.position.set(3.25, 1.2, -6);
  camera.lookAt(3.25, 0.5, 14);
  camera.updateProjectionMatrix();
  scene.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  return { camera, sun, scene };
}

it('pins the independently captured original source and installed factory oracle', () => {
  expect(sha256(groundingOracleBytes)).toBe(GROUNDING_ORACLE_SHA256);
  expect(groundingOracle.sourceCommit).toBe('2041020089bf2d2164e1f7c7df3e6a3620d71088');
  expect(groundingOracle.captureScriptSha256).toBe(
    '25192b0e1924097fa577513b0a410a3c3dc638ea0668e6d33eef9073cc476691',
  );
  expect(groundingOracle.threeRevision).toBe(T.REVISION);
  expect(Object.keys(groundingOracle.sourceFiles)).toHaveLength(21);
  expect(groundingOracle.cases).toHaveLength(21);
  expect(groundingOracle.cases.reduce((n, c) => n + c.observations.length, 0)).toBe(40);
  expect(groundingOracle.factories).toHaveLength(3);
});

describe('actual original StudioFrame: exact full uniform/history bytes', () => {
  for (const scenario of groundingOracle.cases) {
    it(scenario.name, () => {
      const frame = new StudioFrame(createStudioUniforms());
      const { camera, sun, scene } = rig();
      for (const saved of scenario.observations) {
        if (saved.reset) frame.reset();
        else {
          if (saved.aspect !== undefined) {
            camera.aspect = saved.aspect;
            camera.updateProjectionMatrix();
          }
          if (saved.cameraX !== undefined) {
            camera.position.x = saved.cameraX;
            camera.lookAt(saved.cameraX, 0.5, 14);
            scene.updateMatrixWorld(true);
            camera.updateMatrixWorld(true);
          }
          const input = decodeFloat32(saved.input!);
          const before = Buffer.from(arrayBytes(input));
          let error = null;
          try {
            frame.update(input, camera, sun, saved.view!);
          } catch (failure) {
            expect(failure).toBeInstanceOf(Error);
            const caught = failure as Error;
            error = { name: caught.name, message: caught.message };
          }
          expect(error).toEqual(saved.error);
          expect(Buffer.compare(arrayBytes(input), before)).toBe(0);
        }
        expectBytes(uniformValues(frame.uniforms), saved.result.uniforms);
        expectBytes(
          new Float64Array(frame.uniforms.studioCarPose.value.flatMap((v) => v.toArray())),
          saved.result.poses,
        );
        // JSON diagnostics intentionally have JSON's nonfinite representation;
        // the separate byte comparisons above retain actual NaN/Infinity/-0 bits.
        expect(JSON.parse(JSON.stringify(frame.diagnostics()))).toEqual(saved.result.diagnostics);
      }
    });
  }
});

// Record actual factory ImageData uploads. No texture factory, shader hook or
// material implementation is substituted; this is not a GPU execution claim.
class RecordedCanvas {
  width = 300;
  height = 150;
  pixels: Uint8ClampedArray | undefined;
  getContext() {
    return {
      canvas: this,
      createImageData: (width: number, height: number) => ({
        data: new Uint8ClampedArray(width * height * 4),
      }),
      putImageData: (image: { data: Uint8ClampedArray }) => {
        this.pixels = image.data.slice();
      },
    };
  }
}
afterEach(() => vi.unstubAllGlobals());
function texture(value: T.Texture | null) {
  if (!value) return null;
  const image = value.image as RecordedCanvas;
  return {
    name: value.name,
    width: image.width,
    height: image.height,
    pixelSha256: sha256(arrayBytes(image.pixels!)),
    colorSpace: value.colorSpace,
    wrapS: value.wrapS,
    wrapT: value.wrapT,
    repeat: value.repeat.toArray(),
    flipY: value.flipY,
    anisotropy: value.anisotropy,
    minFilter: value.minFilter,
    magFilter: value.magFilter,
  };
}
describe('actual original factory plus installed grounding hook', () => {
  for (const saved of groundingOracle.factories) {
    it(saved.name, () => {
      vi.stubGlobal('document', { createElement: () => new RecordedCanvas() });
      const material = saved.name.includes('edge-paint')
        ? new T.MeshStandardMaterial({ color: 0xe9e7e0, roughness: 0.55 })
        : surfaceMaterial('asphalt', undefined, saved.name.includes('water-film'));
      const textures = new Set([material.map, material.roughnessMap, material.normalMap]);
      try {
        if (saved.name.includes('edge-paint')) installCircuitFinish(material, 'paint');
        expect(installCarGrounding(material)).toBe(saved.firstInstall);
        expect(installCarGrounding(material)).toBe(saved.repeatInstall);
        const shader = {
          uniforms: {} as Record<string, T.IUniform>,
          vertexShader: T.ShaderLib.physical.vertexShader,
          fragmentShader: T.ShaderLib.physical.fragmentShader,
        } as unknown as T.WebGLProgramParametersWithUniforms;
        material.onBeforeCompile(shader, {} as T.WebGLRenderer);
        const physical = material as Partial<T.MeshPhysicalMaterial>;
        expect({
          type: material.type,
          color: material.color.toArray(),
          roughness: material.roughness,
          metalness: material.metalness,
          clearcoat: physical.clearcoat ?? null,
          clearcoatRoughness: physical.clearcoatRoughness ?? null,
          normalScale: material.normalScale.toArray(),
          normalMapType: material.normalMapType,
          hookKeys: studioHookKeys(material),
          cacheKey: material.customProgramCacheKey(),
          textures: {
            map: texture(material.map),
            roughnessMap: texture(material.roughnessMap),
            normalMap: texture(material.normalMap),
          },
        }).toEqual(saved.material);
        expect(shader.vertexShader).toBe(saved.shader.vertexShader);
        expect(shader.fragmentShader).toBe(saved.shader.fragmentShader);
        expect(sha256(shader.vertexShader)).toBe(saved.shader.vertexSha256);
        expect(sha256(shader.fragmentShader)).toBe(saved.shader.fragmentSha256);
        expect(Object.keys(shader.uniforms)).toEqual(saved.shader.uniformNames);
        for (const uniform of saved.shader.sharedGroundUniforms) {
          expect(uniform.shared).toBe(true);
          expect(shader.uniforms[uniform.name]).toBe(
            studioUniforms[uniform.name as keyof StudioUniforms],
          );
        }
      } finally {
        for (const value of textures) value?.dispose();
        material.dispose();
      }
    });
  }
});
