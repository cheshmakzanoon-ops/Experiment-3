import { describe, expect, it } from 'vitest';
import { DEFAULT_BINDINGS } from '../src/input/bindings.ts';
import { BOARD_DISCIPLINES } from '../src/ui/disciplines.ts';
import {
  FIRST_RUN_KEY,
  firstLapHint,
  firstRunHtml,
  shouldShowFirstRun,
  validateFirstRun,
  type FirstRunRecord,
} from '../src/ui/first-run.ts';

const record: FirstRunRecord = {
  version: 1,
  at: 1_700_000_000_000,
  device: 'keys',
  discipline: 'gp',
  drove: true,
};

describe('first launch record', () => {
  it('is stored under its own key and round-trips', () => {
    expect(FIRST_RUN_KEY).toBe('firstrun:v1');
    expect(validateFirstRun(structuredClone(record))).toEqual(record);
    expect(validateFirstRun({ ...record, discipline: null })).toEqual({
      ...record,
      discipline: null,
    });
  });
  it('rejects anything it did not write', () => {
    for (const bad of [
      null,
      'seen',
      42,
      {},
      { ...record, version: 2 },
      { ...record, device: 'wheel' },
      { ...record, discipline: 'rally' },
      { ...record, at: -1 },
      { ...record, at: Number.NaN },
      { ...record, at: '1' },
    ])
      expect(validateFirstRun(bad), JSON.stringify(bad)).toBeNull();
    // A flag that is not a boolean is read as false, never trusted.
    expect(validateFirstRun({ ...record, drove: 'yes' })?.drove).toBe(false);
  });
});

describe('when the screen shows', () => {
  const base = { record: null, automated: false, search: '' };
  it('shows once for a player with no record, never after', () => {
    expect(shouldShowFirstRun(base)).toBe(true);
    expect(shouldShowFirstRun({ ...base, record })).toBe(false);
  });
  it('stays out of the way of scripted browsers unless asked', () => {
    expect(shouldShowFirstRun({ ...base, automated: true })).toBe(false);
    expect(shouldShowFirstRun({ ...base, automated: true, search: '?firstrun=1' })).toBe(true);
    expect(shouldShowFirstRun({ ...base, record, search: '?firstrun=1' })).toBe(true);
    expect(shouldShowFirstRun({ ...base, search: '?firstrun=0' })).toBe(false);
    expect(shouldShowFirstRun({ ...base, search: '?dev&firstrun=1' })).toBe(true);
  });
});

describe('first launch markup', () => {
  const html = firstRunHtml({ device: 'keys' });
  it('has two radio groups: the input and the four disciplines, with the defaults chosen', () => {
    expect(html.match(/role="radiogroup"/g)).toHaveLength(2);
    expect(html.match(/class="fr-device"/g)).toHaveLength(2);
    expect(html.match(/class="fr-plate"/g)).toHaveLength(BOARD_DISCIPLINES.length);
    expect(html.match(/aria-checked="true"/g)).toHaveLength(2);
    expect(html).toMatch(/data-device="keys" aria-checked="true" tabindex="0"/);
    expect(html).toMatch(/data-discipline="circuit" aria-checked="true" tabindex="0"/);
    expect(html.match(/tabindex="-1"/g)).toHaveLength(1 + 3);
    // Every radio is named by its group's visible label.
    expect(html).toContain('aria-labelledby="frDeviceLabel"');
    expect(html).toContain('aria-labelledby="frDisciplineLabel"');
  });
  it('preselects a connected controller and a chosen plate', () => {
    const pad = firstRunHtml({ device: 'pad', discipline: 'dirt' });
    expect(pad).toContain('class="fr" data-device="pad"');
    expect(pad).toMatch(/data-device="pad" aria-checked="true"/);
    expect(pad).toMatch(/data-discipline="dirt" aria-checked="true"/);
  });
  it('has one primary action and a skip, both native buttons with routed actions', () => {
    expect(html.match(/class="primary"/g)).toHaveLength(1);
    expect(html).toContain('data-action="firstrun:go"');
    expect(html).toContain('data-action="firstrun:skip"');
    const tags = [...html.matchAll(/<([a-z0-9]+)\b[^>]*\sdata-action="/g)].map((m) => m[1]);
    expect(new Set(tags)).toEqual(new Set(['button']));
    // A controller and a keyboard each get their own hint line.
    expect(html).toContain('data-for="keys"');
    expect(html).toContain('data-for="pad"');
  });
  it("shows the player's own keys and keeps to the copy rules", () => {
    const remapped = firstRunHtml({
      device: 'keys',
      bindings: { ...DEFAULT_BINDINGS, throttle: 'ArrowUp', brake: 'ArrowDown' },
    });
    expect(remapped).toContain('↑ throttle');
    expect(remapped).toContain('↓ brake');
    const text = html.replace(/<[^>]+>/g, ' ');
    expect(text).not.toMatch(/welcome|experience|unleash|get started|!/i);
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(html).not.toMatch(/animation|transition/);
  });
  it('escapes a hostile binding label', () => {
    const hostile = firstRunHtml({
      device: 'keys',
      bindings: { ...DEFAULT_BINDINGS, throttle: '<img src=x onerror=alert(1)>' },
    });
    expect(hostile).not.toContain('<img src=x');
  });
});

describe('first lap hint', () => {
  it('names the controls of the chosen input', () => {
    expect(firstLapHint('keys')).toMatch(/throttle · .* brake · .* steer · ESC pause/);
    expect(firstLapHint('pad')).toMatch(/Right trigger throttle · left trigger brake/);
    expect(firstLapHint('pad')).toContain('START pause');
  });
});
