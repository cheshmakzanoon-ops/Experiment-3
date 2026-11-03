import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** The race HUD's Paddock Board layer (src/ui/hud-identity.css) is a skin: it may change colour, type
 * and shape, never the footprint of a HUD group. e2e/28-race-hud-layout, 49-hud-footprint and
 * 52-vehicle-hud measure those footprints in a browser; this test keeps the layer from ever
 * declaring a geometry property so a later edit cannot slip a layout change past them. */
const css = readFileSync('src/ui/hud-identity.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
  selector: selector.trim().replace(/\s+/g, ' '),
  declarations: body
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => d.slice(0, d.indexOf(':')).trim()),
}));
const GEOMETRY = [
  /^(min-|max-)?(width|height)$/,
  /^(top|left|right|bottom|inset)/,
  /^(margin|padding)/,
  /^(grid|gap|row-gap|column-gap|flex|order|align|justify|place)/,
  /^(display|position|transform|translate|scale|rotate|zoom|float|overflow)/,
];
/** Declarations allowed because they only fit text inside a fixed-size header. */
const FITTING: Readonly<Record<string, readonly string[]>> = {
  '#hud[data-f1] .f1-session': ['flex', 'min-width', 'overflow', 'text-overflow', 'text-align'],
};

describe('the HUD identity layer', () => {
  it('parses into rules', () => {
    expect(blocks.length).toBeGreaterThan(15);
  });
  it('declares colour, type and shape only: no geometry property on any HUD element', () => {
    const offenders: string[] = [];
    for (const { selector, declarations } of blocks)
      for (const property of declarations) {
        if (property.startsWith('--')) continue;
        if (FITTING[selector]?.includes(property)) continue;
        if (GEOMETRY.some((pattern) => pattern.test(property)))
          offenders.push(`${selector} { ${property} }`);
      }
    expect(offenders).toEqual([]);
  });
  it('drops the F1 skin: no italic, no skew, no flame orange or pink, no blur', () => {
    expect(css).not.toMatch(/skew|italic|backdrop-filter|#ff5a2a|#fc4854|#ed6947/i);
    // It maps the old tokens onto the Paddock Board tokens.
    expect(css).toContain('--apex-flame: var(--mb-amber)');
    expect(css).toContain('--hud-panel:');
    expect(css).toContain('--hud-radius: 0px');
    expect(css).toContain('--hud-player-row: var(--mb-amber)');
    // Timing semantics are not redefined here.
    expect(css).not.toMatch(/--t-(purple|green|yellow|red)\s*:/);
    expect(css).not.toMatch(/--tyre-/);
  });
  it('names the game MOTOBOUND in the tower header and the bike HUD, not APEX', () => {
    const f1 = readFileSync('src/ui/f1-hud.ts', 'utf8');
    expect(f1).toContain('<b class="f1-wordmark">MOTOBOUND</b>');
    expect(f1).not.toContain('f1-wordmark">APEX');
    expect(readFileSync('src/ui/bike-hud.ts', 'utf8')).toContain("textContent = 'MOTOBOUND'");
  });
  it('is injected last, inside #hud after the older HUD sheets', () => {
    const board = readFileSync('src/ui/launch-board.ts', 'utf8');
    // The older sheets are appended inside #hud as it is built, so a head style loses to them.
    expect(board).toContain('export function installHudIdentity(hud: HTMLElement)');
    expect(board).toContain('hud.append(style)');
    expect(board).not.toMatch(/\$\{loadingCss\}\\n\$\{hudCss\}/);
    const face = readFileSync('src/ui/interface.ts', 'utf8');
    const built = [
      'installCompactRaceHud(',
      'installRaceDayHud(',
      'installF1Hud(',
      'new BikeHud(',
      'new OffroadHud(',
      'new MotocrossStatusStack(',
    ];
    const last = Math.max(...built.map((call) => face.indexOf(call)));
    expect(last).toBeGreaterThan(0);
    expect(face.indexOf('installHudIdentity(this.hud)')).toBeGreaterThan(last);
  });
});
