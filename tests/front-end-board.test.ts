import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CIRCUITS, CIRCUIT_IDS } from '../src/simulation/circuits.ts';
import { Track } from '../src/simulation/track.ts';
import { SOLVANE } from '../src/simulation/open-world/region-data.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { circuitArt, circuitArtSvg, regionArtSvg, ART_VIEW } from '../src/ui/track-art.ts';
import {
  BOARD_DISCIPLINES,
  DISCIPLINE_SPECS,
  disciplineFacts,
  disciplineOf,
  entryDefaults,
  machinesFor,
  venuesFor,
} from '../src/ui/disciplines.ts';
import { glyph, plateSvg } from '../src/ui/glyphs.ts';
import { dialHtml, boardPlatesHtml } from '../src/ui/launch-board.ts';
import { nearestInDirection } from '../src/ui/menu-gamepad.ts';
import { UI_CUE_EVENT, uiCue } from '../src/ui/ui-cue.ts';

describe('track line art (derived from the real centreline)', () => {
  it('every circuit draws a finite closed path inside the view box', () => {
    for (const id of CIRCUIT_IDS) {
      const art = circuitArt(id);
      expect(art.d, id).not.toMatch(/NaN|Infinity/);
      expect(art.d.startsWith('M') && art.d.endsWith('Z'), id).toBe(true);
      const nums = art.d.match(/-?\d+(\.\d+)?/g)!.map(Number);
      for (let i = 0; i < nums.length; i += 2) {
        expect(nums[i], `${id} x`).toBeGreaterThanOrEqual(0);
        expect(nums[i], `${id} x`).toBeLessThanOrEqual(ART_VIEW.width);
        expect(nums[i + 1], `${id} y`).toBeGreaterThanOrEqual(0);
        expect(nums[i + 1], `${id} y`).toBeLessThanOrEqual(ART_VIEW.height);
      }
      expect(art.corners.length, id).toBe(CIRCUITS[id].corners.length);
      expect(art.drs.length, id).toBe(CIRCUITS[id].drsZones.length);
    }
  });
  it('samples the same curve as the race track (lap length matches Track)', () => {
    const track = new Track();
    const art = circuitArt(track.circuit);
    expect(art.length).toBe(track.length);
  });
  it('marks the start line, DRS zones and corner numbers on a paved circuit', () => {
    const svg = circuitArtSvg('aurel', { numbers: true });
    expect(svg).toContain('class="ta-start"');
    expect((svg.match(/class="ta-drs"/g) ?? []).length).toBe(CIRCUITS.aurel.drsZones.length);
    expect((svg.match(/class="ta-num"/g) ?? []).length).toBe(CIRCUITS.aurel.corners.length);
    expect(svg).toContain('aria-hidden="true"');
    expect(circuitArtSvg('aurel', { label: 'Aurel "map"' })).toContain(
      'aria-label="Aurel &#34;map&#34;"',
    );
  });
  it('marks jump take-offs on a terrain venue', () => {
    expect(circuitArtSvg('valley-ridge-mx')).toContain('class="ta-jump"');
    expect(circuitArtSvg('aurel')).not.toContain('ta-jump');
  });
  it('draws every festival road and event marker', () => {
    const svg = regionArtSvg(SOLVANE);
    expect((svg.match(/class="ta-rd"/g) ?? []).length).toBe(SOLVANE.roads.length);
    expect((svg.match(/class="ta-event"/g) ?? []).length).toBe(SOLVANE.events.length);
    expect(svg).not.toMatch(/NaN|Infinity/);
  });
});

