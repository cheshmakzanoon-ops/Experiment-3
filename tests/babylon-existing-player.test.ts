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
