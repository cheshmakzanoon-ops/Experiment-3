import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  decodePitWallStation,
  loadPitWallStation,
  pitWallDocument,
  pitWallLod,
  pitWallPlacement,
  PIT_WALL_STATION,
} from '../src/rendering/pit-wall-station.ts';
import {
  readStationData,
  stationDataKey,
  StationDisplayClock,
} from '../src/rendering/pit-wall-display.ts';
import { Track } from '../src/simulation/track.ts';
import { CAR_STRIDE, HEADER, H, F, carBase } from '../src/simulation/protocol.ts';
import { batchScene } from '../src/rendering/geometry.ts';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { PresentedFrame } from '../src/rendering/frame-state.ts';

function canvas() {
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    setTransform: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
  };
  return { width: 2048, height: 1024, getContext: () => ctx } as unknown as HTMLCanvasElement;
}
const bytes = () =>
  new Uint8Array(readFileSync('public/models/aurel-pit-wall-command-station.glb'));
const decode = () =>
  decodePitWallStation(
    bytes(),
    new GLTFLoader().register(() => ({
      name: 'CPU texture stub',
      loadTexture: () =>
        Promise.resolve(new T.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1)),
    })),
    canvas(),
  );
function packet() {
  const f = new Float32Array(HEADER + 2 * CAR_STRIDE);
  f[H.CARS] = 2;
  f[H.TIME] = 1;
  f[H.PHASE] = 2;
  for (const id of [0, 1]) {
    const b = carBase(id);
    f[b + F.QW] = 1;
    f[b + F.RANK] = id + 1;
  }
  const b = carBase(0);
  f[b + F.SPEED] = 40;
  f[b + F.BATTERY] = 2e6;
  f[b + F.GEAR] = 4;
  f[b + F.FUEL] = 28.5;
  return f;
}
describe('A24 retained pit-wall asset', () => {
  it('pins original source, editable Blender file, GLB, three distinct LODs and eight screen tiles', () => {
    const m = PIT_WALL_STATION;
    expect(createHash('sha256').update(readFileSync(m.author)).digest('hex')).toBe(m.sourceSHA256);
    expect(readFileSync(m.editable).length).toBeGreaterThan(10000);
    const d = pitWallDocument(bytes());
    expect(createHash('sha256').update(bytes()).digest('hex')).toBe(m.sha256);
    expect(d.images).toHaveLength(1);
    expect(m.screenTiles).toBe(8);
    expect(m.triangles[0]).toBeLessThan(46000);
    expect(m.triangles[1]).toBeLessThan(21000);
    expect(m.triangles[2]).toBeLessThan(3000);
  });
  it('rejects damaged and oversized exports before asset parsing', async () => {
    expect(() => pitWallDocument(bytes().slice(0, -1))).toThrow();
    const bad = bytes();
    bad[0] = 0;
    expect(() => pitWallDocument(bad)).toThrow('header');
    const corrupt = bytes();
    corrupt[corrupt.length - 1] ^= 1;
    await expect(decodePitWallStation(corrupt)).rejects.toThrow('integrity');
  });
  it('keeps the full footprint away from road/runoff, pit lane, service boxes and outer fence', () => {
    const track = new Track(),
      site = pitWallPlacement(track);
    expect(site.pitClearance).toBeGreaterThan(1);
    expect(site.trackClearance).toBeGreaterThan(2);
    expect(site.gradeRange).toBeLessThan(0.11);
    expect(PIT_WALL_STATION.lateral + 1.55).toBeLessThan(24.1 - 1.4);
    expect(PIT_WALL_STATION.lateral + 1.55).toBeLessThan(track.boundary(106, 1) - 0.275);
  });
  it('retains every authored socket and correct transforms through static batching', async () => {
    const station = await decode();
    const group = new T.Group();
    group.add(station.root);
    try {
      batchScene(group, new Set([station.root]));
      station.root.position.set(20, 4, -8);
      station.root.rotation.y = 0.7;
      group.updateMatrixWorld(true);
      for (const [name, p] of Object.entries(PIT_WALL_STATION.sockets)) {
        const expected = station.root.localToWorld(
          new T.Vector3(...(p as [number, number, number])),
        );
        expect(
          station
            .socket(name as keyof typeof PIT_WALL_STATION.sockets, new T.Vector3())
            .distanceTo(expected),
        ).toBeLessThan(1e-5);
      }
      for (const [distance, level] of [
        [0, 0],
        [50, 1],
        [130, 2],
        [0, 0],
      ]) {
        station.setDetail(distance, 'high');
        expect(station.levels.map((o) => o.visible)).toEqual([0, 1, 2].map((i) => i === level));
      }
    } finally {
      station.dispose();
    }
  });
  it('shares one correctly oriented atlas across all 24 exported screen faces', async () => {
    const station = await decode();
    try {
      const screenMeshes: T.Mesh[] = [];
      station.root.traverse((o) => {
        if (o instanceof T.Mesh && (o.material as T.Material).name === 'A24 live monitor atlas')
          screenMeshes.push(o);
      });
      expect(screenMeshes).toHaveLength(3);
      const maps = screenMeshes.map((o) => (o.material as T.MeshBasicMaterial).map);
      expect(maps.every((m) => m === station.atlas)).toBe(true);
      expect(station.atlas.flipY).toBe(false);
      expect(station.atlas.userData.dynamic).toBe(true);
      station.root.updateMatrixWorld(true);
      for (const m of screenMeshes) {
        const g = m.geometry;
        expect(g.index!.count / 3).toBe(16);
        const tiles = new Set<number>();
        const uv = g.getAttribute('uv');
        for (let i = 0; i < g.index!.count; i += 3) {
          let u = 0,
            v = 0;
          for (let j = 0; j < 3; j++) {
            const k = g.index!.getX(i + j);
            u += uv.getX(k) / 3;
            v += uv.getY(k) / 3;
          }
          tiles.add(Math.floor(u * 4) + Math.floor(v * 2) * 4);
        }
        expect([...tiles].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
      }
      const hit = new T.Raycaster(
        new T.Vector3(1.6, 1.605, -2.977),
        new T.Vector3(-1, 0, 0),
      ).intersectObjects(screenMeshes);
      expect(hit.length).toBeGreaterThan(0);
      expect(hit[0].point.x).toBeCloseTo(-0.594, 5);
    } finally {
      station.dispose();
    }
  });
  it('applies lens-aware LOD hysteresis and rejects nonfinite lenses', () => {
    expect(pitWallLod(26, 0, 'high')).toBe(0);
    expect(pitWallLod(28, 0, 'high')).toBe(1);
    expect(pitWallLod(80, 2, 'high')).toBe(2);
    expect(pitWallLod(100, 2, 'high', 8)).toBe(0);
    expect(() => pitWallLod(NaN, 0, 'high')).toThrow();
  });
  it('uses observed units and never mutates live/replay packets', () => {
    const f = packet(),
      copy = f.slice(),
      d = readStationData(f)!;
    expect(d.panels[2].rows[0]).toEqual(['KM/H', '144']);
    expect(d.panels[3].rows[1]).toEqual(['BATTERY', '50 %']);
    expect(d.panels[1].rows[1][1]).toBe('--');
    expect(f).toEqual(copy);
    const key = stationDataKey(f, 0, 'LIVE');
    f[carBase(0) + F.FUEL] = 20;
    expect(stationDataKey(f, 0, 'LIVE')).not.toBe(key);
    expect(readStationData(f, 0, 'STANDBY')).toBeNull();
    f[carBase(0) + F.SPEED] = NaN;
    expect(readStationData(f)).toBeNull();
    expect(readStationData(new Float32Array(0))).toBeNull();
  });
  it('reads the real interpolated presentation, then restores an exact seek', () => {
    const sim = new Simulation({ ...DEFAULT_OPTIONS, opponents: 0, mode: 'practice', seed: 1887 });
    for (let i = 0; i < 12; i++) sim.step(1 / 120);
    const a = sim.makeFrame().slice();
    sim.step(1 / 120);
    const b = sim.makeFrame().slice();
    const savedA = a.slice(),
      savedB = b.slice(),
      presented = new PresentedFrame();
    const first = readStationData(presented.sample(a, b, 0.4), 0, 'REPLAY');
    readStationData(presented.sample(a, b, 1), 0, 'REPLAY');
    expect(readStationData(presented.sample(a, b, 0.4), 0, 'REPLAY')).toEqual(first);
    expect(first?.time).toBeCloseTo(a[H.TIME] + 0.4 * (b[H.TIME] - a[H.TIME]), 6);
    expect(a).toEqual(savedA);
    expect(b).toEqual(savedB);
  });
  it('throttles advancing time, corrects pause/seek and resumes after hidden intervals', () => {
    const clock = new StationDisplayClock();
    let paints = 0;
    for (let i = 0; i < 60; i++) if (clock.due(i / 60, String(i), 'LIVE', true)) paints++;
    expect(paints).toBe(5);
    expect(clock.due(59 / 60, '59', 'LIVE', true)).toBe(true);
    expect(clock.due(59 / 60, '59', 'LIVE', true)).toBe(false);
    expect(clock.due(0.3, 'seek', 'LIVE', true)).toBe(true);
    expect(clock.due(0.3, 'different packet', 'LIVE', true)).toBe(true);
    expect(clock.due(30, 'hidden', 'LIVE', false)).toBe(false);
    expect(clock.due(30, 'visible', 'LIVE', true)).toBe(true);
    expect(clock.due(30, 'visible', 'REPLAY', true)).toBe(true);
  });
  it('updates visible data only, rewinds and frees every texture, mesh and material once', async () => {
    const station = await decode(),
      camera = new T.PerspectiveCamera(58, 16 / 9, 0.02, 500),
      f = packet();
    camera.position.set(4, 1.8, 5);
    camera.lookAt(0, 1, 0);
    camera.updateMatrixWorld(true);
    station.update(camera, 'high', 'day', f);
    const d = station.diagnostics();
    expect(d.screenTime).toBe(1);
    expect(d.screenCar).toBe(0);
    station.update(camera, 'high', 'day', f);
    expect(station.diagnostics().screenUploads).toBe(d.screenUploads);
    f[H.TIME] = 0.1;
    station.update(camera, 'high', 'night', f, 'REPLAY');
    expect(station.diagnostics().screenTime).toBeCloseTo(0.1);
    camera.position.set(200, 3, 200);
    camera.lookAt(0, 0, 0);
    f[H.TIME] = 5;
    station.update(camera, 'high', 'night', f);
    expect(station.diagnostics().screenTime).toBeCloseTo(0.1);
    const resources = new Set<T.BufferGeometry | T.Material | T.Texture>();
    station.root.traverse((o) => {
      if (o instanceof T.Mesh) {
        resources.add(o.geometry);
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          resources.add(m);
          for (const v of Object.values(m)) if (v instanceof T.Texture) resources.add(v);
        }
      }
    });
    const calls = new Map<object, number>();
    for (const r of resources) {
      calls.set(r, 0);
      r.addEventListener('dispose', () => calls.set(r, calls.get(r)! + 1));
    }
    station.dispose();
    station.dispose();
    expect([...calls.values()].every((n) => n === 1)).toBe(true);
  });
  it('rejects cancellation, transport errors, oversized and truncated responses without stand-in art', async () => {
    const never: typeof fetch = async () => {
      throw new Error('Must not request');
    };
    await expect(
      loadPitWallStation(() => true, 'https://example.test/a24', never),
    ).rejects.toMatchObject({ name: 'AbortError' });
    for (const [body, message] of [
      [new Uint8Array(50), 'Truncated'],
      [new Uint8Array(PIT_WALL_STATION.bytes + 1), 'exceeds'],
    ] as const) {
      const fetcher: typeof fetch = async () => new Response(body);
      await expect(
        loadPitWallStation(() => false, 'https://example.test/a24', fetcher),
      ).rejects.toThrow(message);
    }
    await expect(
      loadPitWallStation(
        () => false,
        'https://example.test/a24',
        async () => new Response(null, { status: 404 }),
      ),
    ).rejects.toThrow('404');
  });
});
