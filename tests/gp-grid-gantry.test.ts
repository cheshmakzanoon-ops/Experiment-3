import { afterEach, describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import {
  gpGridPortalSurvey,
  buildGpGridGantry,
} from '../src/rendering/venue-kit/gp-grid-gantry.ts';
import { BroadcastSightlines } from '../src/rendering/broadcast-sightlines.ts';
import { CircuitScene } from '../src/rendering/circuit.ts';
import { CIRCUITS } from '../src/simulation/circuits.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { H, HEADER } from '../src/simulation/protocol.ts';

afterEach(() => vi.unstubAllGlobals());
describe('GP starting signal bridge', () => {
  it.each(['poggio-alto', 'cape-wrenna', 'haarveld', 'montejaral'] as const)(
    '%s spans the whole racing and pit corridor at the actual start line',
    (id) => {
      const track = new Track('clear', false, undefined, CIRCUITS[id]),
        p = track.at(0, trackPoint()),
        near = trackPoint();
      const site = gpGridPortalSurvey(track);
      for (const pier of site.piers) {
        expect(pier.top).toBeGreaterThan(pier.bottom);
        for (const u of [-0.78, 0.78])
          for (const v of [-1.2, 1.2]) {
            const x = p.x + p.nx * (pier.x + u) + p.tx * v,
              z = p.z + p.nz * (pier.x + u) + p.tz * v;
            const l = track.nearest(x, z, near);
            expect(Math.abs(l) - track.boundaryAt(near, l < 0 ? -1 : 1)).toBeGreaterThan(1.6);
            expect(track.inPitLane(near.s, l)).toBe(false);
          }
      }
      expect(site.deck - 0.68 - 0.16).toBeGreaterThan(4.5 + Math.abs(p.bank) * p.width);
    },
  );
  it('renders open truss bays, legible faces on both approaches and five independently recorded lights', () => {
    const calls: string[] = [];
    const context = new Proxy(
      {},
      {
        get: (_, key) => () => {
          calls.push(String(key));
        },
      },
    );
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => context }) });
    const track = new Track('clear', false, undefined, CIRCUITS['poggio-alto']);
    const root = new T.Group(),
      sight = new BroadcastSightlines(),
      lights: T.MeshStandardMaterial[] = [];
    const m = new T.MeshStandardMaterial();
    const site = buildGpGridGantry(
      track,
      root,
      sight,
      { steel: m, darkSteel: m, concrete: m },
      lights,
    );
    expect(lights).toHaveLength(5);
    expect(new Set(lights).size).toBe(5);
    expect(calls).toContain('stroke');
    expect(calls).not.toContain('fillText');
    const structure = root.getObjectByName('GP timing portal steel and signage')!;
    expect(structure.children.length).toBeLessThanOrEqual(4);
    const enamel = structure.children.find(
      (o) =>
        (o as T.Mesh<T.BufferGeometry, T.Material>).material.name === 'GP timing bridge enamel',
    ) as T.Mesh;
    const uv = enamel.geometry.getAttribute('uv'),
      pos = enamel.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      if (pos.getZ(i) < 0) expect(uv.getY(i)).toBeGreaterThanOrEqual(0.5);
      else expect(uv.getY(i)).toBeLessThanOrEqual(0.5);
    }
    expect(sight.blocked(new T.Vector3(0, 1, -12), new T.Vector3(0, 1, 12))).toBe(false);
    expect(
      sight.blocked(new T.Vector3(0, site.deck + 0.8, -12), new T.Vector3(0, site.deck + 0.8, 12)),
    ).toBe(true);
    const snapshot = new Float32Array(HEADER);
    const owner = {
      startLamps: lights,
      safetyPanel: m,
    } as unknown as CircuitScene;
    for (const n of [3, 0, 5, 3]) {
      snapshot[H.LIGHTS] = n;
      CircuitScene.prototype.update.call(owner, snapshot);
      expect(lights.map((m) => m.emissiveIntensity > 0)).toEqual(lights.map((_, i) => i < n));
    }
    for (let i = 0; i < 5; i++) {
      const lens = root.getObjectByName('GP start signal ' + (i + 1)) as T.Mesh;
      expect(lens.geometry.getAttribute('gpLampFace').count).toBe(
        lens.geometry.getAttribute('position').count,
      );
      const ray = new T.Raycaster(
        new T.Vector3(lens.position.x, 1, -30),
        lens.position
          .clone()
          .sub(new T.Vector3(lens.position.x, 1, -30))
          .normalize(),
      );
      root.updateMatrixWorld(true);
      expect(ray.intersectObject(root, true)[0].object).toBe(lens);
    }
    const resources = new Set<T.Material>();
    root.traverse((o) => {
      if (o instanceof T.Mesh) {
        o.geometry.dispose();
        resources.add(o.material);
      }
    });
    for (const mat of resources) {
      (mat as T.MeshStandardMaterial).map?.dispose();
      mat.dispose();
    }
  });
});