describe('disciplines are views over the session form', () => {
  const ids = [...BOARD_DISCIPLINES];
  it('names four disciplines with distinct plate shapes and mottos', () => {
    expect(ids).toEqual(['circuit', 'gp', 'dirt', 'festival']);
    expect(new Set(ids.map((d) => DISCIPLINE_SPECS[d].shape)).size).toBe(4);
    expect(new Set(ids.map((d) => DISCIPLINE_SPECS[d].motto)).size).toBe(4);
    expect(new Set(ids.map((d) => DISCIPLINE_SPECS[d].numeral)).size).toBe(4);
    // The one-line brief under the plates is the career's own description of the skill.
    expect(DISCIPLINE_SPECS.gp.skill).toMatch(/lean angle/i);
  });
  it('derives the discipline from mode, machine and venue', () => {
    expect(disciplineOf({ mode: 'race', circuit: 'aurel', vehicle: 'apx01' })).toBe('circuit');
    expect(disciplineOf({ mode: 'race', circuit: 'aurel', vehicle: 'gpr1' })).toBe('gp');
    expect(disciplineOf({ mode: 'race', circuit: 'aurel', vehicle: 'bikes' })).toBe('gp');
    expect(disciplineOf({ mode: 'race', circuit: 'valley-ridge-mx', vehicle: 'mx450' })).toBe(
      'dirt',
    );
    expect(disciplineOf({ mode: 'race', circuit: 'kestrel-rx', vehicle: 'rcx6' })).toBe('dirt');
    expect(disciplineOf({ mode: 'festival', circuit: 'aurel', vehicle: 'sc7' })).toBe('festival');
    // A road car on a circuit is a (welcome) mismatch, not the festival.
    expect(disciplineOf({ mode: 'race', circuit: 'aurel', vehicle: 'sc7' })).toBe('circuit');
  });
  it('lists venues and machines from the registries', () => {
    expect(venuesFor('circuit').every((id) => !CIRCUITS[id].offroad)).toBe(true);
    expect(venuesFor('gp').length).toBeGreaterThan(0);
    expect(venuesFor('gp').every((id) => CIRCUITS[id].bikeSafe === true)).toBe(true);
    expect(venuesFor('dirt').sort()).toEqual(
      CIRCUIT_IDS.filter((id) => CIRCUITS[id].offroad).sort(),
    );
    expect(venuesFor('festival')).toEqual([]);
    const mx = machinesFor('dirt', 'valley-ridge-mx');
    expect(mx).toContain('mx450');
    expect(mx.every((id) => VEHICLES[id].bike?.offroad)).toBe(true);
    expect(machinesFor('dirt', 'kestrel-rx')).toContain('rcx6');
    expect(machinesFor('gp', 'aurel')).toContain('gpr1');
    expect(machinesFor('circuit', 'aurel')).toContain('apx01');
    expect(machinesFor('circuit', 'aurel')).not.toContain('gpr1');
    expect(machinesFor('festival', '').length).toBeGreaterThan(5);
  });
  it('writes only what must change when a discipline is entered', () => {
    const base = { mode: 'race', circuit: 'aurel', vehicle: 'apx01' };
    expect(entryDefaults('circuit', base)).toEqual({});
    expect(entryDefaults('circuit', { ...base, mode: 'festival' })).toEqual({ mode: 'race' });
    // Aurel is assessed for motorcycles: only the machine changes.
    const gp = entryDefaults('gp', base);
    expect(gp.circuit).toBeUndefined();
    expect(machinesFor('gp', '')).toContain(gp.vehicle);
    // A circuit not assessed for bikes moves to one that is.
    const unsafe = CIRCUIT_IDS.find((id) => !CIRCUITS[id].offroad && !CIRCUITS[id].bikeSafe)!;
    expect(venuesFor('gp')).toContain(entryDefaults('gp', { ...base, circuit: unsafe }).circuit);
    const fest = entryDefaults('festival', { ...base, vehicle: 'sk125' });
    expect(fest.mode).toBe('festival');
    expect(machinesFor('festival', '')).toContain(fest.vehicle);
    // A motocross track is not left selected under the open-world plate.
    expect(
      entryDefaults('festival', { ...base, circuit: 'valley-ridge-mx', vehicle: 'mx450' }).circuit,
    ).toBe(venuesFor('circuit')[0]);
    // A machine the festival already admits is kept.
    expect(entryDefaults('festival', { ...base, vehicle: 'sc7' }).vehicle).toBeUndefined();
  });
  it('captions come from data, not copy', () => {
    for (const d of ids) {
      const facts = disciplineFacts(d);
      expect(facts.count).toBeGreaterThan(0);
      expect(facts.machines).toBeGreaterThan(0);
    }
    expect(disciplineFacts('festival').count).toBe(SOLVANE.events.length);
  });
});

