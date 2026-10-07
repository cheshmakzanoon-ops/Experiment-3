import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import * as T from 'three';
import {
  BRANDS,
  BRAND_ART,
  BRAND_FONT_CHARACTERS,
  FALLBACK_DECAL_ART,
  KEPT_DECALS,
  SUPPLIED_DECAL_ART,
  decalKey,
  drawMark,
  drawWordmark,
  fitHeight,
  markTexture,
  suppliedDecalArt,
  wordmarkWidth,
  type MarkArt,
} from '../src/rendering/studio/brand-atlas.ts';

/** A context that records every call and property write, in order. */
function recorder() {
  const calls: string[] = [];
  const target: Record<string, unknown> = {};
  const context = new Proxy(target, {
    get(t, key: string) {
      if (key in t) return t[key];
      return (...args: unknown[]) => {
        calls.push(
          `${key}(${args.map((a) => (typeof a === 'number' ? a.toFixed(3) : String(a))).join(',')})`,
        );
      };
    },
    set(t, key: string, value) {
      calls.push(`${key}=${String(value)}`);
      t[key] = value;
      return true;
    },
  });
  return { context: context as unknown as CanvasRenderingContext2D, calls };
}
afterEach(() => vi.unstubAllGlobals());

const raw = gunzipSync(
  readFileSync(new URL('../public/models/supplied-player.glb.gz', import.meta.url)),
);
const gltf = JSON.parse(raw.subarray(20, 20 + raw.readUInt32LE(12)).toString()) as {
  materials: { name: string }[];
};
const decalNames = gltf.materials.map((m) => m.name).filter((n) => n.startsWith('Decal |'));
const words = new Set(BRANDS.flatMap((brand) => brand.split(' ')));
const artText = (art: MarkArt) => art.lines.flatMap((line) => line.split(' ')).filter(Boolean);

describe('fictional brand atlas (P13/P19)', () => {
  it('holds exactly the canonical fictional brand list', () => {
    expect([...BRANDS]).toEqual([
      'VOLTEX',
      'NORDFIN',
      'KESTREL TIME',
      'HALCYON AIR',
      'ORBITEL',
      'MERIDIAN OIL',
      'AUREL BANK',
      'VANTA',
      'NORTHLINE',
      'OBSIDIAN',
      'APEX CORSA',
      'SLICK 18',
    ]);
    for (const brand of BRANDS) expect(BRAND_ART[brand].lines.join(' ')).toBe(brand);
  });
  it('draws only canonical brand words, in characters the stroke font owns', () => {
    for (const art of [
      ...Object.values(SUPPLIED_DECAL_ART),
      FALLBACK_DECAL_ART,
      ...Object.values(BRAND_ART),
    ])
      for (const word of artText(art)) {
        expect(words.has(word), word).toBe(true);
        for (const c of word) expect(BRAND_FONT_CHARACTERS.includes(c), c).toBe(true);
      }
  });
  it('replaces every sponsor sheet on the supplied car with explicit original art', () => {
    expect(decalNames.length).toBeGreaterThan(20);
    for (const name of decalNames) {
      const key = decalKey(name)!;
      expect(key, name).not.toBeNull();
      if (KEPT_DECALS.includes(key)) expect(suppliedDecalArt(name)).toBeNull();
      else {
        expect(SUPPLIED_DECAL_ART[key], name).toBeDefined();
        expect(suppliedDecalArt(name)).toBe(SUPPLIED_DECAL_ART[key]);
      }
    }
    expect(suppliedDecalArt('Paint | vermilion')).toBeNull();
    expect(suppliedDecalArt('Decal | some_future_sheet')).toBe(FALLBACK_DECAL_ART);
    expect(decalKey('Decal | oracle | curve-local')).toBe('oracle');
  });
  it('measures, fits and draws deterministically with paths only (no system font)', () => {
    const a = recorder(),
      b = recorder();
    for (const r of [a, b]) {
      drawWordmark(r.context, 'VOLTEX 18', 100, 50, 40, { slant: 0.2 });
      for (const art of Object.values(SUPPLIED_DECAL_ART))
        drawMark(r.context, art, 0, 0, 1024, 256);
    }
    expect(a.calls).toEqual(b.calls);
    expect(a.calls.some((c) => c.startsWith('fillText') || c.startsWith('font='))).toBe(false);
    expect(a.calls.filter((c) => c.startsWith('stroke(')).length).toBeGreaterThan(40);
    const w = wordmarkWidth('NORDFIN', 10);
    expect(wordmarkWidth('NORDFIN', 20)).toBeCloseTo(w * 2, 6);
    expect(wordmarkWidth('NORDFIN', 10, { width: 1.3 })).toBeGreaterThan(w);
    const h = fitHeight('NORTHLINE', 300, 80);
    expect(wordmarkWidth('NORTHLINE', h)).toBeLessThanOrEqual(300 + 1e-6);
    expect(() => drawWordmark(a.context, 'X', 0, 0, NaN)).toThrow();
    expect(() => drawWordmark(a.context, 'X', 0, 0, 10, { weight: 0 })).toThrow();
  });
  it('keeps the replaced sheet aspect, sampling and UV transform', () => {
    const { context } = recorder();
    vi.stubGlobal('document', {
      createElement: () => ({ width: 0, height: 0, getContext: () => context }),
    });
    const source = new T.Texture({ width: 1024, height: 141 } as unknown as HTMLImageElement);
    source.flipY = false;
    source.colorSpace = T.SRGBColorSpace;
    source.wrapS = T.RepeatWrapping;
    source.offset.set(0.1, 0.2);
    source.repeat.set(2, 3);
    source.channel = 1;
    const texture = markTexture(source, SUPPLIED_DECAL_ART.oracle);
    const image = texture.image as { width: number; height: number };
    expect([image.width, image.height]).toEqual([1024, 141]);
    expect(texture.flipY).toBe(false);
    expect(texture.colorSpace).toBe(T.SRGBColorSpace);
    expect(texture.wrapS).toBe(T.RepeatWrapping);
    expect(texture.offset.toArray()).toEqual([0.1, 0.2]);
    expect(texture.repeat.toArray()).toEqual([2, 3]);
    expect(texture.channel).toBe(1);
    expect(texture.userData.fictionalMark).toBe('VOLTEX');
    texture.dispose();
  });
});
