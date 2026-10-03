import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Track, trackPoint } from '../src/simulation/track.ts';
import {
  IMPACT_BARRIERS as M,
  IMPACT_VARIANTS,
  IMPACT_RANGES,
  impactBarrierRole,
  impactBarrierDocument,
  decodeImpactBarriers,
  loadImpactBarriers,
  conformImpactBarriersGeometry,
} from '../src/rendering/impact-barriers.ts';
import { decodeSteelGuardrails, guardrailRole } from '../src/rendering/steel-guardrails.ts';
import { decodeConcreteBarriers } from '../src/rendering/concrete-barriers.ts';
import { barrierMaterials, buildBarrierChunk } from '../src/rendering/circuit-barriers.ts';
const bytes = () => new Uint8Array(readFileSync('public/' + M.url));
const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const loader = () =>
  new GLTFLoader().register(() => ({
    name: 'CPU_geometry_only',
    loadTexture: () =>
      Promise.resolve(new T.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1)),
  }));
const decode = () => decodeImpactBarriers(bytes(), loader());
describe('A04 authored impact blocks and tyre walls', () => {
  it('retains source, exact payload, three embedded maps and explicitly bounded LODs', () => {
    expect(hash(readFileSync(M.author))).toBe(M.sourceSHA256);
    expect(readFileSync(M.editable).length).toBeGreaterThan(10000);
    expect(hash(bytes())).toBe(M.sha256);
    const d = impactBarrierDocument(bytes());
    expect(d.images).toHaveLength(3);
    expect(d.materials).toHaveLength(1);
    expect(M.bytes).toBeLessThan(4 * 1024 * 1024);
    for (const c of Object.values(M.triangles)) {
      expect(c[0]).toBeLessThan(16000);
      expect(c[0]).toBeGreaterThan(c[1]);
      expect(c[1]).toBeGreaterThan(c[2]);
    }
  });
  it('rejects malformed or changed payloads before decoding textures', async () => {
    expect(() => impactBarrierDocument(bytes().slice(0, -1))).toThrow('byte');
    const h = bytes();
    h[0] = 0;
    expect(() => impactBarrierDocument(h)).toThrow('header');
    const corrupt = bytes();
    corrupt[corrupt.length - 1] ^= 1;
    await expect(decodeImpactBarriers(corrupt)).rejects.toThrow('integrity');
  });
  it('retains metre-space templates, UVs, finite normalized normals and complete LOD geometry', async () => {
    const kit = await decode();
    try {
      expect(kit.templates.size).toBe(9);
      for (const v of IMPACT_VARIANTS)
        for (const l of [0, 1, 2]) {
          const parts = kit.templates.get(`${v}:${l}`)!;
          expect(parts.length).toBe(M.draws[v][l]);
          expect(parts.reduce((n, p) => n + p.geometry.index!.count / 3, 0)).toBe(
            M.triangles[v][l],
          );
          for (const p of parts) {
            for (const key of ['position', 'normal', 'uv'])
              expect(Array.from(p.geometry.getAttribute(key).array).every(Number.isFinite)).toBe(
                true,
              );
            const uv = p.geometry.getAttribute('uv');
            for (let i = 0; i < uv.count; i++) {
              const u = uv.getX(i) * 4,
                v = (1 - uv.getY(i)) * 2;
              expect(u - Math.floor(u)).toBeGreaterThanOrEqual(8 / 128 - 1e-5);
              expect(u - Math.floor(u)).toBeLessThanOrEqual(120 / 128 + 1e-5);
              expect(v - Math.floor(v)).toBeGreaterThanOrEqual(8 / 256 - 1e-5);
              expect(v - Math.floor(v)).toBeLessThanOrEqual(248 / 256 + 1e-5);
            }
            const normal = p.geometry.getAttribute('normal');
            for (let i = 0; i < normal.count; i++)
              expect(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i))).toBeCloseTo(1, 4);
          }
        }
    } finally {
      kit.dispose();
    }
  });
  it('places posts outside each track side and preserves source geometry through mirrored end treatments', async () => {
    const kit = await decode(),
      track = new Track('clear');
    try {
      const template = kit.templates.get('tyres:0')![0].geometry,
        original = Array.from(template.getAttribute('position').array);
      for (const side of [-1, 1])
        for (const reverse of [false, true]) {
          const start = 715,
            end = 718.7,
            g = conformImpactBarriersGeometry(template, track, start, end, side, reverse),
            p = g.getAttribute('position'),
            src = template.getAttribute('position');
          for (let i = 0; i < p.count; i += 13) {
            const t = reverse ? 1 - src.getZ(i) / M.span : src.getZ(i) / M.span,
              a = track.at(start, trackPoint()),
              b = track.at(end, trackPoint()),
              x = src.getX(i) * side,
              la = side * track.boundary(start, side) + x,
              lb = side * track.boundary(end, side) + x;
            expect(p.getX(i)).toBeCloseTo((a.x + a.nx * la) * (1 - t) + (b.x + b.nx * lb) * t, 3);
            expect(p.getY(i)).toBeCloseTo(
              (a.y + a.bank * Math.max(-12, Math.min(12, la))) * (1 - t) +
                (b.y + b.bank * Math.max(-12, Math.min(12, lb))) * t +
                src.getY(i),
              4,
            );
          }
          const normal = g.getAttribute('normal'),
            index = g.index!,
            a = new T.Vector3(),
            b = new T.Vector3(),
            c = new T.Vector3(),
            face = new T.Vector3(),
            mean = new T.Vector3();
          for (let i = 0; i < index.count; i += 93) {
            const ids = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
            a.fromBufferAttribute(p, ids[0]);
            b.fromBufferAttribute(p, ids[1]);
            c.fromBufferAttribute(p, ids[2]);
            face.crossVectors(b.sub(a), c.sub(a));
            if (face.lengthSq() < 1e-16) continue;
            mean.set(0, 0, 0);
            for (const id of ids) mean.add(new T.Vector3().fromBufferAttribute(normal, id));
            expect(face.dot(mean)).toBeGreaterThan(0);
          }
          g.dispose();
        }
      expect(Array.from(template.getAttribute('position').array)).toEqual(original);
    } finally {
      kit.dispose();
    }
  });
  it('partitions all original barrier spans without changing track boundaries or fence wire', async () => {
    const kit = await decode(),
      track = new Track('clear'),
      root = new T.Group(),
      water = track.water.slice();
    const concrete = await decodeConcreteBarriers(
      new Uint8Array(readFileSync('public/models/aurel-concrete-barriers.glb')),
      loader(),
    );
    const steel = await decodeSteelGuardrails(
      new Uint8Array(readFileSync('public/models/aurel-steel-guardrails.glb')),
      loader(),
    );
    const boundary = Array.from({ length: 100 }, (_, i) =>
      [-1, 1].map((side) => track.boundary((i * track.length) / 100, side)),
    );
    try {
      const spans = Math.ceil(track.length / 80);
      let total = 0;
      for (let i = 0; i < spans; i++) {
        const a = (track.length * i) / spans,
          b = (track.length * (i + 1)) / spans;
        total += Math.ceil((b - a) / 3.8) * 2;
        concrete.buildChunk(
          track,
          root,
          a,
          b,
          (s, side) => !!guardrailRole(s, side) || !!impactBarrierRole(s, side),
        );
        steel.buildChunk(track, root, a, b);
        kit.buildChunk(track, root, a, b);
      }
      expect(total).toBe(1596);
      expect(
        concrete.diagnostics().modules + steel.diagnostics().modules + kit.diagnostics().modules,
      ).toBe(total);
      expect(kit.diagnostics().modules).toBe(62);
      expect(kit.diagnostics().tyreModules).toBe(22);
      expect(steel.diagnostics().modules).toBe(203);
      expect(steel.diagnostics().transitions).toBe(8);
      expect(track.water).toEqual(water);
      expect(
        Array.from({ length: 100 }, (_, i) =>
          [-1, 1].map((side) => track.boundary((i * track.length) / 100, side)),
        ),
      ).toEqual(boundary);
      for (const r of IMPACT_RANGES)
        for (let s = r.start; s <= r.end; s += 0.1) expect(guardrailRole(s, r.side)).toBeNull();
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
    } finally {
      kit.dispose();
      steel.dispose();
      concrete.dispose();
    }
  });
  it('retains byte-identical transparent fence geometry and fills the replaced spans in fallback mode', async () => {
    const kit = await decode(),
      track = new Track('clear'),
      old = new T.Group(),
      next = new T.Group(),
      m = barrierMaterials();
    try {
      buildBarrierChunk(track, old, 1240, 1320, m);
      buildBarrierChunk(track, next, 1240, 1320, m, null, null, null, kit);
      const a = old.getObjectByName('Circuit fence 1240-1320m') as T.Mesh,
        b = next.getObjectByName('Circuit fence 1240-1320m') as T.Mesh;
      for (const key of ['position', 'normal', 'uv'])
        expect(Array.from(b.geometry.getAttribute(key).array)).toEqual(
          Array.from(a.geometry.getAttribute(key).array),
        );
      expect(Array.from(b.geometry.index!.array)).toEqual(Array.from(a.geometry.index!.array));
      expect(b.castShadow).toBe(false);
      expect(m.fence.depthWrite).toBe(false);
      expect(m.fence.forceSinglePass).toBe(true);
      expect(kit.diagnostics().modules).toBe(22);
      expect(next.getObjectByName('Circuit concrete 1240-1320m')).toBeInstanceOf(T.Mesh);
      expect(impactBarrierRole(0, 1)).toBeNull();
      expect(impactBarrierRole(1680, 1)?.variant).toBe('tyres');
      expect(kit.diagnostics()).toMatchObject({
        physicsChanged: false,
        energyAbsorptionSimulation: false,
      });
    } finally {
      kit.dispose();
      for (const root of [old, next])
        root.traverse((o) => {
          if (o instanceof T.Mesh) o.geometry.dispose();
        });
      Object.values(m).forEach((x) => x.dispose());
    }
  });
  it('releases template and chunk resources exactly once', async () => {
    const kit = await decode();
    kit.buildChunk(new Track('clear'), new T.Group(), 1240, 1320);
    const geometries = new Set<T.BufferGeometry>();
    kit.templates.forEach((ps) => ps.forEach((p) => geometries.add(p.geometry)));
    kit.root.traverse((o) => {
      if (o instanceof T.Mesh) geometries.add(o.geometry);
    });
    let count = 0;
    geometries.forEach((g) => g.addEventListener('dispose', () => count++));
    kit.dispose();
    kit.dispose();
    expect(count).toBe(geometries.size);
    expect(kit.root.parent).toBeNull();
  });
  it('cancels and rejects missing, truncated or oversized transport', async () => {
    const fetcher = vi.fn();
    await expect(
      loadImpactBarriers(() => true, 'https://example.invalid', fetcher),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).not.toHaveBeenCalled();
    await expect(
      loadImpactBarriers(
        () => false,
        'https://example.invalid',
        async () => new Response(null, { status: 404 }),
      ),
    ).rejects.toThrow('Unable');
    await expect(
      loadImpactBarriers(
        () => false,
        'https://example.invalid',
        async () => new Response(bytes().slice(0, -1)),
      ),
    ).rejects.toThrow('Truncated');
    await expect(
      loadImpactBarriers(
        () => false,
        'https://example.invalid',
        async () => new Response(new Uint8Array(M.bytes + 1)),
      ),
    ).rejects.toThrow('exceeds');
  });
});
