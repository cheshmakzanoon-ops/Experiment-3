import * as T from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BuildQueue } from '../src/rendering/build-queue.ts';
import { MxMeadow, type MxMeadowTransition } from '../src/rendering/offroad/mx-meadow.ts';
import { setMxQuality } from '../src/rendering/offroad/mx-quality.ts';
import * as plants from '../src/rendering/offroad/mx-shoulder-plants.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';

afterEach(() => {
  vi.restoreAllMocks();
  setMxQuality('high');
});

function transition(value: MxMeadowTransition | null | false): MxMeadowTransition {
  expect(value).toBeTruthy();
  return value as MxMeadowTransition;
}
function planted() {
  setMxQuality('high');
  const meadow = new MxMeadow(rigTrack('valley-ridge-mx'));
  const queue = new BuildQueue();
  meadow.queueInitial(queue);
  queue.runSynchronously();
  return meadow;
}
function fingerprint(root: T.Object3D) {
  let hash = 2166136261;
  const counts: number[] = [];
  root.traverse((object) => {
    if (!(object instanceof T.InstancedMesh)) return;
    counts.push(object.count);
    for (const attribute of [object.instanceMatrix, object.instanceColor]) {
      if (!attribute) continue;
      const values = attribute.array;
      const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
      for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
    }
  });
  return { hash, counts };
}
function meshes(meadow: MxMeadow) {
  const result: T.InstancedMesh[] = [];
  meadow.root.traverse((object) => {
    if (object instanceof T.InstancedMesh) result.push(object);
  });
  return result;
}

