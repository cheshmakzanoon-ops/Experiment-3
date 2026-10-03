import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  RECOVERY_GATES as M,
  GATE_VARIANTS,
  recoveryGateDocument,
  decodeRecoveryGates,
  loadRecoveryGates,
} from '../src/rendering/recovery-gates.ts';
import { decodeConcreteBarriers } from '../src/rendering/concrete-barriers.ts';
import { decodeSteelGuardrails, guardrailRole } from '../src/rendering/steel-guardrails.ts';
import { decodeImpactBarriers, impactBarrierRole } from '../src/rendering/impact-barriers.ts';
import { decodeCatchFence } from '../src/rendering/catch-fence.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { serviceSitePlan } from '../src/rendering/venue-service-plan.ts';
import { recoveryGatePlan } from '../src/rendering/recovery-gate-plan.ts';
import {
  recoveryApproachGeometry,
  inRecoveryApproach,
} from '../src/rendering/recovery-gate-route.ts';
import { grassApronOffset } from '../src/rendering/ground-profile.ts';
import { trackInfrastructurePlan } from '../src/rendering/track-infrastructure.ts';
import { barrierMaterials, buildBarrierChunk } from '../src/rendering/circuit-barriers.ts';
import { vegetationPlan } from '../src/rendering/landscape.ts';
const bytes = () => new Uint8Array(readFileSync('public/' + M.url));
const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const loader = () =>
  new GLTFLoader().register(() => ({
    name: 'CPU_geometry_only',
    loadTexture: () =>
      Promise.resolve(new T.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1)),
  }));
