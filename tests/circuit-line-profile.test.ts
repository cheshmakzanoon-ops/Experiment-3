import { expect, it } from 'vitest';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import {
  apexLineAt,
  apexLineProfile,
  CIRCUIT_LINE_PROFILE_STEP,
} from '../src/engine/assets/circuit-line-profile.ts';
import { TYRE_MARKS, tyreMarkZones } from '../src/engine/assets/tyre-mark-zones.ts';
import {
  apexLineAt as legacyAt,
  apexLineProfile as legacyProfile,
  ROAD_DETAIL,
} from '../src/rendering/studio/road-detail.ts';
import {
  TYRE_MARKS as legacyConstants,
  tyreMarkZones as legacyZones,
} from '../src/rendering/tyre-marks.ts';
import { Track } from '../src/simulation/track.ts';
it('compatibility exports share exact functions, constants and both profile caches', () => {
  expect(legacyAt).toBe(apexLineAt);
  expect(legacyProfile).toBe(apexLineProfile);
  expect(legacyConstants).toBe(TYRE_MARKS);
  expect(legacyZones).toBe(tyreMarkZones);
  expect(ROAD_DETAIL.profileStep).toBe(CIRCUIT_LINE_PROFILE_STEP);
  const track = new Track('clear');
  for (const motorcycle of [false, true])
    expect(legacyProfile(track, motorcycle)).toBe(apexLineProfile(track, motorcycle));
  expect(apexLineProfile(track, false)).not.toBe(apexLineProfile(track, true));
});
it('new semantic and normal entrypoints have no transitive renderer dependency', () => {
  const queue = ['circuit-line-profile', 'tyre-mark-zones', 'indexed-ribbon-normals'].map((n) =>
    resolve(`src/engine/assets/${n}.ts`),
  );
  const seen = new Set<string>();
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    expect(file).not.toContain('/rendering/');
    expect(file).not.toContain('/engine/babylon/');
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(
      /(?:from\s*|import\s*\(\s*|import\s*)['"]([^'"\s]+)['"]/g,
    )) {
      const dep = match[1];
      expect(dep).not.toMatch(/^(three|@babylonjs)(\/|$)/);
      if (dep.startsWith('.')) queue.push(resolve(dirname(file), dep));
    }
  }
});