describe('cooperative MX meadow ownership', () => {
  it.each(['low', 'medium'] as const)(
    '%s does no candidate, geometry or material work',
    (quality) => {
      setMxQuality(quality);
      const track = rigTrack('valley-ridge-mx');
      const at = vi.spyOn(track, 'at');
      const geometry = vi.spyOn(plants, 'mxShoulderPlantGeometry');
      const material = vi.spyOn(plants, 'mxShoulderPlantMaterial');
      const furniture = vi.fn(() => []);
      const meadow = new MxMeadow(track, furniture);
      try {
        const queue = new BuildQueue();
        meadow.queueInitial(queue);
        queue.runSynchronously();
        expect(queue.ready).toBe(true);
        expect(meadow.stats).toEqual({ clumps: 0, chunks: 0, candidates: 0 });
        expect(meadow.root.children).toHaveLength(0);
        expect(meadow.root.visible).toBe(false);
        expect(at).not.toHaveBeenCalled();
        expect(furniture).not.toHaveBeenCalled();
        expect(geometry).not.toHaveBeenCalled();
        expect(material).not.toHaveBeenCalled();
      } finally {
        meadow.dispose();
      }
    },
  );

  it('prepares the exact fresh High placement on upgrade, yielding before bounded work', async () => {
    const fresh = planted();
    const expected = fingerprint(fresh.root);
    fresh.dispose();
    setMxQuality('medium');
    const meadow = new MxMeadow(rigTrack('valley-ridge-mx'));
    let last = 0,
      yields = 0;
    try {
      const change = transition(
        await meadow.prepareQuality(
          'ultra',
          () => false,
          async () => {
            expect(meadow.stats.candidates - last).toBeLessThanOrEqual(256);
            expect(meadow.root.children).toHaveLength(0);
            last = meadow.stats.candidates;
            yields++;
          },
        ),
      );
      expect(yields).toBeGreaterThan(200);
      expect(meadow.stats.candidates).toBe(58000);
      expect(meadow.stats.clumps).toBe(0);
      expect(change.apply()).toBe(true);
      setMxQuality('ultra');
      change.finish(true);
      expect(meadow.root.visible).toBe(true);
      expect(fingerprint(meadow.root)).toEqual(expected);
      expect(
        await meadow.prepareQuality(
          'high',
          () => false,
          async () => {},
        ),
      ).toBeNull();
      expect(meadow.stats.candidates).toBe(58000);
    } finally {
      meadow.dispose();
    }
  });

  it('retains resident grass for a failed downgrade, then releases it on acceptance', async () => {
    const meadow = planted();
    const [mesh] = meshes(meadow);
    const before = fingerprint(meadow.root);
    const geometry = vi.spyOn(mesh.geometry, 'dispose');
    const material = vi.spyOn(mesh.material as T.Material, 'dispose');
    const instanceDisposals = meshes(meadow).map((item) => vi.spyOn(item, 'dispose'));
    try {
      const failed = transition(
        await meadow.prepareQuality(
          'medium',
          () => false,
          async () => {},
        ),
      );
      failed.apply();
      setMxQuality('medium');
      expect(meadow.stats.clumps).toBe(0);
      expect(geometry).not.toHaveBeenCalled();
      failed.finish(false);
      setMxQuality('high');
      expect(fingerprint(meadow.root)).toEqual(before);
      expect(meadow.root.visible).toBe(true);
      expect(geometry).not.toHaveBeenCalled();
      const accepted = transition(
        await meadow.prepareQuality(
          'low',
          () => false,
          async () => {},
        ),
      );
      accepted.apply();
      setMxQuality('low');
      accepted.finish(true);
      accepted.finish(true);
      meadow.dispose();
      expect(meadow.root.children).toHaveLength(0);
      expect(geometry).toHaveBeenCalledOnce();
      expect(material).toHaveBeenCalledOnce();
      for (const disposed of instanceDisposals) expect(disposed).toHaveBeenCalledOnce();
    } finally {
      meadow.dispose();
    }
  });

  it.each(['cancel', 'dispose'] as const)(
    'cleans partial GPU owners on %s without installing them',
    async (stop) => {
      setMxQuality('medium');
      const meadow = new MxMeadow(rigTrack('valley-ridge-mx'));
      const geometry = vi.spyOn(T.BufferGeometry.prototype, 'dispose');
      const material = vi.spyOn(T.Material.prototype, 'dispose');
      const instances = vi.spyOn(T.InstancedMesh.prototype, 'dispose');
      let postSamplingYields = 0,
        cancelled = false;
      try {
        const result = await meadow.prepareQuality(
          'high',
          () => cancelled,
          async () => {
            if (meadow.stats.candidates !== 58000 || ++postSamplingYields < 2) return;
            if (stop === 'dispose') meadow.dispose();
            else cancelled = true;
          },
        );
        expect(result).toBe(false);
        expect(instances).toHaveBeenCalledOnce();
        expect(geometry).toHaveBeenCalledOnce();
        expect(material).toHaveBeenCalledOnce();
        expect(meadow.root.children).toHaveLength(0);
        expect(meadow.stats.clumps).toBe(0);
        setMxQuality('high');
        expect(meadow.root.visible).toBe(false);
      } finally {
        meadow.dispose();
      }
    },
  );

  it('supersedes a pending upgrade before any candidate work and propagates actual scheduler failures', async () => {
    setMxQuality('medium');
    const meadow = new MxMeadow(rigTrack('valley-ridge-mx'));
    let resume!: () => void;
    const suspended = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const pending = meadow.prepareQuality(
      'high',
      () => false,
      () => suspended,
    );
    try {
      expect(
        await meadow.prepareQuality(
          'medium',
          () => false,
          async () => {},
        ),
      ).toBeNull();
      resume();
      expect(await pending).toBe(false);
      expect(meadow.stats.candidates).toBe(0);
      await expect(
        meadow.prepareQuality(
          'ultra',
          () => false,
          async () => {
            throw new Error('scheduler failed');
          },
        ),
      ).rejects.toThrow('scheduler failed');
      expect(meadow.stats.clumps).toBe(0);
      expect(meadow.root.children).toHaveLength(0);
    } finally {
      resume();
      meadow.dispose();
    }
  });

  it('cancels initial queued construction and releases its unfinished staging owner', async () => {
    setMxQuality('high');
    const meadow = new MxMeadow(rigTrack('valley-ridge-mx'));
    const queue = new BuildQueue();
    meadow.queueInitial(queue);
    let time = 0;
    const complete = await queue.run(
      () => {},
      () => meadow.stats.candidates > 0,
      async () => {},
      () => (time += 10),
    );
    expect(complete).toBe(false);
    expect(queue.statistics.cancelled).toBe(true);
    expect(meadow.stats.candidates).toBe(256);
    expect(meadow.root.children).toHaveLength(0);
    meadow.dispose();
    expect(meadow.root.visible).toBe(false);
  });
});
