import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  AUREL_QUARRY as M,
  decodeAurelQuarry,
  quarryDocument,
  quarryLod,
  loadAurelQuarry,
  quarrySkirtGeometry,
} from '../src/rendering/aurel-quarry.ts';
import {
  aurelQuarryPlan,
  quarryPlacementClearance,
  quarryFootprint,
  inQuarryFootprint,
  quarryGround,
  type QuarrySite,
  type QuarryVariant,
} from '../src/rendering/aurel-quarry-plan.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { VELLAMAR } from '../src/simulation/circuits.ts';
import { serviceSitePlan } from '../src/rendering/venue-service-plan.ts';
import { aurelVegetationPlan, crownRadius } from '../src/rendering/aurel-vegetation-plan.ts';
import { BuildQueue } from '../src/rendering/build-queue.ts';
import { grassApronOffset } from '../src/rendering/ground-profile.ts';
import { terrainFor } from '../src/rendering/terrain.ts';
const bytes = () => new Uint8Array(readFileSync('public/' + M.url));
const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const loader = () =>
  new GLTFLoader().register(() => ({
    name: 'CPU_geometry_only',
    loadTexture: () =>
      Promise.resolve(new T.DataTexture(new Uint8Array([100, 120, 80, 255]), 1, 1)),
  }));
const decode = () => decodeAurelQuarry(bytes(), loader());
const site = (variant: QuarryVariant = 'cliff-cut'): QuarrySite => ({
  id: 'test',
  variant,
  x: 0,
  z: 0,
  station: 0,
  yaw: 0,
  scale: [1, 1, 1],
  ground: 'terrain',
});

