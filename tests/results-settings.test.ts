import { describe, expect, it } from 'vitest';
import { liveRegistry } from '../src/career/registry.ts';
import { seasonPlan } from '../src/career/next-up.ts';
import { newCareer } from '../src/career/save.ts';
import { DEFAULT_OPTIONS, validateOptions } from '../src/simulation/config.ts';
import { F, H, carBase } from '../src/simulation/protocol.ts';
import { Simulation } from '../src/simulation/world.ts';
import { graphicsPreset } from '../src/rendering/options.ts';
import { fpsStats } from '../src/ui/fps-meter.ts';
import {
  clock,
  factsHtml,
  nextFromPlan,
  nextHtml,
  podiumHtml,
  resultFacts,
  resultRows,
  resultsBoardHtml,
} from '../src/ui/results-board.ts';
import {
  CARD,
  drawShareCard,
  shareCardFilename,
  type ShareCardData,
} from '../src/ui/results-card.ts';
import {
  QUALITY_ORDER,
  presetRows,
  qualityGuideHtml,
  recommendPreset,
} from '../src/ui/settings-guide.ts';

/** A finished 8-car frame whose ranks and finish times agree; the player (car 0) takes `position`. */
function frame(position: number) {
  const f = new Simulation(validateOptions(DEFAULT_OPTIONS)).makeFrame();
  const cars = Math.round(f[H.CARS]);
  let next = 1;
  for (let id = 0; id < cars; id++) {
    const rank = id === 0 ? position : next === position ? ++next : next;
    if (id !== 0) next = rank + 1;
    const o = carBase(id);
    f[o + F.RANK] = rank;
    f[o + F.LAPS] = 3;
    f[o + F.FINISH] = 181.2 + (rank - 1) * 2.5;
    f[o + F.BEST_LAP] = 58.4 + rank * 0.2;
    f[o + F.PENALTY] = 0;
  }
  return f;
}
const name = (id: number) => (id === 0 ? 'YOU' : `DRIVER ${id}`);

