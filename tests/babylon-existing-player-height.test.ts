import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import type { AssetContainer } from '@babylonjs/core/assetContainer.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import {
  decodeExistingPlayerBytes,
  existingPlayerPrimitiveBindings,
  loadExistingPlayer,
} from '../src/engine/babylon/existing-player.ts';
import {
  createExistingPlayerHeightAdapter,
  EXISTING_PLAYER_HEIGHT_SOURCES,
} from '../src/engine/babylon/existing-player-height.ts';

describe('source-bound experimental scalar heights (NullEngine, not pixel proof)', () => {
  let engine: NullEngine, scene: Scene, container: AssetContainer, raw: Uint8Array<ArrayBuffer>;
  beforeAll(async () => {
    raw = await decodeExistingPlayerBytes(
      new Uint8Array(readFileSync('public/models/supplied-player.glb.gz')),
      new AbortController().signal,
    );
    engine = new NullEngine();
    scene = new Scene(engine);
    scene.useRightHandedSystem = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(raw)),
    );
    try {
      container = await loadExistingPlayer(
        scene,
        'https://example.invalid/',
        new AbortController().signal,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
  afterAll(() => {
    container?.dispose();
    scene?.dispose();
    engine?.dispose();
  });
  it('rejects corrupted bytes and missing identity before installing any plugins', async () => {
    const changed = raw.slice();
    changed[100] ^= 1;
    await expect(
      createExistingPlayerHeightAdapter(changed, existingPlayerPrimitiveBindings(container)),
    ).rejects.toThrow('integrity');
    await expect(createExistingPlayerHeightAdapter(raw, [])).rejects.toThrow('source/material');
    expect(
      container.materials.every(
        (m) => !m.pluginManager?.getPlugin('ExistingPlayerScalarHeightProbe'),
      ),
    ).toBe(true);
  });
  it('rejects a wrong-slot texture even when the embedded image is shared', async () => {
    const bindings = existingPlayerPrimitiveBindings(container);
    const first = bindings.find(({ source }) => source.material === 74)!.mesh
      .material as PBRMaterial;
    const other = bindings.find(({ source }) => source.material === 81)!.mesh
      .material as PBRMaterial;
    const original = first.bumpTexture;
    first.bumpTexture = other.bumpTexture;
    try {
      await expect(createExistingPlayerHeightAdapter(raw, bindings)).rejects.toThrow(
        'linear source texture',
      );
      expect(
        container.materials.every(
          (m) => !m.pluginManager?.getPlugin('ExistingPlayerScalarHeightProbe'),
        ),
      ).toBe(true);
    } finally {
      first.bumpTexture = original;
    }
  });
  it('rejects missing or unknown allocation metadata instead of claiming linear sampling', async () => {
    const bindings = existingPlayerPrimitiveBindings(container);
    const material = bindings.find(({ source }) => source.material === 74)!.mesh
      .material as PBRMaterial;
    const texture = material.bumpTexture!;
    const internal = texture.getInternalTexture()!;
    expect(internal._useSRGBBuffer).toBe(false);
    for (const value of [undefined, true]) {
      const original = Object.getOwnPropertyDescriptor(internal, '_useSRGBBuffer')!;
      Object.defineProperty(internal, '_useSRGBBuffer', { ...original, value });
      try {
        await expect(createExistingPlayerHeightAdapter(raw, bindings)).rejects.toThrow(
          'linear source texture',
        );
      } finally {
        Object.defineProperty(internal, '_useSRGBBuffer', original);
      }
    }
    const missing = vi.spyOn(texture, 'getInternalTexture').mockReturnValue(null);
    try {
      await expect(createExistingPlayerHeightAdapter(raw, bindings)).rejects.toThrow(
        'linear source texture',
      );
    } finally {
      missing.mockRestore();
    }
    expect(
      container.materials.every(
        (m) => !m.pluginManager?.getPlugin('ExistingPlayerScalarHeightProbe'),
      ),
    ).toBe(true);
  });
  it('rejects installation after material preparation without touching resources', async () => {
    const bindings = existingPlayerPrimitiveBindings(container);
    const material = bindings.find(({ source }) => source.material === 74)!.mesh
      .material as PBRMaterial;
    const previous = material._uniformBufferLayoutBuilt;
    material._uniformBufferLayoutBuilt = true;
    try {
      await expect(createExistingPlayerHeightAdapter(raw, bindings)).rejects.toThrow(
        'source/material',
      );
    } finally {
      material._uniformBufferLayoutBuilt = previous;
    }
  });
  it('borrows exactly ten source textures without altering data, true normals or owner resources', async () => {
    const bindings = existingPlayerPrimitiveBindings(container);
    const resources = [
      ...container.meshes,
      ...container.materials,
      ...container.textures,
      ...container.skeletons,
    ];
    const snapshots = container.materials.map((m) => {
      const p = m as PBRMaterial;
      return {
        m,
        texture: p.bumpTexture,
        matrix: p.bumpTexture?.getTextureMatrix().asArray().slice(),
        gamma: p.bumpTexture?.gammaSpace,
      };
    });
    const adapter = await createExistingPlayerHeightAdapter(raw, bindings);
    expect(adapter.scales).toEqual([...Array(8).fill(0.00015), 0.0004, 0.0004]);
    expect(adapter.materials).toHaveLength(10);
    for (const [index, entry] of EXISTING_PLAYER_HEIGHT_SOURCES.entries()) {
      expect(bindings.find(({ source }) => source.material === entry.material)?.mesh.material).toBe(
        adapter.materials[index],
      );
      const plugin = adapter.materials[index].pluginManager!.getPlugin(
        'ExistingPlayerScalarHeightProbe',
      )!;
      expect((plugin as unknown as { enabled: boolean }).enabled).toBe(false);
      expect(plugin.isCompatible(0)).toBe(true);
      expect(plugin.isCompatible(1)).toBe(false);
    }
    adapter.setEnabled(true);
    adapter.setEnabled(false);
    adapter.setEnabled(true);
    await expect(createExistingPlayerHeightAdapter(raw, bindings)).rejects.toThrow(
      'source/material',
    );
    adapter.dispose();
    adapter.dispose();
    expect(() => adapter.setEnabled(true)).toThrow('disposed');
    expect([
      ...container.meshes,
      ...container.materials,
      ...container.textures,
      ...container.skeletons,
    ]).toEqual(resources);
    for (const { m, texture, matrix, gamma } of snapshots) {
      expect((m as PBRMaterial).bumpTexture).toBe(texture);
      expect(texture?.getTextureMatrix().asArray()).toEqual(matrix);
      expect(texture?.gammaSpace).toBe(gamma);
      if (!adapter.materials.includes(m as PBRMaterial))
        expect(m.pluginManager?.getPlugin('ExistingPlayerScalarHeightProbe')).toBeFalsy();
    }
  });
});
