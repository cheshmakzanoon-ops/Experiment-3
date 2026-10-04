import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BROADCAST_CAMERAS, decodeBroadcastCameras } from '../src/rendering/broadcast-cameras.ts';
import { trackInfrastructurePlan } from '../src/rendering/track-infrastructure.ts';
import { Track } from '../src/simulation/track.ts';

it('closes the long-lens hysteresis cycle without creating new authored geometry', async () => {
  const loader = new GLTFLoader().register(() => ({
    name: 'CPU_geometry_only',
    loadTexture: () =>
      Promise.resolve(new T.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1)),
  }));
  const kit = await decodeBroadcastCameras(
    new Uint8Array(readFileSync('public/' + BROADCAST_CAMERAS.url)),
    loader,
  );
  try {
    const track = new Track(),
      root = new T.Group();
    for (const site of trackInfrastructurePlan(track).cameras) kit.buildCamera(track, root, site);
    const geometry = () =>
      kit.chunks.flatMap((chunk) =>
        chunk.levels.flatMap((level) =>
          level.children.map((object) => (object as T.Mesh).geometry),
        ),
      );
    const owned = geometry();
    const attributes = owned.map((g) => ({ index: g.index, position: g.getAttribute('position') }));
    // Actual controlled camera witnesses from run 37190130663. These are
    // observer positions, not fabricated simulation/replay observations.
    const views = [
      { position: [-352.013702013509, 2.2389804244, -216.9780247743], fov: 58 },
      { position: [-37.8201900189, 2.2282996595, -215.645947743], fov: 58 },
      { position: [-340.1155923916, 8.7554480571, -174.8681450931], fov: 9.1478425198 },
    ];
    const camera = new T.PerspectiveCamera(58, 640 / 400, 0.1, 2000);
    const visited = new Set<string>();
    const observe = (index: number) => {
      camera.position.fromArray(views[index].position);
      camera.fov = views[index].fov;
      kit.update(camera, 'low');
      const selected = kit.chunks.map((c) => c.levels[c.level].name);
      const cold = selected.filter((name) => !visited.has(name));
      selected.forEach((name) => visited.add(name));
      return { cold, level: kit.chunks.find((c) => c.rigId === 0)!.level };
    };
    const initial = [observe(0), observe(1), observe(2)];
    expect(initial.map((s) => s.level)).toEqual([2, 2, 0]);
    // Negative control: visiting each camera position once did not exercise
    // the middle LOD. Returning to the same wide camera legitimately selects it.
    expect(visited.has('A10 rig 0 LOD1')).toBe(false);
    expect(observe(0)).toEqual({ cold: ['A10 rig 0 LOD1'], level: 1 });
    for (let cycle = 0; cycle < 3; cycle++)
      for (const index of [0, 1, 2, 0]) expect(observe(index).cold).toEqual([]);
    const after = geometry();
    expect(after).toHaveLength(owned.length);
    for (let i = 0; i < owned.length; i++) {
      expect(after[i]).toBe(owned[i]);
      expect(after[i].index).toBe(attributes[i].index);
      expect(after[i].getAttribute('position')).toBe(attributes[i].position);
    }
  } finally {
    kit.dispose();
  }
});