describe('results board', () => {
  it('orders the classification by rank and marks the player', () => {
    const rows = resultRows(frame(3), name);
    expect(rows.map((r) => r.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(rows.find((r) => r.you)?.position).toBe(3);
    expect(rows.filter((r) => r.you)).toHaveLength(1);
  });
  it('reads the gaps from the snapshot, never a guess', () => {
    const rows = resultRows(frame(3), name);
    const facts = resultFacts(rows)!;
    expect(facts.position).toBe(3);
    expect(facts.finished).toBe(true);
    expect(facts.toWinner).toBeCloseTo(5, 5);
    expect(facts.winner).toBe(false);
    // The fastest lap belongs to the winner here, so the player is behind it.
    expect(facts.fastest?.you).toBe(false);
    expect(facts.toFastest).toBeCloseTo(0.4, 5);
    const html = factsHtml(facts);
    expect(html).toContain('GAP TO WINNER');
    expect(html).toContain('+5.000 s');
    expect(html).toContain('VS FASTEST LAP');
  });
  it('shows the winner their margin over second, and says FASTEST LAP when it is theirs', () => {
    const f = frame(1);
    const rows = resultRows(f, name);
    const facts = resultFacts(rows)!;
    expect(facts.winner).toBe(true);
    expect(facts.toWinner).toBeCloseTo(2.5, 5);
    expect(facts.fastest?.you).toBe(true);
    const html = factsHtml(facts);
    expect(html).toContain('MARGIN OVER 2ND');
    expect(html).toContain('FASTEST LAP');
    expect(html).not.toContain('GAP TO WINNER');
  });
  it('says nothing about a gap the snapshot cannot support', () => {
    const f = frame(2);
    // The player has the best time but is classified second: the times and the order disagree.
    f[carBase(0) + F.FINISH] = 100;
    expect(resultFacts(resultRows(f, name))!.toWinner).toBeNull();
    // A car that did not finish has no race time to compare.
    const g = frame(2);
    g[carBase(0) + F.FINISH] = 0;
    const facts = resultFacts(resultRows(g, name))!;
    expect(facts.finished).toBe(false);
    expect(facts.toWinner).toBeNull();
  });
  it('builds a podium of the top three in reading order, with the player marked', () => {
    const html = podiumHtml(resultRows(frame(2), name));
    expect(html.match(/class="rs-step"/g)).toHaveLength(3);
    expect(html).toMatch(/data-place="2" data-you="true"/);
    expect(html.indexOf('data-place="1"')).toBeLessThan(html.indexOf('data-place="2"'));
    // A medal disc carries the place number, not just a colour.
    expect(html).toMatch(/data-medal="gold"[^>]*><b>1<\/b>/);
    // A field of two has no podium.
    expect(podiumHtml(resultRows(frame(2), name).slice(0, 2))).toBe('');
  });
  it('assembles the screen: every action the old screen had, the sheet, the payment and the next step', () => {
    const rows = resultRows(frame(2), name);
    const next = nextFromPlan(seasonPlan(liveRegistry(), newCareer()));
    const html = resultsBoardHtml({
      rows,
      heading: 'Across the line.',
      lead: '',
      extra: '<section class="career-payout">x</section>',
      offroad: '',
      note: '',
      next,
      standings: false,
    });
    for (const action of ['replay', 'restart', 'resultsShare', 'telemetry', 'photo', 'menu'])
      expect(html).toContain(`data-action="${action}"`);
    expect(html).not.toContain('data-action="championship"');
    expect(html.match(/class="primary"/g)).toHaveLength(1);
    expect(html).toContain('class="results rs-table"');
    expect(html).toContain('<tr class="you">');
    expect(html).toContain('NEXT UP · CIRCUIT');
    expect(html).toContain('data-action="career:licence:braking"');
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
    // Names are escaped.
    expect(
      resultsBoardHtml({
        rows: resultRows(frame(2), (id) => (id === 0 ? '<img src=x onerror=alert(1)>' : name(id))),
        heading: 'x',
        lead: '',
        extra: '',
        offroad: '',
        note: '',
        next: null,
        standings: false,
      }),
    ).not.toContain('<img src=x');
  });
  it('hides the next card when there is no plan', () => {
    expect(nextHtml(null)).toContain('hidden');
  });
  it('formats clocks as the rest of the game does', () => {
    expect(clock(181.2)).toBe('3:01.200');
    expect(clock(0)).toBe('—:——.———');
  });
});

describe('share card', () => {
  it('is 1200 x 630 and named for the venue and the place', () => {
    expect(CARD).toEqual({ width: 1200, height: 630 });
    expect(shareCardFilename('aurel', 2, true)).toBe('motobound-aurel-p2.png');
    expect(shareCardFilename('aurel', 5, false)).toBe('motobound-aurel-result.png');
  });
  it('draws the position, the player, the figures and the podium with no network call', () => {
    const calls: string[] = [];
    const text: string[] = [];
    const ctx = new Proxy(
      {},
      {
        get(_t, key) {
          if (key === 'fillText')
            return (value: string) => {
              text.push(value);
            };
          return (..._args: unknown[]) => {
            calls.push(String(key));
          };
        },
        set() {
          return true;
        },
      },
    ) as unknown as CanvasRenderingContext2D;
    const data: ShareCardData = {
      session: 'Grand Prix · 3 laps',
      venue: 'Aurel Grand Circuit',
      machine: 'APX-01 Formula',
      weather: 'DRY',
      player: 'Alex River',
      position: 2,
      field: 8,
      finished: true,
      raceTime: '3:01.200',
      bestLap: '0:58.400',
      gaps: ['+2.310 s to the winner'],
      podium: [
        { place: 1, name: 'A. MOREAU', time: '2:58.890' },
        { place: 2, name: 'YOU', time: '3:01.200' },
        { place: 3, name: 'K. SATO', time: '3:05.820' },
      ],
      path: null,
      date: '3 Nov 2026',
    };
    drawShareCard(ctx, data);
    expect(text).toContain('MOTOBOUND');
    expect(text).toContain('P2');
    expect(text).toContain('OF 8');
    expect(text).toContain('ALEX RIVER');
    expect(text).toContain('3:01.200');
    expect(text).toContain('A. MOREAU');
    expect(calls).not.toContain('fetch');
  });
  it('does not import anything that can reach the network', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/ui/results-card.ts', 'utf8');
    expect(source).not.toMatch(
      /fetch\(|XMLHttpRequest|WebSocket|sendBeacon|new Image\(|https?:\/\//,
    );
  });
});

describe('graphics guide', () => {
  it('reads every row from the preset data, for all four presets', () => {
    expect(QUALITY_ORDER).toEqual(['low', 'medium', 'high', 'ultra']);
    const rows = presetRows();
    const resolution = rows.find((r) => r.label === 'RESOLUTION')!;
    for (const q of QUALITY_ORDER)
      expect(resolution.values[q]).toBe(`${Math.round(graphicsPreset(q).resolutionScale * 100)}%`);
    expect(rows.find((r) => r.label === 'SHADOWS')!.values.low).toBe('off');
    expect(rows.find((r) => r.label === 'EDGES')!.values.ultra).toContain('TAA');
  });
  it('marks the chosen preset and says what the suggestion is based on', () => {
    const html = qualityGuideHtml('high', 'NVIDIA GeForce RTX 3060');
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    expect(html).toMatch(/data-preset="high" aria-current="true"/);
    expect(html).toContain('FOR THIS GPU · HIGH');
    expect(html).toContain('It is a guess from the name');
    expect(html).toContain('data-use="high"');
    expect(html).toContain('FRAME RATE · THIS WINDOW');
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
    // A hostile GPU string is escaped.
    expect(qualityGuideHtml('low', '<img src=x onerror=alert(1)>')).not.toContain('<img src=x');
  });
  it('recommends from the GPU name, and says when it cannot', () => {
    const preset = (name: string | null) => recommendPreset(name).preset;
    expect(
      preset('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)'),
    ).toBe('low');
    expect(preset('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe('low');
    expect(
      preset(
        'ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 (0x00002704) Direct3D11 vs_5_0 ps_5_0, D3D11)',
      ),
    ).toBe('ultra');
    expect(preset('NVIDIA GeForce RTX 3060')).toBe('high');
    expect(preset('NVIDIA GeForce RTX 2060')).toBe('high');
    expect(preset('NVIDIA GeForce RTX 2080')).toBe('high');
    expect(preset('NVIDIA GeForce RTX 3050')).toBe('medium');
    expect(preset('NVIDIA GeForce RTX 5090')).toBe('ultra');
    expect(preset('NVIDIA GeForce GTX 1650')).toBe('medium');
    expect(preset('NVIDIA GeForce GTX 1060 6GB')).toBe('high');
    expect(preset('AMD Radeon RX 6800 XT')).toBe('ultra');
    expect(preset('AMD Radeon RX 6600')).toBe('high');
    expect(preset('AMD Radeon RX 580')).toBe('medium');
    expect(preset('Apple M2')).toBe('high');
    expect(preset('Apple M3 Max')).toBe('ultra');
    expect(preset('ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11, D3D11)')).toBe(
      'low',
    );
    expect(preset('Intel(R) Iris(R) Xe Graphics')).toBe('low');
    expect(preset('ANGLE (AMD, AMD Custom GPU 0405 (Van Gogh), Vulkan)')).toBe('medium');
    expect(preset('Adreno (TM) 650')).toBe('low');
    const unknown = recommendPreset('Some GPU Nobody Has Heard Of');
    expect(unknown).toMatchObject({ preset: 'medium', basis: 'unknown' });
    expect(recommendPreset(null)).toMatchObject({ preset: 'medium', basis: 'unknown' });
    // Only a recognised family is called a guess.
    expect(recommendPreset('NVIDIA GeForce RTX 3060').basis).toBe('guess');
  });
});

describe('frame-rate maths', () => {
  it('averages over the window and reports the 1% low', () => {
    const deltas = Array.from({ length: 99 }, () => 16.6667).concat([100]);
    const stats = fpsStats(deltas)!;
    expect(stats.frames).toBe(100);
    expect(stats.fps).toBeCloseTo((100 * 1000) / (99 * 16.6667 + 100), 3);
    expect(stats.low).toBeCloseTo(10, 5);
  });
  it('ignores nonsense and needs at least two frames', () => {
    expect(fpsStats([])).toBeNull();
    expect(fpsStats([16])).toBeNull();
    expect(fpsStats([Number.NaN, -3, 0, 5000, 16, 16])!.frames).toBe(2);
  });
});
