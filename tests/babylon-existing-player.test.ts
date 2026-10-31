import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { decodeExistingPlayerBytes } from '../src/engine/babylon/existing-player.ts';
import manifest from '../src/rendering/supplied-player.manifest.json' with { type: 'json' };

it('accepts the exact authored model both compressed and transparently decoded, rejecting corruption in either representation', async () => {
  const signal = new AbortController().signal;
  const compressed = new Uint8Array(readFileSync('public/models/supplied-player.glb.gz'));
  const raw = await decodeExistingPlayerBytes(compressed, signal);
  expect(raw.length).toBe(manifest.bytes);
  expect(createHash('sha256').update(raw).digest('hex')).toBe(manifest.sha256);
  expect(await decodeExistingPlayerBytes(raw, signal)).toBe(raw);
  // Assert the real source rig supports the rigid wheel adapter's contract.
  const jsonLength = new DataView(raw.buffer, raw.byteOffset).getUint32(12, true);
  const document = JSON.parse(new TextDecoder().decode(raw.subarray(20, 20 + jsonLength))) as {
    nodes: { name?: string; children?: number[]; rotation?: number[]; scale?: number[] }[];
  };
  for (let i = 0; i < 4; i++) {
    const wheel = document.nodes.filter((n) => n.name === `PLAYER_WHEEL_${i}`);
    const spin = document.nodes.filter((n) => n.name === `PLAYER_SPIN_${i}`);
    expect(wheel).toHaveLength(1);
    expect(spin).toHaveLength(1);
    expect(wheel[0].children).toContain(document.nodes.indexOf(spin[0]));
    for (const node of [wheel[0], spin[0]]) {
      expect(node.rotation ?? [0, 0, 0, 1]).toEqual([0, 0, 0, 1]);
      expect(node.scale ?? [1, 1, 1]).toEqual([1, 1, 1]);
    }
  }

  compressed[compressed.length - 1] ^= 1;
  await expect(decodeExistingPlayerBytes(compressed, signal)).rejects.toThrow('integrity');
  raw[raw.length - 1] ^= 1;
  await expect(decodeExistingPlayerBytes(raw, signal)).rejects.toThrow('integrity');
});

it('rejects an already-cancelled import before decoding or attaching any asset', async () => {
  const abort = new AbortController();
  abort.abort();
  await expect(decodeExistingPlayerBytes(new Uint8Array(), abort.signal)).rejects.toMatchObject({
    name: 'AbortError',
  });
});
