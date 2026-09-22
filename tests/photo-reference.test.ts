import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PHOTO,
  photoFov,
  photoOffset,
  validatePhoto,
} from '../src/rendering/photo-camera.ts';
import { DEFAULT_LIVERY, LIVERY_PRESETS, validateLivery } from '../src/storage/livery.ts';
import { REFERENCES } from '../src/ui/reference-catalogue.ts';
import { referenceReview } from '../src/ui/reference-review.ts';
describe('photo camera and safe original livery', () => {
  it('bounds non-finite camera values and subject selection', () => {
    expect(validatePhoto(null)).toEqual(DEFAULT_PHOTO);
    expect(validatePhoto({ azimuth: Infinity, target: 7, distance: -5, exposure: 100 }, 3)).toEqual(
      { ...DEFAULT_PHOTO, target: 2, distance: 2, exposure: 2 },
    );
    expect(validatePhoto({ target: 10 }, NaN).target).toBe(0);
    expect(
      Object.entries(validatePhoto({ focalLength: NaN, roll: -Infinity }))
        .filter(
          ([key]) => !['backdrop', 'depthOfField', 'focusMode', 'survey', 'view'].includes(key),
        )
        .every(([, value]) => Number.isFinite(value)),
    ).toBe(true);
  });
  it('makes a long lens narrower and keeps orbit distance independent of azimuth', () => {
    expect(photoFov(50)).toBeCloseTo(26.991, 2);
    expect(photoFov(150)).toBeLessThan(photoFov(18));
    expect(() => photoFov(0)).toThrow();
    expect(() => photoFov(Infinity)).toThrow();
    for (let azimuth = -180; azimuth <= 180; azimuth += 10) {
      const [x, y, z] = photoOffset({ ...DEFAULT_PHOTO, azimuth });
      expect(Math.hypot(x, y - 0.15, z)).toBeCloseTo(DEFAULT_PHOTO.distance, 8);
    }
  });
  it('accepts only bounded paint, graphics and wordmark values', () => {
    expect(validateLivery(null)).toEqual(DEFAULT_LIVERY);
    expect(
      validateLivery({
        primary: '#AABBCD',
        accent: 'red',
        sponsor: '<b>north</b>😀',
        number: 500,
        pattern: 'arbitrary',
      }),
    ).toEqual({
      primary: '#aabbcd',
      accent: DEFAULT_LIVERY.accent,
      sponsor: 'BNORTHB',
      number: 99,
      pattern: 'sweep',
    });
    expect(validateLivery({ sponsor: 'a'.repeat(100), number: NaN }).sponsor).toHaveLength(14);
    expect(validateLivery({ sponsor: '😀' }).sponsor).toBe('APEX');
    for (const preset of Object.values(LIVERY_PRESETS))
      expect(validateLivery(preset)).toEqual(preset);
  });
});
describe('individually traceable reference inventory', () => {
  it('accounts for exactly 001–100 without inventing extra features', () => {
    expect(REFERENCES.map((r) => r.id)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
    expect(REFERENCES.filter((r) => r.status === 'excluded').map((r) => r.id)).toEqual(
      Array.from({ length: 16 }, (_, i) => i + 50),
    );
    expect(REFERENCES.filter((r) => r.status === 'supplementary').map((r) => r.id)).toEqual([
      48, 49,
    ]);
    expect(REFERENCES.filter((r) => r.duplicateOf)).toHaveLength(15);
  });
  it('records exact file evidence and real code ownership with a gap for every row', () => {
    for (const r of REFERENCES) {
      expect(r.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(r.width).toBeGreaterThan(0);
      expect(r.height).toBeGreaterThan(0);
      expect(r.observation.length).toBeGreaterThan(40);
      expect(r.gap.length).toBeGreaterThan(30);
      expect(r.file.startsWith(String(r.id).padStart(3, '0'))).toBe(true);
      if (r.duplicateOf) expect(r.duplicateOf).toBeLessThan(r.id);
      for (const path of r.code) expect(existsSync(path), path).toBe(true);
      if (r.status === 'excluded') expect(r.code).toEqual([]);
    }
  });
  it('keeps missing night/cinematics/leaderboards and unrelated artwork explicit', () => {
    for (const id of [38, 40, 47, 69, 79, 80, 87])
      expect(REFERENCES[id - 1].status).toBe('partial');
    const html = referenceReview();
    expect(html.match(/data-reference=/g)).toHaveLength(100);
    expect(html).not.toContain('<img');
    expect(html).toContain('not pixel parity');
  });
});

// Native views are a closed enum, not numeric camera measurements. Keep the
// original finite-number guard above and check the enum separately.
describe('native photo-view validation', () => {
  it.each(['orbit', 'cockpit', 'pod', 'chase', 'trackside'] as const)(
    'keeps %s on the circuit and uses orbit for both showrooms',
    (view) => {
      const request = { ...DEFAULT_PHOTO, view, focalLength: NaN, roll: -Infinity };
      const before = { ...request };
      expect(validatePhoto(request)).toEqual({ ...DEFAULT_PHOTO, view });
      for (const backdrop of ['studio', 'headquarters'] as const)
        expect(validatePhoto({ ...request, backdrop })).toEqual({
          ...DEFAULT_PHOTO,
          backdrop,
          view: 'orbit',
        });
      expect(request).toEqual(before);
    },
  );
  it('rejects malformed and inherited-name view values without coercion', () => {
    for (const view of [undefined, null, true, 0, NaN, {}, [], 'unknown', '__proto__', 'toString'])
      expect(validatePhoto({ view })).toEqual(DEFAULT_PHOTO);
  });
  it('defaults every numeric field for non-finite or non-numeric input', () => {
    const numericKeys = [
      'azimuth',
      'elevation',
      'distance',
      'focalLength',
      'exposure',
      'roll',
      'target',
      'focusSubject',
      'focusDistance',
      'fStop',
      'split',
    ];
    expect(
      Object.entries(DEFAULT_PHOTO)
        .filter(([, value]) => typeof value === 'number')
        .map(([key]) => key),
    ).toEqual(numericKeys);
    for (const invalid of [NaN, Infinity, -Infinity, '1', null, undefined, {}, [], true])
      expect(
        validatePhoto(Object.fromEntries(numericKeys.map((key) => [key, invalid])), 12),
      ).toEqual(DEFAULT_PHOTO);
  });
});
