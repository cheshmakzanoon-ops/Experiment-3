import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Track, trackPoint } from '../src/simulation/track.ts';
import {
  STEEL_GUARDRAILS as M,
  GUARDRAIL_VARIANTS,
  GUARDRAIL_RANGES,
  guardrailRole,
  steelGuardrailDocument,
  decodeSteelGuardrails,
  loadSteelGuardrails,
  conformGuardrailGeometry,
} from '../src/rendering/steel-guardrails.ts';
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
const decode = () => decodeSteelGuardrails(bytes(), loader());
describe('A02 authored steel guardrail kit', () => {
  it('retains source, exact payload, three embedded maps and explicitly bounded LODs', () => {
    expect(hash(readFileSync(M.author))).toBe(M.sourceSHA256);
    expect(readFileSync(M.editable).length).toBeGreaterThan(10000);
    expect(hash(bytes())).toBe(M.sha256);
    const d = steelGuardrailDocument(bytes());
    expect(d.images).toHaveLength(3);
    expect(d.materials).toHaveLength(2);
    expect(M.bytes).toBeLessThan(3 * 1024 * 1024);
    for (const c of Object.values(M.triangles)) {
      expect(c[0]).toBeLessThan(7000);
      expect(c[0]).toBeGreaterThan(c[1]);
      expect(c[1]).toBeGreaterThan(c[2]);
    }
  });
  it('rejects malformed or changed payloads before decoding textures', async () => {
    expect(() => steelGuardrailDocument(bytes().slice(0, -1))).toThrow('byte');
    const h = bytes();
    h[0] = 0;
    expect(() => steelGuardrailDocument(h)).toThrow('header');
    const corrupt = bytes();
    corrupt[corrupt.length - 1] ^= 1;
    await expect(decodeSteelGuardrails(corrupt)).rejects.toThrow('integrity');
  });
  it('retains metre-space templates, UVs, finite normalized normals and complete LOD geometry', async () => {
    const kit = await decode();
    try {
      expect(kit.templates.size).toBe(9);
      for (const v of GUARDRAIL_VARIANTS)
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
            const normal = p.geometry.getAttribute('normal');
            for (let i = 0; i < normal.count; i++)
              expect(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i))).toBeCloseTo(1, 4);
          }
        }
    } finally {
      kit.dispose();
    }
  });
  it('closes the rotated terminal sheet without filling its corrugation valleys', async () => {
    const kit = await decode();
    try {
      for (const level of [0, 1, 2]) {
        const g = kit.templates
            .get(`terminal:${level}`)!
            .find((p) => p.material.name === 'A02_galvanized_steel')!.geometry,
          p = g.getAttribute('position'),
          ix = g.index!,
          a = new T.Vector3(),
          b = a.clone(),
          c = a.clone(),
          u = a.clone(),
          v = a.clone(),
          hit = a.clone(),
          gap = new T.Ray(new T.Vector3(0.4, 0.44, 3.68), new T.Vector3(-1, 0, 0)),
          sheet = new T.Ray(new T.Vector3(0.4, 0.445, 3.746), new T.Vector3(-1, 0, 0));
        let capTriangles = 0,
          sheetHits = 0;
        for (let i = 0; i < ix.count; i += 3) {
          a.fromBufferAttribute(p, ix.getX(i));
          b.fromBufferAttribute(p, ix.getX(i + 1));
          c.fromBufferAttribute(p, ix.getX(i + 2));
          if (Math.min(a.x, b.x, c.x) < 0.22 || Math.max(a.x, b.x, c.x) > 0.225) continue;
          if (u.copy(b).sub(a).cross(v.copy(c).sub(a)).x <= 1e-10) continue;
          capTriangles++;
          expect(gap.intersectTriangle(a, b, c, true, hit)).toBeNull();
          if (sheet.intersectTriangle(a, b, c, true, hit)) sheetHits++;
        }
        expect(capTriangles).toBeGreaterThan(0);
        expect(sheetHits).toBeGreaterThan(0);
      }
    } finally {
      kit.dispose();
    }
  });
  it('places posts outside each track side and preserves source geometry through mirrored end treatments', async () => {
    const kit = await decode(),
      track = new Track('clear');
    try {
      const template = kit.templates.get('transition:0')![0].geometry,
        original = Array.from(template.getAttribute('position').array);
      for (const side of [-1, 1])
        for (const reverse of [false, true]) {
          const start = 715,
            end = 718.7,
            g = conformGuardrailGeometry(template, track, start, end, side, reverse),
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
  it('retains the existing full-lap barrier segment coverage without overlapping concrete and steel', async () => {
    const steel = await decode(),
      concrete = await decodeConcreteBarriers(
        new Uint8Array(readFileSync('public/models/aurel-concrete-barriers.glb')),
        loader(),
      ),
      track = new Track('clear'),
      root = new T.Group(),
      water = track.water.slice();
    try {
      const spans = Math.ceil(track.length / 80);
      let total = 0;
      for (let i = 0; i < spans; i++) {
        const a = (track.length * i) / spans,
          b = (track.length * (i + 1)) / spans;
        total += Math.ceil((b - a) / 3.8) * 2;
        concrete.buildChunk(track, root, a, b, (s, side) => !!guardrailRole(s, side));
        steel.buildChunk(track, root, a, b);
      }
      expect(steel.diagnostics().modules).toBeGreaterThan(150);
      expect(steel.diagnostics().transitions).toBe(8);
      expect(concrete.diagnostics().modules + steel.diagnostics().modules).toBe(total);
      expect(track.water).toEqual(water);
      expect(steel.diagnostics().physicsChanged).toBe(false);
      for (const c of steel.chunks) {
        expect(c.sphere.radius).toBeLessThan(50);
        expect(c.levels.filter((l) => l.visible)).toHaveLength(1);
      }
      const camera = new T.PerspectiveCamera(58, 16 / 9);
      camera.position.copy(steel.chunks[0].sphere.center);
      steel.update(camera, 'high');
      expect(steel.chunks[0].level).toBe(0);
      camera.position.addScalar(10000);
      steel.update(camera, 'high');
      expect(steel.chunks.every((c) => c.level === 2)).toBe(true);
    } finally {
      steel.dispose();
      concrete.dispose();
    }
  });
  it('retains fences and adds steel only inside the defined presentation runs', async () => {
    const kit = await decode(),
      track = new Track('clear'),
      root = new T.Group(),
      m = barrierMaterials();
    try {
      buildBarrierChunk(track, root, 380, 420, m, null, kit);
      expect(kit.diagnostics().modules).toBe(11);
      expect(root.children.some((o) => o.name === 'Circuit fence 380-420m')).toBe(true);
      const fence = root.children.find((o) => o.name === 'Circuit fence 380-420m') as T.Mesh;
      expect(fence.castShadow).toBe(false);
      expect(fence.receiveShadow).toBe(false);
      expect(guardrailRole(0, 1)).toBeNull();
      expect(guardrailRole(360, -1)).toEqual({ variant: 'transition', reverse: false });
      expect(guardrailRole(610, -1)).toEqual({ variant: 'transition', reverse: true });
      for (const r of GUARDRAIL_RANGES) {
        expect(r.start).toBeGreaterThan(330);
        expect(r.end).toBeLessThan(track.length - 220);
      }
    } finally {
      kit.dispose();
      root.traverse((o) => {
        if (o instanceof T.Mesh) o.geometry.dispose();
      });
      Object.values(m).forEach((x) => x.dispose());
    }
  });
  it('releases template and chunk resources exactly once', async () => {
    const kit = await decode();
    kit.buildChunk(new Track('clear'), new T.Group(), 380, 420);
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
      loadSteelGuardrails(() => true, 'https://example.invalid', fetcher),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).not.toHaveBeenCalled();
    await expect(
      loadSteelGuardrails(
        () => false,
        'https://example.invalid',
        async () => new Response(null, { status: 404 }),
      ),
    ).rejects.toThrow('Unable');
    await expect(
      loadSteelGuardrails(
        () => false,
        'https://example.invalid',
        async () => new Response(bytes().slice(0, -1)),
      ),
    ).rejects.toThrow('Truncated');
    await expect(
      loadSteelGuardrails(
        () => false,
        'https://example.invalid',
        async () => new Response(new Uint8Array(M.bytes + 1)),
      ),
    ).rejects.toThrow('exceeds');
  });
});
