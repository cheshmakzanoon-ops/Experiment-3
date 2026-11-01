import { afterEach, describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { surfaceMaterial } from '../src/rendering/surface-detail.ts';
import { installScannedAsphalt } from '../src/rendering/ground/scanned-ground.ts';
import { studioHookKeys } from '../src/rendering/studio/shader-hooks.ts';
import {
  arrayBytes,
  compressedOracle,
  oracle,
  ORACLE_SHA256,
  sha256,
} from './fixtures/asphalt-source-oracle.ts';

// Observe the real factory's ImageData upload, not a replacement texture factory.
// This is a CPU/material-hook contract, not evidence of GPU upload or drawing.
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

function observeTexture(texture: T.Texture | null) {
  if (!texture) return null;
  const image = texture.image as RecordedCanvas;
  expect(image.pixels).toBeInstanceOf(Uint8ClampedArray);
  const pixels = image.pixels!;
  return {
    name: texture.name,
    width: image.width,
    height: image.height,
    data: {
      type: pixels.constructor.name,
      length: pixels.length,
      byteLength: pixels.byteLength,
      sha256: sha256(arrayBytes(pixels)),
    },
    colorSpace: texture.colorSpace,
    wrapS: texture.wrapS,
    wrapT: texture.wrapT,
    repeat: texture.repeat.toArray(),
    offset: texture.offset.toArray(),
    center: texture.center.toArray(),
    rotation: texture.rotation,
    flipY: texture.flipY,
    generateMipmaps: texture.generateMipmaps,
    minFilter: texture.minFilter,
    magFilter: texture.magFilter,
    anisotropy: texture.anisotropy,
    format: texture.format,
    type: texture.type,
    premultiplyAlpha: texture.premultiplyAlpha,
    unpackAlignment: texture.unpackAlignment,
  };
}

it('uses the original pre-extraction Three r180 factory oracle, not the extracted data as expected values', () => {
  expect(sha256(compressedOracle)).toBe(ORACLE_SHA256);
  expect(oracle.threeRevision).toBe(T.REVISION);
  expect(oracle.factories.map((entry) => entry.name)).toEqual([
    'asphalt-dry',
    'asphalt-water-film',
    'asphalt-paint-finish',
    'grass',
    'gravel',
    'concrete',
    'asphalt-scanned',
    'asphalt-scanned-gp',
  ]);
});

describe('original Three factory and scanned-hook compatibility after data extraction', () => {
  for (const entry of oracle.factories) {
    it(entry.name, () => {
      vi.stubGlobal('document', { createElement: () => new RecordedCanvas() });
      const material = surfaceMaterial(entry.kind, entry.finish ?? undefined, entry.waterFilm);
      const textures = new Set([
        material.map,
        material.roughnessMap,
        material.normalMap,
        material.bumpMap,
      ]);
      try {
        if (entry.scanned !== null) {
          expect(installScannedAsphalt(material, entry.scanned)).toBe(true);
          expect(installScannedAsphalt(material, entry.scanned)).toBe(false);
        }
        const physical = material as Partial<T.MeshPhysicalMaterial>;
        expect({
          type: material.type,
          color: material.color.toArray(),
          roughness: material.roughness,
          metalness: material.metalness,
          normalScale: material.normalScale.toArray(),
          normalMapType: material.normalMapType,
          bumpScale: material.bumpScale,
          side: material.side,
          transparent: material.transparent,
          opacity: material.opacity,
          depthWrite: material.depthWrite,
          depthTest: material.depthTest,
          clearcoat: physical.clearcoat ?? null,
          clearcoatRoughness: physical.clearcoatRoughness ?? null,
          ior: physical.ior ?? null,
          userData: material.userData,
          defines: 'defines' in material ? material.defines : undefined,
          hookKeys: studioHookKeys(material),
          cacheKey: material.customProgramCacheKey(),
          textures: {
            map: observeTexture(material.map),
            roughnessMap: observeTexture(material.roughnessMap),
            normalMap: observeTexture(material.normalMap),
            bumpMap: observeTexture(material.bumpMap),
          },
        }).toEqual(entry.material);
        expect([...textures].filter(Boolean)).toHaveLength(3);
        const shader = {
          uniforms: {},
          vertexShader: T.ShaderLib.physical.vertexShader,
          fragmentShader: T.ShaderLib.physical.fragmentShader,
        } as unknown as T.WebGLProgramParametersWithUniforms;
        material.onBeforeCompile(shader, {} as T.WebGLRenderer);
        expect(Object.keys(shader.uniforms)).toEqual(entry.shader.uniforms);
        expect(sha256(shader.vertexShader)).toBe(entry.shader.vertexSha256);
        expect(sha256(shader.fragmentShader)).toBe(entry.shader.fragmentSha256);
        // Entire composed source, including original rounded constants, finish,
        // normal/roughness algebra and scan cancellation. Not substring coverage.
        expect(shader.vertexShader).toBe(entry.shader.vertexShader);
        expect(shader.fragmentShader).toBe(entry.shader.fragmentShader);
      } finally {
        for (const texture of textures) texture?.dispose();
        material.dispose();
      }
    });
  }
});
