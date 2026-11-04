import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WILDCARD_SERIES } from '../src/career/wildcard-series.ts';
import { THEME_PALETTE } from '../src/rendering/assets/sky-catalogue.ts';
import { tyreEquipmentPlacements } from '../src/rendering/tyre-trolleys-racks.ts';
import { terrainFor } from '../src/rendering/terrain.ts';
import { VENUE_THEMES } from '../src/rendering/venue-kit/theme.ts';
import { venuePlan } from '../src/rendering/venue-plan.ts';
import { trackGeometryReport } from '../src/simulation/circuit-catalogue/geometry-checks.ts';
import { CATALOGUE_CIRCUIT_IDS } from '../src/simulation/circuit-catalogue/venue-data.ts';
import { CIRCUITS } from '../src/simulation/circuits.ts';
import { validateCircuitDefinition } from '../src/simulation/content-validation.ts';
import { Track, trackPoint, CELL_COLS, CELL_ROWS } from '../src/simulation/track.ts';
import { WEATHER_IDS } from '../src/simulation/weather-catalogue.ts';
import { CIRCUIT_MENU_LABELS, circuitBlurb, circuitOptionsHtml } from '../src/ui/circuit-menu.ts';

/** Wildcard series, wave 2: four unexpected venues, each with its own visual
 * and driving character, built from the same venue-kit data as every layout. */
const NEW = ['haut-givre', 'marram-field', 'kalder-dam', 'saffron-lane'] as const;
const tracks = new Map<string, Track>();
const track = (id: string, weather: 'clear' | 'snow' | 'dust' | 'rain' = 'clear') => {
  const key = `${id}:${weather}`;
  let t = tracks.get(key);
  if (!t) tracks.set(key, (t = new Track(weather, false, undefined, CIRCUITS[id as 'haut-givre'])));
  return t;
};
const meta = (id: (typeof NEW)[number]) => CIRCUITS[id].catalogue!;