describe('board markup', () => {
  it('renders four radio plates and never an emoji', () => {
    const html = boardPlatesHtml();
    expect(html.match(/role="radio"/g)).toHaveLength(4);
    expect(html).toContain('role="radiogroup"');
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
  });
  it('keeps the native select as the labelled control and hides the hands from AT', () => {
    const html = dialHtml('weather', 'WEATHER', 'sun', '<select id="weather"></select>');
    expect(html.indexOf('<select id="weather">')).toBeLessThan(html.indexOf('class="lb-step"'));
    const hands = html.match(/<button[^>]*class="lb-step"[^>]*>/g)!;
    expect(hands).toHaveLength(2);
    for (const hand of hands) {
      expect(hand).toContain('aria-hidden="true"');
      expect(hand).toContain('tabindex="-1"');
    }
    expect(html.match(/<label>/g)).toHaveLength(1);
    // No interactive element inside the label other than the select.
    const label = html.match(/<label>(.*?)<\/label>/s)![1];
    expect(label).not.toContain('<button');
  });
  it('icons are inline SVG with square caps, plates carry numerals', () => {
    expect(glyph('sun')).toContain('stroke-linecap="square"');
    expect(glyph('sun')).toContain('aria-hidden="true"');
    expect(plateSvg('arch', '3')).toContain('>3</text>');
  });
});

describe('controller navigation and sound hooks', () => {
  const rect = (x: number, y: number, w = 100, h = 40) =>
    ({
      x,
      y,
      width: w,
      height: h,
      left: x,
      right: x + w,
      top: y,
      bottom: y + h,
    }) as DOMRect;
  it('walks a dial grid row by row', () => {
    // Two rows of three dials.
    const grid = [
      rect(0, 0),
      rect(110, 0),
      rect(220, 0),
      rect(0, 50),
      rect(110, 50),
      rect(220, 50),
    ];
    expect(nearestInDirection(grid[1], [grid[0], grid[2], grid[3], grid[4], grid[5]], 'down')).toBe(
      3,
    );
    expect(nearestInDirection(grid[4], [grid[0], grid[1], grid[2], grid[3], grid[5]], 'up')).toBe(
      1,
    );
    expect(nearestInDirection(grid[0], [grid[1], grid[2], grid[3]], 'right')).toBe(0);
    expect(nearestInDirection(grid[0], [grid[3]], 'right')).toBe(-1);
  });
  it('announces cues on window without playing audio', () => {
    const seen: string[] = [];
    const target = new EventTarget();
    target.addEventListener(UI_CUE_EVENT, (e) => seen.push((e as CustomEvent).detail.cue));
    uiCue('tick', target);
    uiCue('confirm', target);
    expect(seen).toEqual(['tick', 'confirm']);
  });
});

