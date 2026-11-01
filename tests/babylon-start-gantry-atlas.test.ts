import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import reference from './fixtures/a07-atlas-pixels.json' with { type: 'json' };
import { START_GANTRY } from '../src/rendering/start-gantry.ts';

it('pins independent original PNG pixel oracles to the unchanged GLB material/image roles', () => {
  const raw = readFileSync('public/' + START_GANTRY.url);
  const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
  expect(sha(raw)).toBe(START_GANTRY.sha256);
  expect(reference.assetSha256).toBe(START_GANTRY.sha256);
  const length = raw.readUInt32LE(12);
  const document = JSON.parse(raw.subarray(20, 20 + length).toString());
  const material = document.materials[0];
  const roles = {
    baseColor: material.pbrMetallicRoughness.baseColorTexture.index,
    normal: material.normalTexture.index,
    metallicRoughness: material.pbrMetallicRoughness.metallicRoughnessTexture.index,
  };
  expect(material.occlusionTexture).toBeUndefined();
  expect(material.doubleSided).toBe(true);
  expect(material.normalTexture.scale).toBe(0.3499999940395355);
  for (const role of Object.keys(roles) as (keyof typeof roles)[]) {
    const expected = reference.roles[role];
    const texture = roles[role];
    const image = document.textures[texture].source;
    const view = document.bufferViews[document.images[image].bufferView];
    const start = 28 + length + (view.byteOffset ?? 0);
    const png = raw.subarray(start, start + view.byteLength);
    expect(texture, role).toBe(expected.textureIndex);
    expect(image, role).toBe(expected.imageIndex);
    expect(sha(png), role).toBe(expected.pngSha256);
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([expected.width, expected.height]);
    expect(expected.rgbaBytes).toBe(512 * 512 * 4);
    expect(expected.alphaRange).toEqual([255, 255]);
    expect(expected.rgbaSha256).toMatch(/^[a-f0-9]{64}$/);
  }
});
