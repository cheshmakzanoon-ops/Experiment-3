import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  decodeTrackSignalHardware,
  TRACK_SIGNAL_HARDWARE,
} from '../src/rendering/track-signal-hardware.ts';
import { decodeTrackBoards, TRACK_BOARDS } from '../src/rendering/track-boards.ts';
import { decodeBroadcastCameras, BROADCAST_CAMERAS } from '../src/rendering/broadcast-cameras.ts';
import { trackBoardPlan } from '../src/rendering/track-board-plan.ts';
import { timingSensorPlan } from '../src/rendering/track-signal-plan.ts';
import { trackInfrastructurePlan } from '../src/rendering/track-infrastructure.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
const loader = () =>
  new GLTFLoader().register(() => ({
    name: 'CPU_geometry_only',
    loadTexture: () =>
      Promise.resolve(new T.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1)),
  }));
describe('A08-A10 integrated asset contracts', () => {
  for (const [manifest, decode] of [
    [TRACK_SIGNAL_HARDWARE, decodeTrackSignalHardware],
    [TRACK_BOARDS, decodeTrackBoards],
    [BROADCAST_CAMERAS, decodeBroadcastCameras],
  ] as const) {
    it(`${manifest.assetId} has non-degenerate indexed triangles at every exported level`, async () => {
      const kit = await decode(new Uint8Array(readFileSync('public/' + manifest.url)), loader());
      try {
        let count = 0;
        const a = new T.Vector3(),
          b = new T.Vector3(),
          c = new T.Vector3();
        for (const parts of kit.templates.values())
          for (const part of parts) {
            const g = part.geometry,
              p = g.getAttribute('position'),
              ix = g.index!;
            for (let i = 0; i < ix.count; i += 3) {
              for (const offset of [0, 1, 2]) expect(ix.getX(i + offset)).toBeLessThan(p.count);
              a.fromBufferAttribute(p, ix.getX(i));
              b.fromBufferAttribute(p, ix.getX(i + 1));
              c.fromBufferAttribute(p, ix.getX(i + 2));
              const area = b.sub(a).cross(c.sub(a)).lengthSq();
              expect(area, `${manifest.assetId} triangle ${count}`).toBeGreaterThan(1e-18);
              count++;
            }
          }
        expect(count).toBeGreaterThan(1000);
      } finally {
        kit.dispose();
      }
    });
  }
  it('keeps the combined transfer below 4MiB with original toolchain and native files', () => {
    const manifests = [TRACK_SIGNAL_HARDWARE, TRACK_BOARDS, BROADCAST_CAMERAS];
    expect(manifests.reduce((n, m) => n + m.bytes, 0)).toBeLessThan(4 * 1024 * 1024);
    for (const m of manifests) {
      expect(m.authoredIn).toBe('5.2.2 LTS');
      expect(m.finalArtApproved).toBe(false);
      expect(readFileSync(m.editable).length).toBeGreaterThan(10000);
      expect(m.images).toBe(3);
      expect(m.materials).toBe(1);
    }
  });
  it('is deterministic across fresh plans and does not mutate track or boundary samples', () => {
    const track = new Track(),
      point = trackPoint();
    const sample = () =>
      Array.from({ length: 64 }, (_, i) => {
        const s = (i * track.length) / 64;
        track.at(s, point);
        return [s, point.x, point.y, point.z, track.boundary(s, -1), track.boundary(s, 1)];
      });
    const before = sample();
    expect(trackBoardPlan(track)).toEqual(trackBoardPlan(track));
    expect(timingSensorPlan(track)).toEqual(timingSensorPlan(track));
    expect(trackInfrastructurePlan(track)).toEqual(trackInfrastructurePlan(track));
    expect(trackBoardPlan(track)).toHaveLength(20);
    expect(timingSensorPlan(track)).toHaveLength(3);
    expect(sample()).toEqual(before);
  });
});