const decode = () => decodeRecoveryGates(bytes(), loader());
describe('A05 authored closed recovery/access gate family', () => {
  it('retains the editable author, exact self-contained atlas export, sockets and hinged LOD hierarchy', () => {
    expect(hash(readFileSync(M.author))).toBe(M.sourceSHA256);
    expect(readFileSync(M.editable).length).toBeGreaterThan(10000);
    expect(hash(bytes())).toBe(M.sha256);
    const d = recoveryGateDocument(bytes());
    expect(d.images).toHaveLength(3);
    expect(d.materials).toHaveLength(1);
    expect(Object.keys(M.sockets)).toHaveLength(18);
    expect(Object.keys(M.hinges)).toHaveLength(18);
    for (const c of Object.values(M.triangles)) {
      expect(c[0]).toBeLessThan(10000);
      expect(c[0]).toBeGreaterThan(c[1]);
      expect(c[1]).toBeGreaterThan(c[2]);
    }
  });
  it('rejects malformed, truncated and corrupt data before creating GPU resources', async () => {
    expect(() => recoveryGateDocument(bytes().slice(0, -1))).toThrow('byte');
    const h = bytes();
    h[0] = 0;
    expect(() => recoveryGateDocument(h)).toThrow('header');
    const c = bytes();
    c[c.length - 1] ^= 1;
    await expect(decodeRecoveryGates(c)).rejects.toThrow('integrity');
  });
  it('keeps finite indexed metre-space geometry, unit normals, padded UVs and three mechanical pieces per tier', async () => {
    const kit = await decode();
    try {
      for (const v of GATE_VARIANTS)
        for (const l of [0, 1, 2]) {
          const ps = kit.templates.get(`${v}:${l}`)!;
          expect(ps).toHaveLength(3);
          expect(ps.reduce((n, p) => n + p.geometry.index!.count / 3, 0)).toBe(M.triangles[v][l]);
          for (const p of ps) {
            for (const key of ['position', 'normal', 'uv'])
              expect(Array.from(p.geometry.getAttribute(key).array).every(Number.isFinite)).toBe(
                true,
              );
            const normal = p.geometry.getAttribute('normal'),
              uv = p.geometry.getAttribute('uv');
            for (let i = 0; i < normal.count; i++)
              expect(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i))).toBeCloseTo(1, 4);
            for (let i = 0; i < uv.count; i++) {
              const u = uv.getX(i) * 4,
                v = (1 - uv.getY(i)) * 2;
              expect(u - Math.floor(u)).toBeGreaterThanOrEqual(8 / 128 - 1e-5);
              expect(u - Math.floor(u)).toBeLessThanOrEqual(120 / 128 + 1e-5);
              expect(v - Math.floor(v)).toBeGreaterThanOrEqual(8 / 256 - 1e-5);
              expect(v - Math.floor(v)).toBeLessThanOrEqual(248 / 256 + 1e-5);
            }
          }
        }
    } finally {
      kit.dispose();
    }
  });
  it('grounds five protected access connections and does not cut the physical boundary or move the original service spurs', () => {
    const track = new Track('clear'),
      services = serviceSitePlan(track),
      original = JSON.stringify(services),
      sites = recoveryGatePlan(track, services);
    expect(sites).toHaveLength(5);
    expect(sites.map((s) => s.sourceStation)).toEqual([1010, 1460, 1940, 2390, 2710]);
    expect(JSON.stringify(services)).toBe(original);
    expect(Object.isFrozen(sites)).toBe(true);
    for (const site of sites) {
      expect(site.approach[0]).toEqual(
        services.find((s) => s.s === site.sourceStation)!.access!.at(-1),
      );
      const g = recoveryApproachGeometry(track, site),
        p = g.getAttribute('position'),
        n = g.getAttribute('normal');
      for (let i = 0; i < p.count; i++) {
        const q = trackPoint(),
          l = track.nearest(p.getX(i), p.getZ(i), q),
          ground = q.y + q.bank * Math.max(-12, Math.min(12, l)) + grassApronOffset(track, q.s, l);
        expect(Math.abs(l) - track.boundary(q.s, l < 0 ? -1 : 1)).toBeGreaterThan(0.24);
        expect(p.getY(i) - ground).toBeGreaterThanOrEqual(0.009);
        expect(n.getY(i)).toBeGreaterThan(0.9);
      }
      const end = site.approach.at(-1)!,
        q = trackPoint(),
        l = track.nearest(end.x, end.z, q);
      expect(Math.abs(l) - track.boundary(q.s, site.side)).toBeCloseTo(0.42, 2);
      expect(inRecoveryApproach(sites, end.x, end.z)).toBe(true);
      g.dispose();
    }
  });
  it('partitions all 1596 original boundary spans while keeping 12 marshal panels and all six service gates', async () => {
    const kit = await decode(),
      track = new Track('clear'),
      services = serviceSitePlan(track),
      root = new T.Group(),
      originalWater = track.water.slice();
    kit.setSites(track, services);
    const concrete = await decodeConcreteBarriers(
        new Uint8Array(readFileSync('public/models/aurel-concrete-barriers.glb')),
        loader(),
      ),
      steel = await decodeSteelGuardrails(
        new Uint8Array(readFileSync('public/models/aurel-steel-guardrails.glb')),
        loader(),
      ),
      impact = await decodeImpactBarriers(
        new Uint8Array(readFileSync('public/models/aurel-impact-barriers.glb')),
        loader(),
      ),
      fence = await decodeCatchFence(
        new Uint8Array(readFileSync('public/models/aurel-catch-fence.glb')),
        loader(),
      );
    fence.setGateSites(trackInfrastructurePlan(track).marshalPosts);
    try {
      const spans = Math.ceil(track.length / 80);
      for (let i = 0; i < spans; i++) {
        const a = (track.length * i) / spans,
          b = (track.length * (i + 1)) / spans;
        concrete.buildChunk(
          track,
          root,
          a,
          b,
          (s, side) =>
            !!guardrailRole(s, side) || !!impactBarrierRole(s, side) || !!kit.role(s, side),
        );
        steel.buildChunk(track, root, a, b, (s, side) => !!kit.role(s, side));
        impact.buildChunk(track, root, a, b);
        fence.buildChunk(track, root, a, b, (s, side) => !!kit.role(s, side));
        kit.buildChunk(track, root, a, b);
      }
      expect(kit.diagnostics().circuitGates).toBe(5);
      expect(
        concrete.diagnostics().modules +
          steel.diagnostics().modules +
          impact.diagnostics().modules +
          kit.diagnostics().circuitGates,
      ).toBe(1596);
      expect(steel.diagnostics().modules).toBe(202);
      expect(impact.diagnostics().modules).toBe(62);
      expect(fence.diagnostics().modules).toBe(1591);
      expect(fence.diagnostics().gates).toBe(12);
      kit.buildAccessGates(track, root);
      expect(kit.diagnostics()).toMatchObject({
        modules: 11,
        circuitGates: 5,
        accessGates: 6,
        routes: 5,
        gateOperation: false,
        physicsChanged: false,
      });
      expect(() => kit.buildAccessGates(track, root)).toThrow('already');
      expect(() => kit.setSites(track, services)).toThrow('already');
      expect(track.water).toEqual(originalWater);
      for (const c of kit.chunks) {
        expect(c.sphere.radius).toBeLessThan(50);
        expect(c.levels.filter((l) => l.visible)).toHaveLength(1);
      }
      const camera = new T.PerspectiveCamera(58, 16 / 9);
      camera.position.copy(kit.chunks[0].sphere.center);
      kit.update(camera, 'high');
      expect(kit.chunks[0].level).toBe(0);
      camera.position.addScalar(10000);
      kit.update(camera, 'high');
      expect(kit.chunks.every((c) => c.level === 2)).toBe(true);
      for (const tree of vegetationPlan(track, 7109, services, (x, z, p) =>
        kit.blocksVegetation(x, z, p),
      ))
        expect(inRecoveryApproach(kit.sites, tree.x, tree.z, 8)).toBe(false);
    } finally {
      kit.dispose();
      concrete.dispose();
      steel.dispose();
      impact.dispose();
      fence.dispose();
    }
  });
  it('leaves filtered wire topology and transparent policy byte-identical at a gate', async () => {
    const kit = await decode(),
      track = new Track('clear'),
      m = barrierMaterials(),
      old = new T.Group(),
      next = new T.Group();
    kit.setSites(track, serviceSitePlan(track));
    const site = kit.sites[0];
    try {
      buildBarrierChunk(track, old, site.start, site.end, m);
      buildBarrierChunk(track, next, site.start, site.end, m, null, null, null, null, kit);
      const name = `Circuit fence ${Math.round(site.start)}-${Math.round(site.end)}m`,
        a = old.getObjectByName(name) as T.Mesh,
        b = next.getObjectByName(name) as T.Mesh;
      for (const key of ['position', 'normal', 'uv'])
        expect(Array.from(b.geometry.getAttribute(key).array)).toEqual(
          Array.from(a.geometry.getAttribute(key).array),
        );
      expect(Array.from(b.geometry.index!.array)).toEqual(Array.from(a.geometry.index!.array));
      expect(b.castShadow).toBe(false);
      expect(m.fence.depthWrite).toBe(false);
    } finally {
      kit.dispose();
      for (const r of [old, next])
        r.traverse((o) => {
          if (o instanceof T.Mesh) o.geometry.dispose();
        });
      Object.values(m).forEach((x) => x.dispose());
    }
  });
  it('releases source templates, closed-gate batches and route geometry only once', async () => {
    const kit = await decode(),
      track = new Track('clear'),
      root = new T.Group();
    kit.setSites(track, serviceSitePlan(track));
    kit.buildChunk(track, root, 1000, 1080);
    kit.buildAccessGates(track, root);
    const gs = new Set<T.BufferGeometry>();
    kit.templates.forEach((ps) => ps.forEach((p) => gs.add(p.geometry)));
    kit.root.traverse((o) => {
      if (o instanceof T.Mesh) gs.add(o.geometry);
    });
    let disposed = 0;
    gs.forEach((g) => g.addEventListener('dispose', () => disposed++));
    kit.dispose();
    kit.dispose();
    expect(disposed).toBe(gs.size);
    expect(kit.root.parent).toBeNull();
  });
  it('cancels early and rejects failed, truncated or oversized transport', async () => {
    const f = vi.fn();
    await expect(loadRecoveryGates(() => true, 'https://example.invalid', f)).rejects.toMatchObject(
      { name: 'AbortError' },
    );
    expect(f).not.toHaveBeenCalled();
    await expect(
      loadRecoveryGates(
        () => false,
        'https://example.invalid',
        async () => new Response(null, { status: 404 }),
      ),
    ).rejects.toThrow('Unable');
    await expect(
      loadRecoveryGates(
        () => false,
        'https://example.invalid',
        async () => new Response(bytes().slice(0, -1)),
      ),
    ).rejects.toThrow('Truncated');
    await expect(
      loadRecoveryGates(
        () => false,
        'https://example.invalid',
        async () => new Response(new Uint8Array(M.bytes + 1)),
      ),
    ).rejects.toThrow('exceeds');
  });
});