describe('Wildcard wave 2 venues', () => {
  it('are registered after Level Nine, in the Unconventional menu group, from data', () => {
    expect(CATALOGUE_CIRCUIT_IDS.slice(CATALOGUE_CIRCUIT_IDS.indexOf('level-nine'))).toEqual([
      'level-nine',
      ...NEW,
    ]);
    const html = circuitOptionsHtml();
    const unconventional = html.slice(html.indexOf('<optgroup label="Unconventional">'));
    for (const id of NEW) {
      const m = meta(id);
      expect(m.group).toBe('unconventional');
      expect(m.venue).toBe(id);
      expect(CIRCUITS[id].name).toMatch(/^[A-Z0-9 /’-]+$/);
      expect(unconventional).toContain(`value="${id}"`);
      expect(CIRCUIT_MENU_LABELS[id]).toContain(`${(track(id).length / 1000).toFixed(2)} km`);
      const blurb = circuitBlurb(id);
      expect(blurb.length).toBeGreaterThan(60);
      expect(blurb.length).toBeLessThanOrEqual(160);
      expect(blurb).toBe(m.description);
    }
  });

  it('carry a dressing theme, a sky and a suggested light and weather', () => {
    const want = {
      'haut-givre': { lighting: 'day', weather: 'snow', theme: 'alpine' },
      'marram-field': { lighting: 'sunset', weather: 'fog', theme: 'airport' },
      'kalder-dam': { lighting: 'day', weather: 'clear', theme: 'dam' },
      'saffron-lane': { lighting: 'night', weather: 'clear', theme: 'market' },
    } as const;
    for (const id of NEW) {
      const m = meta(id);
      expect(m.theme).toBe(want[id].theme);
      expect(VENUE_THEMES[m.theme]).toBeDefined();
      expect(THEME_PALETTE[m.theme]).toBeDefined();
      expect(m.suggested).toEqual({ lighting: want[id].lighting, weather: want[id].weather });
      expect(WEATHER_IDS).toContain(m.suggested!.weather);
      // A venue that suggests night is the floodlit kind the renderer lights itself.
      expect(m.night).toBe(m.suggested!.lighting === 'night');
    }
  });

  it('pass definition and geometry validation with a closed, solvable lap', () => {
    for (const id of NEW) {
      expect(validateCircuitDefinition(CIRCUITS[id]), id).toEqual([]);
      const t = track(id),
        report = trackGeometryReport(t);
      expect(report.errors, id).toEqual([]);
      // The authored path closes: the least-squares closure moved the straights
      // by under 3% of the lap, so corners and elevations are as authored.
      expect(meta(id).authoring.closureAdjustment / t.length, id).toBeLessThan(0.03);
      expect(meta(id).authoring.scale).toBe(1);
      expect(meta(id).dressing.crossings).toEqual([]);
      // A market has no straight long enough for a DRS zone; the others do.
      expect(CIRCUITS[id].drsZones.length, id).toBeGreaterThanOrEqual(
        id === 'saffron-lane' ? 0 : 1,
      );
      expect(CIRCUITS[id].corners.length, id).toBeGreaterThanOrEqual(7);
      expect(CIRCUITS[id].pit!.side).toBe(1);
      // None of them is assessed for road motorcycles (walls, roofs, frontage).
      expect(CIRCUITS[id].bikeSafe).toBeFalsy();
    }
  });

  it('Haut-Givre is a snowed-in mountain road: stacked hairpins, galleries, 59 m of climb', () => {
    const m = meta('haut-givre'),
      def = CIRCUITS['haut-givre'],
      t = track('haut-givre');
    expect(t.length).toBeGreaterThan(3500);
    expect(t.length).toBeLessThan(3800);
    expect(def.corners.filter((c) => /LACET|HAIRPIN/.test(c.name))).toHaveLength(6);
    expect(m.dressing.tunnels).toHaveLength(2);
    expect(m.dressing.rock.length).toBeGreaterThan(4);
    expect(m.dressing.facades.length).toBeGreaterThan(0);
    const report = trackGeometryReport(t);
    expect(report.maximumGradient).toBeGreaterThan(0.06);
    expect(report.maximumGradient).toBeLessThan(0.12);
    const p = trackPoint();
    let high = -Infinity,
      low = Infinity;
    for (let s = 0; s < t.length; s += 10) {
      t.at(s, p);
      high = Math.max(high, p.y);
      low = Math.min(low, p.y);
    }
    expect(high - low).toBeGreaterThan(55);
    expect(high - low).toBeLessThan(70);
    // The roofed galleries keep the snow off: bare road under the roof, cover
    // beside it, from the first second of a snowfall session.
    const snowy = track('haut-givre', 'snow');
    expect(snowy.cold).toBe(true);
    const cover = (s: number) => {
      const row = Math.floor((s / snowy.length) * CELL_ROWS);
      let sum = 0;
      for (let c = 0; c < CELL_COLS; c++) sum += snowy.frozen[row * CELL_COLS + c];
      return sum;
    };
    const gallery = m.dressing.tunnels[0];
    const inside = gallery.from + 20,
      outside = (gallery.from + 600) % snowy.length;
    expect(snowy.isCovered(inside)).toBe(true);
    expect(snowy.isCovered(outside)).toBe(false);
    expect(cover(inside)).toBe(0);
    expect(cover(outside)).toBeGreaterThan(0);
    for (let k = 0; k < 120; k++) snowy.evolve(0.5, k * 0.5);
    expect(cover(inside)).toBe(0);
    expect(cover(outside)).toBeGreaterThan(0);
  });

  it('Marram Field is an airport: a 28 m runway, 13 m taxiways, frontage and apron masts', () => {
    const m = meta('marram-field'),
      t = track('marram-field');
    expect(VENUE_THEMES.airport.lightTowers).toBe(true);
    expect(VENUE_THEMES.airport.planting).toBeNull();
    expect(VENUE_THEMES.airport.ground).toBe('concrete');
    const p = trackPoint();
    const widths: number[] = [];
    for (let s = 0; s < t.length; s += 20) widths.push(t.at(s, p).width);
    expect(Math.max(...widths)).toBeGreaterThan(13.5);
    expect(Math.min(...widths)).toBeLessThan(7);
    // Flat as a runway, and no roofs: the weather reaches every metre.
    expect(trackGeometryReport(t).maximumGradient).toBeLessThan(0.002);
    expect(m.dressing.tunnels).toEqual([]);
    expect(m.dressing.facades.length).toBeGreaterThan(0);
    // The start is on the runway: 1.3 km of road at least 26 m wide.
    for (let s = 0; s < 1200; s += 40) expect(t.at(s, p).width).toBeGreaterThan(13);
    expect(CIRCUITS['marram-field'].corners.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        'EXIT BRAVO',
        'HOLDING POINT',
        'ALPHA',
        'JULIET',
        'GATE ONE',
        'APRON',
      ]),
    );
  });

  it('Kalder Dam crosses water: concrete crest, drops both sides, the sea well below the road', () => {
    const m = meta('kalder-dam'),
      t = track('kalder-dam');
    expect(m.seaLevel).toBe(-20);
    const p = trackPoint();
    let top = -Infinity;
    for (let s = 0; s < t.length; s += 10) top = Math.max(top, t.at(s, p).y);
    // Every metre of road is at least 15 m above the water: a wall, not a beach.
    for (let s = 0; s < t.length; s += 10) expect(t.at(s, p).y - m.seaLevel!).toBeGreaterThan(15);
    // The crest has the water on both hands for most of a kilometre.
    const crest = m.dressing.drops.filter((d) => d.side === 1 && d.to - d.from > 900);
    const reservoir = m.dressing.drops.filter((d) => d.side === -1 && d.to - d.from > 900);
    expect(crest).toHaveLength(1);
    expect(reservoir.length).toBeGreaterThanOrEqual(1);
    expect(m.dressing.tunnels).toHaveLength(1);
    expect(m.dressing.facades.length).toBeGreaterThan(0);
    expect(VENUE_THEMES.dam.cliffs).toBeFalsy();
    // The concrete walls stand on the barrier lines (1.4 m off the asphalt).
    expect(t.boundaryAt(t.at(500, p), -1)).toBeCloseTo(p.width + 1.4, 1);
    // The paddock, the stands and the plaza are on land, never over the water.
    const ground = terrainFor(t),
      plan = venuePlan(t);
    expect(ground.seaLevel).toBe(-20);
    expect(plan.grandstands.length).toBeGreaterThanOrEqual(1);
    for (const stand of plan.grandstands) {
      const q = t.at(stand.s, trackPoint());
      const l = stand.side * (t.boundary(stand.s, stand.side) + 13);
      expect(ground.height(q.x + q.nx * l, q.z + q.nz * l), `stand at ${stand.s}`).toBeGreaterThan(
        ground.seaLevel! + 1,
      );
    }
    for (let a = 0; a < 360; a += 45) {
      const q = t.at(t.pit.firstBox + 5.5 * t.pit.boxSpacing, trackPoint());
      const l = t.pit.side * (t.pit.offset + 16);
      expect(ground.height(q.x + q.nx * l, q.z + q.nz * l)).toBeGreaterThan(ground.seaLevel! + 1);
    }
  });

  it('Saffron Lane is a narrow floodlit market: 8.8 m lanes, three hairpins, covered halls', () => {
    const m = meta('saffron-lane'),
      t = track('saffron-lane');
    expect(m.night).toBe(true);
    expect(VENUE_THEMES.market.streetLamps).toBe(true);
    const p = trackPoint();
    let widest = 0;
    for (let s = 0; s < t.length; s += 10) widest = Math.max(widest, t.at(s, p).width);
    expect(widest).toBeLessThan(4.8);
    expect(t.boundaryAt(t.at(100, p), -1)).toBeCloseTo(p.width + 1.2, 1);
    expect(CIRCUITS['saffron-lane'].corners.filter((c) => /HAIRPIN|DYE/.test(c.name))).toHaveLength(
      3,
    );
    expect(m.dressing.tunnels.length).toBeGreaterThanOrEqual(2);
    expect(m.dressing.facades.length).toBeGreaterThan(2);
    // The covered halls stay dry in the rain and free of dust in a dust storm.
    for (const weather of ['rain', 'dust'] as const) {
      const w = track('saffron-lane', weather);
      const hall = m.dressing.tunnels[0];
      expect(w.isCovered(hall.from + 20)).toBe(true);
      expect(w.sheltered[Math.floor(((hall.from + 20) / w.length) * CELL_ROWS)]).toBe(1);
    }
  });

  it('have a passing seeded Formula race on record and are used by the Wildcard series', () => {
    const doc = JSON.parse(readFileSync('docs/circuit-catalogue-races.json', 'utf8')) as {
      reports: { id: string; passed: boolean; lengthM: number; cars: number; laps: number }[];
    };
    for (const id of NEW) {
      const report = doc.reports.find((r) => r.id === id);
      expect(report, id).toBeDefined();
      expect(report!.passed).toBe(true);
      expect(report!.cars).toBeGreaterThanOrEqual(6);
      expect(report!.lengthM).toBe(Math.round(track(id).length));
      expect(
        WILDCARD_SERIES.some((e) => e.event.circuit === id),
        `${id} has no event`,
      ).toBe(true);
    }
  });

  it('are raced by eight new events that use snow, dawn fog, dust, storm and rain', () => {
    const mine = WILDCARD_SERIES.filter((e) =>
      (NEW as readonly string[]).includes(e.event.circuit),
    );
    expect(mine.map((e) => e.id)).toEqual([
      'supercars-in-the-ski-resort',
      'trucks-on-the-ski-road',
      'trophy-trucks-on-the-taxiway',
      'hypercars-on-the-runway',
      'karts-on-the-dam-road',
      'formula-gale-on-the-dam',
      'karts-in-the-night-market',
      'supermoto-in-the-night-market',
    ]);
    // Every venue has two events; the new weather states are put to work.
    for (const id of NEW) expect(mine.filter((e) => e.event.circuit === id).length, id).toBe(2);
    const weather = (id: string) => mine.find((e) => e.id === id)!.event.weather;
    expect(weather('supercars-in-the-ski-resort')).toBe('snow');
    expect(weather('trucks-on-the-ski-road')).toBe('snow');
    expect(weather('trophy-trucks-on-the-taxiway')).toBe('fog');
    expect(weather('hypercars-on-the-runway')).toBe('dust');
    expect(weather('karts-on-the-dam-road')).toBe('storm');
    expect(weather('formula-gale-on-the-dam')).toBe('storm');
    expect(weather('karts-in-the-night-market')).toBe('rain');
    // Dawn is the golden-hour light under a fog bank; the market is after dark.
    expect(mine.find((e) => e.id === 'trophy-trucks-on-the-taxiway')!.lighting).toBe('sunset');
    for (const id of ['karts-in-the-night-market', 'supermoto-in-the-night-market'])
      expect(mine.find((e) => e.id === id)!.lighting).toBe('night');
    // Mismatches: three cross a discipline (trucks, a supermoto), five put a
    // circuit machine on the wrong circuit; snow and storm races run on wets.
    expect(mine.filter((e) => e.kind === 'cross-discipline').map((e) => e.id)).toEqual([
      'trucks-on-the-ski-road',
      'trophy-trucks-on-the-taxiway',
      'supermoto-in-the-night-market',
    ]);
    for (const e of mine.filter((x) => ['snow', 'storm', 'rain'].includes(x.event.weather)))
      expect(e.event.compound, e.id).toBe('wet');
    // Each was run as the player loads it, and passed (docs/wildcard-races.json).
    const evidence = JSON.parse(readFileSync('docs/wildcard-races.json', 'utf8')) as {
      events: Record<string, { passed: boolean; failures: string[] }>;
    };
    for (const e of mine) {
      expect(evidence.events[e.id]?.passed, e.id).toBe(true);
      expect(evidence.events[e.id].failures).toEqual([]);
    }
  });

  it('loads in the renderer: the garage tyre equipment clears the pit lane on every catalogue circuit', () => {
    // RacingRenderer.create throws (and the loading screen never ends) when this
    // does: the airbase venues' 26 m pit lanes did, until the equipment followed
    // the bays out. Node-only: the placements are pure track geometry.
    for (const id of CATALOGUE_CIRCUIT_IDS) {
      const placements = tyreEquipmentPlacements(track(id));
      expect(placements, id).toHaveLength(3);
      for (const p of placements) expect(p.pitClearance, id).toBeGreaterThan(1);
    }
    expect(CIRCUITS['salt-flat'].pit!.offset).toBe(26);
    expect(CIRCUITS['marram-field'].pit!.offset).toBe(26);
  });
});