describe('front-end stylesheet follows the anti-slop rules', () => {
  const css = readFileSync('src/ui/front-end.css', 'utf8');
  it('defines the documented tokens', () => {
    for (const token of [
      '--mb-amber',
      '--mb-paper',
      '--mb-asphalt-1',
      '--mb-plate-circuit',
      '--mb-plate-gp',
      '--mb-plate-dirt',
      '--mb-plate-fest',
      '--mb-ease-snap',
      '--mb-d-tick',
    ])
      expect(css).toContain(`${token}:`);
  });
  it('has no purple or blue gradients, glass blur, emoji or lorem', () => {
    expect(css).not.toMatch(/backdrop-filter:\s*blur/);
    expect(css).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(css.toLowerCase()).not.toContain('lorem');
    // Hue check on every colour literal inside a gradient: nothing violet or indigo.
    for (const gradient of css.match(/(linear|radial|conic)-gradient\([^;]*\)/g) ?? [])
      for (const hex of gradient.match(/#[0-9a-f]{6}\b/gi) ?? []) {
        const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
        expect(b > r && b > g, `${hex} in ${gradient}`).toBe(false);
      }
  });
});

describe('the screens added in wave 3 follow the anti-slop rules too', () => {
  const sheets = [
    'career-board.css',
    'first-run.css',
    'results-board.css',
    'settings-guide.css',
    'screens-board.css',
  ];
  const read = (name: string) => readFileSync(`src/ui/${name}`, 'utf8');
  /** Rule bodies with their selectors, comments flattened (at-rule wrappers fall away). */
  const rules = (css: string) =>
    [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
      selector: m[1].trim(),
      body: m[2],
    }));
  it('has no gradient, glass, glow, emoji or lorem in any new sheet', () => {
    for (const name of sheets) {
      const css = read(name);
      expect(css, name).not.toMatch(/gradient\(/);
      expect(css, name).not.toMatch(/backdrop-filter\s*:\s*blur/);
      expect(css, name).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(css.toLowerCase(), name).not.toContain('lorem');
      // A glow is a blurred shadow: only hard offsets (a blur radius of 0) are allowed.
      for (const { body } of rules(css))
        for (const shadow of body.match(/box-shadow\s*:[^;]+/g) ?? [])
          expect(shadow, `${name}: ${shadow}`).not.toMatch(/\d+px\s+\d+px\s+[1-9]\d*px/);
    }
  });
  it('uses tokens, not colour literals, outside :root', () => {
    for (const name of sheets)
      for (const { selector, body } of rules(read(name))) {
        if (selector === ':root') continue;
        const literal = body.replace(/url\([^)]*\)/g, '').match(/#[0-9a-f]{3,8}\b|rgba?\(/i);
        expect(literal, `${name}: ${selector}`).toBeNull();
      }
  });
  it('sets no text below 11 px', () => {
    for (const name of sheets)
      for (const { selector, body } of rules(read(name))) {
        // SVG text inside a plate is in the plate's own viewBox units, not screen pixels.
        if (/plate-(caption|numeral)/.test(selector)) continue;
        for (const m of body.matchAll(/font(?:-size)?\s*:[^;]*?(\d+(?:\.\d+)?)px/g))
          expect(Number(m[1]), `${name}: ${selector}`).toBeGreaterThanOrEqual(11);
      }
  });
  it('declares no motion of its own and honours reduced motion', () => {
    for (const name of sheets) {
      const css = read(name);
      expect(css, name).not.toMatch(/@keyframes/);
      for (const { body } of rules(css))
        for (const m of body.matchAll(/\b(animation|transition)\s*:\s*([^;]+)/g))
          expect(m[2], `${name}: ${m[0]}`).toMatch(/^none\b/);
      expect(css, name).toContain('prefers-reduced-motion: reduce');
      expect(css, name).toContain("data-reduced-motion='true'");
    }
  });
  it('gives the colour-blind HUD four distinct timing colours, only under the setting', () => {
    const css = readFileSync('src/ui/hud-colourblind.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const blocks = rules(css);
    // The sheet used to be this one rule. The HUD legibility pass added the tyre temperature palette
    // (tests/hud-colourblind.test.ts), so the guard is now what it was for: the timing-colour rule comes
    // first and unchanged, and nothing in the sheet applies outside the setting.
    expect(blocks.length).toBeGreaterThanOrEqual(1);
    for (const block of blocks) expect(block.selector).toMatch(/^html\[data-colorblind='true'\] #hud/);
    expect(blocks[0].selector).toBe("html[data-colorblind='true'] #hud");
    const colours = Object.fromEntries(
      [...blocks[0].body.matchAll(/--t-(purple|green|yellow|red):\s*(#[0-9a-f]{6})/g)].map((m) => [
        m[1],
        m[2],
      ]),
    );
    expect(Object.keys(colours).sort()).toEqual(['green', 'purple', 'red', 'yellow']);
    expect(new Set(Object.values(colours)).size).toBe(4);
    // The identity layer itself still leaves the timing colours alone (tests/hud-identity.test.ts).
    expect(readFileSync('src/ui/hud-identity.css', 'utf8')).not.toMatch(
      /--t-(purple|green|yellow|red)\s*:/,
    );
  });
  it('keeps the old wordmark and the retired slogans out of the screens', () => {
    const files = [
      'team-hub.ts',
      'driving-academy.ts',
      'photo-studio.ts',
      'festival-hud.ts',
      'career-hub.ts',
      'first-run.ts',
      'results-board.ts',
      'results-card.ts',
      'settings-guide.ts',
      'loading-copy.ts',
      'launch-board.ts',
    ];
    for (const file of files) {
      const source = readFileSync(`src/ui/${file}`, 'utf8');
      expect(source, file).not.toMatch(/\bAPEX\b/);
      for (const slogan of [
        'Build something',
        'worth racing',
        'Hold the moment',
        'The open road',
        'Find your repeatable lap',
        'Make the next lap count',
        'Make the drive count',
        'Keep the workshop running',
        'The people behind the pace',
      ])
        expect(source, `${file}: ${slogan}`).not.toContain(slogan);
    }
    // The default livery and its decals carry the game's own fictional sponsor, never the legacy name.
    expect(readFileSync('src/storage/livery.ts', 'utf8')).not.toMatch(/'APEX'/);
  });
});

describe('the design-critic pass (wave 4): the legacy screens joined the board', () => {
  const read = (name: string) => readFileSync(`src/ui/${name}`, 'utf8');
  const rules = (css: string) =>
    [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
      selector: m[1].trim(),
      body: m[2],
    }));
  /** Sheets written or rewritten in wave 4: the pre-race screens, the festival panels, the type floor
   * and the loading board. They obey the board's rules, with one declared exception (the lower third
   * slides in; it carries its own reduced-motion guard). */
  const sheets = [
    'grid-presentation.css',
    'festival-board.css',
    'type-floor.css',
    'loading-board.css',
  ];
  it('has no gradient, glass, glow, emoji or colour literal outside :root', () => {
    for (const name of sheets) {
      const css = read(name);
      expect(css, name).not.toMatch(/gradient\(/);
      expect(css, name).not.toMatch(/backdrop-filter\s*:\s*blur/);
      expect(css, name).not.toMatch(/\p{Extended_Pictographic}/u);
      for (const { selector, body } of rules(css)) {
        for (const shadow of body.match(/box-shadow\s*:[^;]+/g) ?? [])
          expect(shadow, `${name}: ${shadow}`).not.toMatch(/\d+px\s+\d+px\s+[1-9]\d*px/);
        if (selector === ':root') continue;
        expect(
          body.replace(/url\([^)]*\)/g, '').match(/#[0-9a-f]{3,8}\b|rgba?\(/i),
          `${name}: ${selector}`,
        ).toBeNull();
      }
    }
  });
  it('sets no text below 11 px', () => {
    for (const name of sheets)
      for (const { selector, body } of rules(read(name))) {
        if (/plate-(caption|numeral)/.test(selector)) continue; // SVG units, not screen px
        for (const m of body.matchAll(/font(?:-size)?\s*:[^;]*?(\d+(?:\.\d+)?)px/g))
          expect(Number(m[1]), `${name}: ${selector}`).toBeGreaterThanOrEqual(11);
      }
  });
  it('moves only where it must, and says how to stop it', () => {
    for (const name of sheets) {
      const css = read(name);
      expect(css, name).not.toMatch(/@keyframes/);
      for (const { body } of rules(css))
        for (const m of body.matchAll(/\b(animation|transition)\s*:\s*([^;]+)/g))
          if (name !== 'grid-presentation.css' && name !== 'loading-board.css')
            expect(m[2], `${name}: ${m[0]}`).toMatch(/^none\b/);
      if (/transition\s*:\s*(?!none)/.test(css)) {
        expect(css, name).toContain('prefers-reduced-motion: reduce');
        expect(css, name).toContain("data-reduced-motion='true'");
      }
    }
  });
  it('keeps the F1-era red LIVE bug, the navy panels and the 9 px briefing labels out of the pre-race screens', () => {
    const css = read('grid-presentation.css') + readFileSync('src/ui/grid-presentation.ts', 'utf8');
    for (const legacy of [
      '#d6232b',
      'rgba(8,12,18',
      'rgba(6, 12, 16',
      'rgba(9, 12, 16',
      '#dfb985',
      '#c4c9ca',
      'font-size:9px',
    ])
      expect(css, legacy).not.toContain(legacy);
  });
  it('lifts the older sheets to the type floor from one place', () => {
    const css = read('type-floor.css');
    // Every selector the old sheets set under 11 px for a screen the player reads is in the floor
    // sheet: a few of them, as a tripwire for the list being deleted rather than a full cross-check.
    for (const selector of [
      '.small-note',
      '.range-row',
      '.mapping-grid label',
      '.credits-group li a',
      '.fest-pace small',
      '.academy-attempts li > span',
    ])
      expect(css, selector).toContain(selector);
    expect(css).toContain('var(--mb-f-label)');
    expect(css).toContain('var(--mb-f-note)');
    // It is injected last, after every other sheet.
    const source = read('launch-board.ts');
    expect(source.indexOf('${typeFloorCss}')).toBeGreaterThan(source.indexOf('${recordsCss}'));
  });
  it('puts the machine character line in the nameplate card, not in the board', () => {
    const source = readFileSync('src/ui/interface.ts', 'utf8');
    expect(source).toMatch(
      /<div class="car-card"><div class="car-label">[\s\S]*?<p class="machine-blurb" id="machineBlurb"><\/p><\/div>/,
    );
    expect(source).not.toMatch(/class="session-rules machine-blurb"/);
    const css = read('front-end.css');
    expect(css).toMatch(/#menu \.car-card \.machine-blurb/);
    // Hidden only below 680 px tall (the select keeps it as its accessible description).
    expect(css).toMatch(
      /@media \(max-height: 679px\)\s*\{[\s\S]*?#menu \.car-card \.machine-blurb/,
    );
    expect(css).not.toMatch(/max-height: 789px/);
  });
});

describe('token pairs meet WCAG AA (4.5:1 text, 3:1 large) where the screens use them', () => {
  const css = readFileSync('src/ui/front-end.css', 'utf8');
  const token = (name: string, sheet = css) => {
    const m = new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(sheet);
    if (!m) throw new Error(`token ${name} not found`);
    return m[1];
  };
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const t = (name: string) => token(name);
  const read = (name: string) => readFileSync(`src/ui/${name}`, 'utf8');
  it('text on asphalt: chalk, dim and faint on every surface step', () => {
    for (const ink of ['--mb-chalk', '--mb-chalk-dim', '--mb-chalk-faint'])
      for (const surface of ['--mb-asphalt-0', '--mb-asphalt-1', '--mb-asphalt-2'])
        expect(ratio(t(ink), t(surface)), `${ink} on ${surface}`).toBeGreaterThanOrEqual(4.5);
    // The faintest tier is only used on the three lowest steps; asphalt-3 carries chalk and dim.
    expect(ratio(t('--mb-chalk'), t('--mb-asphalt-3'))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(t('--mb-chalk-dim'), t('--mb-asphalt-3'))).toBeGreaterThanOrEqual(4.5);
  });
  it('ink on every fill it sits on: paper, amber, flag, go, wet and the plates', () => {
    for (const fill of [
      '--mb-paper',
      '--mb-amber',
      '--mb-flag',
      '--mb-go',
      '--mb-wet',
      '--mb-plate-circuit',
      '--mb-plate-gp',
      '--mb-plate-dirt',
      '--mb-plate-fest',
    ])
      expect(ratio(t('--mb-ink'), t(fill)), `ink on ${fill}`).toBeGreaterThanOrEqual(4.5);
    expect(ratio(t('--mb-paper-ink'), t('--mb-paper'))).toBeGreaterThanOrEqual(7);
  });
  it('signal and plate colours read as text on the asphalt they are printed on', () => {
    for (const ink of [
      '--mb-amber',
      '--mb-amber-deep',
      '--mb-flag-text',
      '--mb-go',
      '--mb-wet',
      '--mb-plate-circuit',
      '--mb-plate-gp',
      '--mb-plate-dirt',
      '--mb-plate-fest',
    ])
      expect(ratio(t(ink), t('--mb-asphalt-1')), `${ink} on asphalt-1`).toBeGreaterThanOrEqual(4.5);
  });
  it('the medal discs carry ink letters above 4.5:1, and the fastest-lap row carries chalk', () => {
    const wildcard = readFileSync('src/ui/wildcard-board.css', 'utf8');
    for (const medal of ['--mb-medal-gold', '--mb-medal-silver', '--mb-medal-bronze'])
      expect(ratio(t('--mb-ink'), token(medal, wildcard)), medal).toBeGreaterThanOrEqual(4.5);
    // The timing purple is a broadcast semantic kept as it is (style.css); the player's row on it
    // takes chalk (hud-identity.css), which clears 4.5:1 where ink did not (3.7:1).
    const purple = /--t-purple:\s*(#[0-9a-f]{6})/i.exec(
      readFileSync('src/ui/style.css', 'utf8'),
    )![1];
    expect(ratio(t('--mb-chalk'), purple)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(t('--mb-ink'), purple)).toBeLessThan(4.5);
    expect(read('hud-identity.css')).toMatch(
      /\.tower-row\.player\[data-fastest\][^{]*\{\s*color:\s*var\(--mb-chalk\)/,
    );
  });
  it('the high-contrast override only lifts the dim tiers, to at least 6:1 on every surface', () => {
    const block = /:root\[data-high-contrast='true'\]\s*\{([^}]*)\}/.exec(css)![1];
    const hc = (name: string) => new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(block)![1];
    for (const surface of ['--mb-asphalt-1', '--mb-asphalt-2', '--mb-asphalt-3'])
      for (const ink of ['--mb-chalk-dim', '--mb-chalk-faint']) {
        const lifted = ratio(hc(ink), t(surface));
        expect(lifted, `${ink} on ${surface}`).toBeGreaterThanOrEqual(6);
        expect(lifted, `${ink} on ${surface} is above the default`).toBeGreaterThan(
          ratio(t(ink), t(surface)),
        );
      }
  });
});
