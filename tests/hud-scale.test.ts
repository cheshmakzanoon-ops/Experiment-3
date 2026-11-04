import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AUTO_HUD_SCALE_BELOW,
  AUTO_HUD_SCALE_SHORT,
  DEFAULT_HUD_SCALE,
  HUD_SCALES,
  applyHudScale,
  resolveHudScale,
  validateHudScale,
} from '../src/core/hud-scale.ts';
import { DEFAULT_SETTINGS, validateSettings } from '../src/storage/data.ts';
import { hudScaleSection } from '../src/ui/hud-scale-control.ts';

/** HUD SCALE (docs/studio/reports/hud-legibility.md): the setting, its validation and migration, the
 * automatic default and the style sheets that read it. The pixel result is measured in a browser
 * (e2e/65-hud-legibility.spec.ts); this keeps the pieces that feed it honest. */
const css = (path: string) => readFileSync(path, 'utf8');

describe('the HUD SCALE setting', () => {
  it('offers 100, 115, 130 and 150 percent and defaults to automatic', () => {
    expect([...HUD_SCALES]).toEqual([1, 1.15, 1.3, 1.5]);
    expect(DEFAULT_HUD_SCALE).toBe('auto');
    expect(DEFAULT_SETTINGS.hudScale).toBe('auto');
  });
  it('validates: auto, a step, the nearest step to a number or a numeric string; anything else is auto', () => {
    expect(validateHudScale('auto')).toBe('auto');
    for (const step of HUD_SCALES) expect(validateHudScale(step)).toBe(step);
    expect(validateHudScale(1.3)).toBe(1.3);
    expect(validateHudScale('1.5')).toBe(1.5);
    expect(validateHudScale(1.2)).toBe(1.15);
    expect(validateHudScale(1.4)).toBe(1.3);
    expect(validateHudScale(0.2)).toBe(1);
    expect(validateHudScale(9)).toBe(1.5);
    for (const junk of [undefined, null, '', 'big', NaN, Infinity, {}, [], true, '  '])
      expect(validateHudScale(junk)).toBe('auto');
  });
  it('is automatic until the player chooses: 115% under 900 px tall, 100% above, a choice always honoured', () => {
    expect(AUTO_HUD_SCALE_BELOW).toBe(900);
    expect(AUTO_HUD_SCALE_SHORT).toBe(1.15);
    for (const height of [600, 680, 720, 768, 800, 899]) expect(resolveHudScale('auto', height)).toBe(1.15);
    for (const height of [900, 1080, 1440, 2160]) expect(resolveHudScale('auto', height)).toBe(1);
    for (const step of HUD_SCALES)
      for (const height of [720, 800, 1080]) expect(resolveHudScale(step, height)).toBe(step);
  });
  it('the style sheet decides automatic by the same height, so a resized window follows without a reload', () => {
    const sheet = css('src/ui/style.css');
    const query = new RegExp(
      `@media \\(max-height: ${AUTO_HUD_SCALE_BELOW - 1}px\\) \\{\\s*\\.hud,\\s*\\.fest-hud \\{\\s*--hud-auto: ${AUTO_HUD_SCALE_SHORT};`,
    );
    expect(sheet).toMatch(query);
    // The base rule leaves --hud-scale to the setting and falls back to the automatic value.
    expect(sheet).toMatch(/--hud-k: calc\(var\(--ui-scale, 1\) \* var\(--hud-scale, var\(--hud-auto\)\)\)/);
  });
  it('applies live: a step is a custom property on the root, auto removes it', () => {
    const props = new Map<string, string>();
    const root = {
      style: {
        setProperty: (name: string, value: string) => props.set(name, value),
        removeProperty: (name: string) => props.delete(name),
      },
      dataset: {} as Record<string, string>,
    } as unknown as HTMLElement;
    applyHudScale(root, 1.3);
    expect(props.get('--hud-scale')).toBe('1.3');
    expect(root.dataset.hudScale).toBe('1.3');
    applyHudScale(root, 'auto');
    expect(props.has('--hud-scale')).toBe(false);
    expect(root.dataset.hudScale).toBe('auto');
  });
});

describe('the HUD SCALE in saved settings', () => {
  it('saves from before the setting existed read as automatic (every settings version)', () => {
    for (const version of [1, 2, 3, 4, 5, 6]) expect(validateSettings({ version }).hudScale).toBe('auto');
  });
  it('keeps a valid choice and replaces a bad one with automatic', () => {
    for (const step of HUD_SCALES) expect(validateSettings({ version: 6, hudScale: step }).hudScale).toBe(step);
    expect(validateSettings({ version: 6, hudScale: 'auto' }).hudScale).toBe('auto');
    expect(validateSettings({ version: 6, hudScale: 'huge' }).hudScale).toBe('auto');
    expect(validateSettings({ version: 6, hudScale: 1.2 }).hudScale).toBe(1.15);
  });
  it('survives a save and a load', () => {
    const saved = JSON.parse(JSON.stringify({ ...DEFAULT_SETTINGS, hudScale: 1.3 }));
    expect(validateSettings(saved).hudScale).toBe(1.3);
    expect(validateSettings(JSON.parse(JSON.stringify(DEFAULT_SETTINGS))).hudScale).toBe('auto');
  });
  it('does not touch the interface text size it sits beside', () => {
    expect(validateSettings({ version: 6, uiScale: 1.2, hudScale: 1.5 })).toMatchObject({
      uiScale: 1.2,
      hudScale: 1.5,
    });
  });
});

describe('the HUD section of the settings screen', () => {
  it('is one dial with automatic and the four steps, the saved one selected', () => {
    for (const setting of ['auto', ...HUD_SCALES] as const) {
      const html = hudScaleSection(setting);
      expect(html).toContain('<legend>HUD</legend>');
      expect(html).toContain('name="hudScale"');
      const options = [...html.matchAll(/<option value="([^"]+)"( selected)?>/g)];
      expect(options.map((m) => m[1])).toEqual(['auto', '1', '1.15', '1.3', '1.5']);
      expect(options.filter((m) => m[2]).map((m) => m[1])).toEqual([String(setting)]);
    }
    expect(hudScaleSection('auto')).toContain('115% on screens under 900 px tall');
  });
});

describe('the HUD sheets read the one multiplier', () => {
  it('the desktop layout unit is the HUD scale times a unit that never drops under 8 px, capped by the window', () => {
    const f1 = css('src/ui/f1-hud.css');
    expect(f1).toMatch(/--u: min\(calc\(var\(--hud-k, var\(--ui-scale, 1\)\) \* max\(8px, min\(1vh, 0\.5625vw\)\)\), 1\.55vh, 0\.8vw\);/);
  });
  it('the GP bike panel is sized in --bp (a CSS px times the HUD scale), not in px times the interface size alone', () => {
    const bike = css('src/ui/bike-hud.css');
    expect(bike).toMatch(/--bp: min\(calc\(max\(1px, 0\.125vh\) \* min\(var\(--hud-k, var\(--ui-scale, 1\)\), 1\.5\)\), max\(1px, 0\.16vh\)\);/);
    expect(bike).not.toMatch(/px \* var\(--ui-scale/);
  });
});