describe('A55-A60 native asset contract', () => {
  it('retains source-matched editable geometry, textures and three complete tiers', () => {
    expect(hash(bytes())).toBe(M.sha256);
    expect(hash(readFileSync(M.author))).toBe(M.sourceSHA256);
    expect(hash(readFileSync(M.editable))).toBe(M.editableSHA256);
    const d = quarryDocument(bytes());
    expect(d.nodes).toHaveLength(44);
    expect(d.meshes).toHaveLength(33);
    expect(d.images).toHaveLength(4);
    for (const v of M.variants as QuarryVariant[]) {
      const t = M.triangles[v];
      expect(t[0]).toBeLessThan(1000);
      expect(t[0]).toBeGreaterThan(t[2]);
      expect(t[0]).toBeGreaterThanOrEqual(t[1]);
      expect(t[1]).toBeGreaterThanOrEqual(t[2]);
    }
    expect(M.finalArtApproved).toBe(false);
  });
  it('rejects malformed and same-size-corrupt input before decoding', async () => {
    expect(() => quarryDocument(bytes().slice(1))).toThrow('byte count');
    const header = bytes();
    header[0] = 0;
    expect(() => quarryDocument(header)).toThrow('header');
    const b = bytes();
    b[b.length - 11] ^= 1;
    const l = loader(),
      parse = vi.spyOn(l, 'parseAsync');
    await expect(decodeAurelQuarry(b, l)).rejects.toThrow('integrity');
    expect(parse).not.toHaveBeenCalled();
  });
  it('bounds HTTP input, rejects truncation and honours pre-cancel without requesting', async () => {
    const request = vi.fn();
    await expect(loadAurelQuarry(() => true, 'test', request)).rejects.toThrow('cancelled');
    expect(request).not.toHaveBeenCalled();
    for (const [body, error] of [
      [bytes().slice(0, -1), 'Truncated'],
      [new Uint8Array(M.bytes + 1), 'exceeds byte budget'],
    ] as const) {
      await expect(
        loadAurelQuarry(() => false, 'test', vi.fn().mockResolvedValue(new Response(body))),
      ).rejects.toThrow(error);
    }
    await expect(
      loadAurelQuarry(
        () => false,
        'test',
        vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
      ),
    ).rejects.toThrow('404');
  });
  it('loads finite source geometry without proxy boxes or external textures', async () => {
    const kit = await decode();
    expect(kit.templates.size).toBe(33);
    for (const [name, m] of kit.templates) {
      expect(m.geometry.index!.count).toBeGreaterThan(0);
      expect(m.material.vertexColors).toBe(true);
      if (name.startsWith('shrub') || name.startsWith('hedge')) {
        expect(m.material.alphaTest).toBe(0.45);
        expect(m.material.transparent).toBe(false);
        expect(m.material.map!.userData.foliageAlphaCutoff).toBe(0.45);
      }
    }
    kit.dispose();
    kit.dispose();
  });
});
describe('Quarry composition and retained race geometry', () => {
  it('is deterministic across weather and includes every family only in Aurel', () => {
    const t = new Track(),
      before = JSON.stringify(t.points),
      plan = aurelQuarryPlan(t);
    expect(plan).toEqual(aurelQuarryPlan(new Track('rain')));
    const counts = Object.fromEntries(
      M.variants.map((v) => [v, plan.filter((s) => s.variant === v).length]),
    );
    expect(counts['cliff-cut']).toBeGreaterThan(1);
    expect(counts['cliff-bench']).toBeGreaterThan(3);
    expect(counts['drain-collar']).toBeGreaterThan(4);
    expect(counts.tussock).toBeGreaterThan(60);
    expect(counts.ridge).toBe(4);
    expect(plan.length).toBeLessThanOrEqual(360);
    expect(new Set(plan.map((s) => s.id)).size).toBe(plan.length);
    expect(JSON.stringify(t.points)).toBe(before);
    expect(aurelQuarryPlan(new Track('clear', false, undefined, VELLAMAR))).toEqual([]);
  });
  it('checks the complete exported footprint and rejects blocked or invalid sites', () => {
    const t = new Track(),
      plan = aurelQuarryPlan(t),
      clear = quarryPlacementClearance(t);
    expect(plan.every(clear)).toBe(true);
    const p = t.at(1200, trackPoint());
    expect(clear({ ...site(), x: p.x, z: p.z, station: 1200 })).toBe(false);
    const rejected = quarryPlacementClearance(t, undefined, undefined, () => true);
    expect(plan.every((s) => !rejected(s))).toBe(true);
    expect(() => quarryFootprint({ ...site(), scale: [0, 1, 1] })).toThrow();
    expect(() => inQuarryFootprint([], NaN, 0)).toThrow();
    const b = quarryFootprint(site());
    expect(inQuarryFootprint([site()], b.maxX - 0.01, b.maxZ - 0.01)).toBe(true);
    expect(inQuarryFootprint([site()], b.maxX + 1, b.maxZ + 1)).toBe(false);
  });
  it('uses the actual apron and terrain datums, not the driving height everywhere', () => {
    const t = new Track(),
      p = t.at(1220, trackPoint()),
      l = -30,
      x = p.x + p.nx * l,
      z = p.z + p.nz * l,
      near = trackPoint(),
      signed = t.nearest(x, z, near);
    expect(quarryGround(t, x, z, 'apron')).toBeCloseTo(
      near.y + near.bank * Math.max(-12, signed) + grassApronOffset(t, near.s, signed),
      9,
    );
    expect(quarryGround(t, 1500, 700, 'terrain')).toBe(terrainFor(t).height(1500, 700));
    expect(() => quarryGround(t, NaN, 0, 'terrain')).toThrow();
  });
  it('connects outer apron and terrain with indexed non-racing slope triangles', () => {
    const t = new Track(),
      original = t.points.map((p) => ({ ...p }));
    for (let s = 1080; s < 1480; s += 80) {
      const g = quarrySkirtGeometry(t, s, s + 80),
        p = g.getAttribute('position'),
        n = g.getAttribute('normal');
      expect(g.index!.count).toBeGreaterThan(100);
      for (let i = 0; i < p.count; i++) {
        expect([p.getX(i), p.getY(i), p.getZ(i), n.getY(i)].every(Number.isFinite)).toBe(true);
        expect(n.getY(i)).toBeGreaterThan(0);
      }
      const near = t.at(s, trackPoint());
      expect(p.getY(0)).toBeCloseTo(
        near.y + near.bank * -12 + grassApronOffset(t, s, -(near.width + 37.8)) - 0.006,
        5,
      );
      expect(p.getY(6)).toBeCloseTo(terrainFor(t).height(p.getX(6), p.getZ(6)) - 0.006, 4);
      g.dispose();
    }
    expect(t.points).toEqual(original);
    expect(() => quarrySkirtGeometry(t, 0, 80)).toThrow();
  });
});
describe('production lifetime and per-view detail', () => {
  it('queues bounded spatial work and keeps geometry identity through lens/camera cycles', async () => {
    const kit = await decode(),
      t = new Track(),
      parent = new T.Group(),
      q = new BuildQueue();
    kit.enqueue(t, parent, serviceSitePlan(t), q);
    expect(kit.root.parent).toBeNull();
    q.runSynchronously();
    parent.updateMatrixWorld(true);
    expect(kit.chunks.length).toBeGreaterThan(10);
    expect(kit.chunks.length).toBeLessThan(60);
    expect(kit.root.parent).toBe(parent);
    const ids = kit.chunks.map((c) => [
      c.mesh,
      c.mesh.geometry,
      c.mesh.geometry.getAttribute('position'),
      c.mesh.geometry.index,
    ]);
    const c = new T.PerspectiveCamera(58, 16 / 9, 0.1, 4000);
    for (const x of [0, 1200, -200, 10, 0]) {
      c.position.set(x, 4, 300);
      c.updateMatrixWorld(true);
      kit.update(c, 'medium');
    }
    expect(
      kit.chunks.map((c) => [
        c.mesh,
        c.mesh.geometry,
        c.mesh.geometry.getAttribute('position'),
        c.mesh.geometry.index,
      ]),
    ).toEqual(ids);
    for (const chunk of kit.chunks) {
      expect(chunk.mesh.geometry.drawRange.count).toBeGreaterThan(0);
      expect(chunk.ranges[2].count).toBeLessThanOrEqual(chunk.ranges[0].count);
    }
    expect(kit.diagnostics().geometryBytes).toBeLessThan(16 * 1024 * 1024);
    const disposals = kit.chunks.map((c) => vi.spyOn(c.mesh.geometry, 'dispose'));
    kit.dispose();
    kit.dispose();
    expect(parent.children).toHaveLength(0);
    for (const d of disposals) expect(d).toHaveBeenCalledTimes(1);
  });
  it('excludes tree crowns from the formations and newly graded slope without removing the wider planting', async () => {
    const t = new Track(),
      kit = await decode(),
      services = serviceSitePlan(t);
    kit.enqueue(t, new T.Group(), services, new BuildQueue());
    const trees = aurelVegetationPlan(t, services, (x, z, r) => kit.blocksPlanting(t, x, z, r));
    expect(trees.length).toBeGreaterThan(1800);
    expect(
      trees.every((tree) => !inQuarryFootprint(kit.sites, tree.x, tree.z, crownRadius(tree))),
    ).toBe(true);
    kit.dispose();
  });
  it('does not allocate geometry for Vellamar and rejects repeated enqueue', async () => {
    const kit = await decode(),
      t = new Track('clear', false, undefined, VELLAMAR),
      q = new BuildQueue();
    kit.enqueue(t, new T.Group(), serviceSitePlan(t), q);
    q.runSynchronously();
    expect(kit.chunks).toEqual([]);
    expect(() => kit.enqueue(t, new T.Group(), [], new BuildQueue())).toThrow();
    kit.dispose();
  });
  it('uses bounded hysteresis and validates distance', () => {
    expect(quarryLod(75, 0, 'medium')).toBe(0);
    expect(quarryLod(90, 0, 'medium')).toBe(1);
    expect(quarryLod(235, 1, 'medium')).toBe(1);
    expect(quarryLod(280, 1, 'medium')).toBe(2);
    expect(() => quarryLod(-1, 0, 'medium')).toThrow();
  });
});
