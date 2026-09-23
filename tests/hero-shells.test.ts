import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import * as T from 'three';
import { HeroShells, bakeHeroGeometry, loadHeroShells } from '../src/rendering/hero-shells.ts';
import { sculptedLoft } from '../src/rendering/bodywork.ts';
import { NOSE_SECTIONS, ENGINE_SECTIONS, sidepodShell } from '../src/rendering/car-surfaces.ts';
import { openFrontCap } from '../src/rendering/car-mechanical-detail.ts';

const compressed = new Uint8Array(
  readFileSync(new URL('../src/rendering/apx01-shell.glb.gz', import.meta.url)),
);
const decoded = new Uint8Array(gunzipSync(compressed));
const baseline = () => ({
  nose: sculptedLoft(NOSE_SECTIONS, 0, 0.32),
  engine: openFrontCap(sculptedLoft(ENGINE_SECTIONS, 0, 0.18)),
  sidepod: openFrontCap(sidepodShell()),
});

describe('27H real Blender glTF integration', () => {
  it.each([false, true])(
    'loads the exact %s transport with actual GLTFLoader and preserves metre envelopes/paint UVs',
    async (raw) => {
      const asset = await HeroShells.decode(raw ? decoded : compressed);
      const seeds = baseline();
      expect(asset.diagnostics().loaded).toBe(true);
      expect(asset.diagnostics().finalArtApproved).toBe(false);
      for (const part of ['nose', 'engine', 'sidepod'] as const) {
        const g = asset.copy(part),
          source = seeds[part];
        source.computeBoundingBox();
        const p = g.getAttribute('position'),
          n = g.getAttribute('normal'),
          uv = g.getAttribute('uv');
        expect(p.array).toBeInstanceOf(Float32Array);
        expect(n.array).toBeInstanceOf(Float32Array);
        expect([...p.array, ...n.array, ...uv.array].every(Number.isFinite)).toBe(true);
        for (const end of ['min', 'max'] as const)
          expect(g.boundingBox![end].distanceTo(source.boundingBox![end])).toBeLessThan(0.0025);
        for (let i = 0; i < p.count; i += 13) {
          expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 5);
          expect(uv.getX(i)).toBeGreaterThanOrEqual(-0.00001);
          expect(uv.getX(i)).toBeLessThanOrEqual(1.00001);
          expect(uv.getY(i)).toBeGreaterThanOrEqual(-0.00001);
          expect(uv.getY(i)).toBeLessThanOrEqual(1.00001);
        }
        // Match actual authored surface samples against their modelling input.
        // Check the best UV among coincident seam vertices, not only bounding boxes.
        const sp = source.getAttribute('position'),
          su = source.getAttribute('uv');
        let compared = 0;
        for (let i = 0; i < p.count; i += 37) {
          let uvError = Infinity;
          for (let j = 0; j < sp.count; j++) {
            const d = Math.hypot(
              p.getX(i) - sp.getX(j),
              p.getY(i) - sp.getY(j),
              p.getZ(i) - sp.getZ(j),
            );
            if (d < 0.00008)
              uvError = Math.min(
                uvError,
                Math.hypot(uv.getX(i) - su.getX(j), uv.getY(i) - su.getY(j)),
              );
          }
          if (Number.isFinite(uvError)) {
            expect(uvError).toBeLessThan(0.00003);
            compared++;
          }
        }
        expect(compared).toBeGreaterThan(10);
        expect(g.index!.count).toBeGreaterThan(300);
        source.dispose();
        g.dispose();
      }
      asset.dispose();
    },
  );
  it('owns independent clones and releases prototypes without invalidating another renderer or a car', async () => {
    const a = await HeroShells.decode(compressed),
      b = await HeroShells.decode(compressed);
    const first = a.copy('nose'),
      second = a.copy('nose'),
      other = b.copy('nose');
    const old = second.getAttribute('position').getX(0);
    first.getAttribute('position').setX(0, 123);
    expect(second.getAttribute('position').getX(0)).toBe(old);
    expect(other.getAttribute('position').getX(0)).toBe(old);
    const disposed = vi.fn();
    first.addEventListener('dispose', disposed);
    a.dispose();
    a.dispose();
    expect(disposed).not.toHaveBeenCalled();
    expect(() => a.copy('nose')).toThrow('disposed');
    const engine = b.copy('engine');
    expect(engine.getAttribute('position').count).toBeGreaterThan(0);
    engine.dispose();
    first.dispose();
    second.dispose();
    other.dispose();
    b.dispose();
  });
  it('decodes an exact raw GLB view without consuming unrelated backing-buffer bytes', async () => {
    const backing = new Uint8Array(decoded.length + 64);
    backing.set(decoded, 32);
    const asset = await HeroShells.decode(backing.subarray(32, 32 + decoded.length));
    expect(asset.diagnostics().loaded).toBe(true);
    asset.dispose();
  });
  it('rejects corrupted bytes, HTML error pages, truncation, and already cancelled requests', async () => {
    const corrupt = compressed.slice();
    corrupt[50] ^= 1;
    for (const bytes of [
      corrupt,
      compressed.slice(0, -1),
      new TextEncoder().encode('<html>not a model</html>'),
    ])
      await expect(HeroShells.decode(bytes)).rejects.toThrow('integrity');
    const controller = new AbortController();
    controller.abort();
    await expect(HeroShells.decode(compressed, controller.signal)).rejects.toThrow('cancelled');
  });
  it('bakes normalized integer positions and normals before nonuniform transforms', () => {
    const g = new T.BufferGeometry();
    g.setAttribute(
      'position',
      new T.Int16BufferAttribute([-32767, 0, 0, 32767, 0, 0, 0, 32767, 0], 3, true),
    );
    g.setAttribute('normal', new T.Int8BufferAttribute([0, 0, 127, 0, 0, 127, 0, 0, 127], 3, true));
    g.setAttribute('uv', new T.Uint16BufferAttribute([0, 0, 65535, 0, 32767, 65535], 2, true));
    g.setIndex([0, 1, 2]);
    const mesh = new T.Mesh(g, new T.MeshBasicMaterial());
    mesh.position.set(0, 0, 1.25);
    mesh.scale.set(0.275, 0.125, 0.075);
    mesh.updateMatrixWorld();
    const baked = bakeHeroGeometry(mesh),
      p = baked.getAttribute('position');
    expect(p.getX(0)).toBeCloseTo(-0.275, 6);
    expect(p.getY(2)).toBeCloseTo(0.125, 6);
    expect(p.getZ(0)).toBeCloseTo(1.25, 6);
    expect(baked.getAttribute('uv').getY(0)).toBe(1);
    expect(baked.getAttribute('uv').getY(2)).toBe(0);
    expect(g.getAttribute('position').getX(0)).toBe(-1);
    baked.dispose();
    g.dispose();
    mesh.material.dispose();
  });
  it('loads a real streamed response and rejects oversized or HTTP-error responses', async () => {
    const fetcher = vi.fn(async () => new Response(compressed)) as unknown as typeof fetch;
    const asset = await loadHeroShells(() => false, fetcher, '/assets/body.glb.gz');
    expect(asset.diagnostics().loaded).toBe(true);
    asset.dispose();
    expect(fetcher).toHaveBeenCalledWith(
      '/assets/body.glb.gz',
      expect.objectContaining({ credentials: 'same-origin', signal: expect.any(AbortSignal) }),
    );
    await expect(
      loadHeroShells(
        () => false,
        (async () => new Response('Not found', { status: 404 })) as typeof fetch,
      ),
    ).rejects.toThrow('HTTP 404');
    await expect(
      loadHeroShells(
        () => false,
        (async () => new Response(new Uint8Array(130000))) as typeof fetch,
      ),
    ).rejects.toThrow('budget');
  });
  it('aborts pending network work and does not leave a cancellation timer', async () => {
    let cancel = false;
    const fetcher = ((_url, options) =>
      new Promise<Response>((_resolve, reject) => {
        options!.signal!.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        );
      })) as typeof fetch;
    const pending = loadHeroShells(() => cancel, fetcher);
    cancel = true;
    await expect(pending).rejects.toThrow('Aborted');
    const never = vi.fn();
    await expect(loadHeroShells(() => true, never as typeof fetch)).rejects.toThrow('cancelled');
    expect(never).not.toHaveBeenCalled();
  });
});
