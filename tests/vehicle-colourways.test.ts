import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { LIVERIES } from '../src/simulation/config.ts';
import { CAR_STRIDE, F, H, HEADER, R, RACE_BASE, carBase } from '../src/simulation/protocol.ts';
import { VEHICLES, vehicleIndex } from '../src/simulation/vehicles.ts';
import { DEFAULT_LIVERY, LIVERY_PRESETS, validateLivery } from '../src/storage/livery.ts';
import { bodySheetFor } from '../src/rendering/vehicle-bodies/body-sheet.ts';
import { bodyLayersOf } from '../src/rendering/vehicle-bodies/body-livery.ts';
import {
  COLOURWAYS,
  COLOURWAY_IDS,
  bodyLook,
  colourwayFor,
  liveryOverrides,
  luminance,
  mixHex,
  teamLook,
} from '../src/rendering/vehicle-bodies/colourways.ts';
import { buildVehicleBody, VehicleBodies } from '../src/rendering/vehicle-bodies/index.ts';

/** D7: the 37 closed bodies, the open-wheel cars, karts and the buggy were all
 * team red with a white stripe. Each machine now has its own default colourway,
 * and the player's livery edit still overrides it. */
const bodies = Object.values(VEHICLES).filter((d) => bodySheetFor(d));
const sheetOf = (id: string) => bodySheetFor(VEHICLES[id])!;
const contrast = (a: number, b: number) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/** Euclidean distance between two sRGB colours (0..441). */
const distance = (a: number, b: number) =>
  Math.hypot(
    ((a >> 16) & 255) - ((b >> 16) & 255),
    ((a >> 8) & 255) - ((b >> 8) & 255),
    (a & 255) - (b & 255),
  );
const hue = (hex: number) => {
  const r = ((hex >> 16) & 255) / 255,
    g = ((hex >> 8) & 255) / 255,
    b = (hex & 255) / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
  if (d < 0.08) return -1; // grey, white or black: no hue
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return h * 60;
};
function snapshot(ids: readonly string[]) {
  const frame = new Float32Array(HEADER + ids.length * CAR_STRIDE);
  frame[H.CARS] = ids.length;
  ids.forEach((id, i) => {
    const o = carBase(i);
    frame[o + F.QW] = 1;
    frame[o + RACE_BASE + R.VEHICLE] = vehicleIndex(id);
    frame[o + F.FRONT_HEALTH] = 1;
    frame[o + F.REAR_HEALTH] = 1;
  });
  return frame;
}
const hosts = (n: number) =>
  Array.from({ length: n }, () => ({ root: new T.Group(), lodLevel: 0 }));
type Built = ReturnType<typeof buildVehicleBody>;
const built = (b: VehicleBodies) => (b as unknown as { bodies: Map<number, Built> }).bodies;

describe('catalogue colourways (D7)', () => {
  it('gives every catalogue body a colourway of its own and no stray entries', () => {
    expect(bodies.length).toBe(47);
    expect(new Set(COLOURWAY_IDS)).toEqual(new Set(bodies.map((d) => d.id)));
    for (const d of bodies) expect(colourwayFor(d.id), d.id).not.toBeNull();
  });

  it('spreads the catalogue over the colour wheel instead of one team red', () => {
    const primaries = COLOURWAY_IDS.map((id) => COLOURWAYS[id].primary);
    expect(new Set(primaries).size).toBeGreaterThanOrEqual(44);
    // None repeats the old default look: team red under a white stripe.
    for (const id of COLOURWAY_IDS)
      expect(COLOURWAYS[id].primary === LIVERIES[0] && COLOURWAYS[id].accent === 0xf2f2ef, id).toBe(
        false,
      );
    const buckets = new Map<number, number>();
    for (const p of primaries) {
      const h = hue(p);
      const bucket = h < 0 ? -1 : Math.floor(h / 30);
      buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
    }
    // Chromatic hue families in use, and no family (or the neutrals) over a quarter.
    expect([...buckets.keys()].filter((k) => k >= 0).length).toBeGreaterThanOrEqual(9);
    expect(Math.max(...buckets.values())).toBeLessThanOrEqual(Math.ceil(COLOURWAY_IDS.length / 4));
  });

  it('keeps machines of one class apart', () => {
    const byClass = new Map<string, number[]>();
    for (const d of bodies) {
      const list = byClass.get(String(d.classId)) ?? [];
      list.push(COLOURWAYS[d.id].primary);
      byClass.set(String(d.classId), list);
    }
    for (const [cls, list] of byClass) expect(new Set(list).size, cls).toBe(list.length);
  });

  it('keeps every two-tone and stripe readable against the body colour', () => {
    for (const d of bodies) {
      const way = COLOURWAYS[d.id],
        sheet = sheetOf(d.id);
      if (way.layers?.length) {
        expect(sheet.kind, `${d.id} layers need a closed body`).toBe('closed');
        // The second colour must read against the first (WCAG-style ratio).
        expect(contrast(way.primary, way.secondary), `${d.id} two-tone contrast`).toBeGreaterThan(
          1.5,
        );
      }
      const stripe = sheet.kind !== 'kart' && sheet.stripe !== 'none';
      // A stripe reads by lightness or, between hues of equal lightness (teal on
      // magenta), by plain colour distance.
      if (stripe)
        expect(
          contrast(way.primary, way.accent) > 1.25 || distance(way.primary, way.accent) > 120,
          `${d.id} stripe readable`,
        ).toBe(true);
    }
  });

  it('gives the EH-3 its pearl-over-carbon, cyan-lit identity', () => {
    const way = COLOURWAYS.eh3;
    expect(luminance(way.primary)).toBeGreaterThan(0.7);
    expect(luminance(way.secondary)).toBeLessThan(0.02);
    expect(way.layers).toEqual(['lower', 'roof']);
    expect(way.pin).toBe(true);
    // The accent is the signature light bar's colour: pin, bars and arches agree.
    const sheet = sheetOf('eh3');
    expect(sheet.kind === 'closed' && sheet.signature).toBe(way.accent);
  });
});

describe('who wears what (team colour, colourway, livery edit)', () => {
  it('paints the player machine in its colourway and leaves rivals in team colour', () => {
    const sheet = sheetOf('eh3');
    const player = bodyLook('eh3', 0, sheet);
    expect(player.source).toBe('colourway');
    expect(player.primary).toBe(COLOURWAYS.eh3.primary);
    expect(player.layers).toEqual(['lower', 'roof']);
    for (const id of [1, 2, 5, 13]) {
      const rival = bodyLook('eh3', id, sheet);
      expect(rival).toEqual(teamLook(id));
      expect(rival.primary).toBe(LIVERIES[id % LIVERIES.length]);
      expect(rival.layers).toEqual([]);
    }
  });

  it('applies the colourway layers to closed bodies only', () => {
    for (const d of bodies) {
      const sheet = sheetOf(d.id);
      const look = bodyLook(d.id, 0, sheet, LIVERY_PRESETS.nocturne);
      if (sheet.kind === 'closed') expect(look.layers, d.id).toEqual(['lower']);
      else expect(look.layers, d.id).toEqual([]);
      expect(bodyLook(d.id, 0, sheet).pin && sheet.kind !== 'closed', d.id).toBe(false);
    }
  });

  it('lets the livery editor override the colourway only once it is customised', () => {
    const sheet = sheetOf('rm8');
    expect(liveryOverrides(DEFAULT_LIVERY)).toBe(false);
    expect(liveryOverrides(null)).toBe(false);
    expect(bodyLook('rm8', 0, sheet, DEFAULT_LIVERY).source).toBe('colourway');
    // The default preset IS the default identity (G15: `voltage`, the original APX-01
    // violet / volt, formerly `copper`), so it keeps the colourway; exactly one preset is it.
    const defaults = Object.entries(LIVERY_PRESETS).filter(
      ([, preset]) =>
        preset.primary === DEFAULT_LIVERY.primary && preset.accent === DEFAULT_LIVERY.accent,
    );
    expect(defaults.map(([name]) => name)).toEqual(['voltage']);
    for (const [name, preset] of Object.entries(LIVERY_PRESETS)) {
      if (name === 'voltage') continue;
      const look = bodyLook('rm8', 0, sheet, preset);
      expect(look.source, name).toBe('livery');
      expect(look.primary).toBe(parseInt(preset.primary.slice(1), 16));
      expect(look.accent).toBe(parseInt(preset.accent.slice(1), 16));
      expect(look.number).toBe(preset.number);
      expect(look.helmet).toBe(look.primary);
    }
    // Pattern picks the layer: split two-tone, sweep flash, minimal plain.
    expect(bodyLook('rm8', 0, sheet, LIVERY_PRESETS.nocturne).layers).toEqual(['lower']);
    expect(bodyLook('rm8', 0, sheet, LIVERY_PRESETS.orchid).layers).toEqual(['flash']);
    expect(bodyLook('rm8', 0, sheet, LIVERY_PRESETS.glacier).layers).toEqual([]);
    // The edit belongs to the player: a rival is never recoloured by it.
    expect(bodyLook('rm8', 3, sheet, LIVERY_PRESETS.nocturne)).toEqual(teamLook(3));
    // A corrupt save falls back to the default identity, so the colourway stays.
    const broken = validateLivery({ primary: 'red', accent: 12, number: 'x' });
    expect(bodyLook('rm8', 0, sheet, broken).source).toBe('colourway');
  });

  it('keeps the driver visible: suit and helmet follow the livery', () => {
    // A pale body takes its dark second colour for the suit; others wear the body colour.
    expect(bodyLook('eh3', 0, sheetOf('eh3')).suit).toBe(COLOURWAYS.eh3.secondary);
    expect(bodyLook('gt6s', 0, sheetOf('gt6s')).suit).toBe(COLOURWAYS.gt6s.secondary);
    expect(bodyLook('tc1', 0, sheetOf('tc1')).suit).toBe(COLOURWAYS.tc1.primary);
    for (const d of bodies) {
      const look = bodyLook(d.id, 0, sheetOf(d.id));
      expect(look.helmet, d.id).toBe(look.primary);
      // The suit is the body colour, or the dark second colour of a pale body.
      expect([look.primary, look.secondary], d.id).toContain(look.suit);
      if (look.suit !== look.primary) expect(luminance(look.primary), d.id).toBeGreaterThan(0.45);
    }
  });

  it('mixes colours per sRGB channel', () => {
    expect(mixHex(0x000000, 0xffffff, 0.5)).toBe(0x808080);
    expect(mixHex(0x102030, 0x102030, 0.7)).toBe(0x102030);
    expect(mixHex(0xff0000, 0x0000ff, 0)).toBe(0xff0000);
  });
});

describe('built bodies wear their look', () => {
  it('builds the player body with the colourway and its layer handle, a rival with team paint', () => {
    const def = VEHICLES.eh3,
      sheet = sheetOf('eh3');
    const player = buildVehicleBody(0, def, sheet);
    expect(player.materials.look.source).toBe('colourway');
    expect(player.materials.paint.color.getHex()).toBe(COLOURWAYS.eh3.primary);
    expect(player.materials.accent.color.getHex()).toBe(COLOURWAYS.eh3.accent);
    expect(player.materials.helmet.color.getHex()).toBe(COLOURWAYS.eh3.primary);
    const layers = bodyLayersOf(player.materials.paint)!;
    expect(layers).toBeDefined();
    expect(layers.look.layers).toEqual(['lower', 'roof']);
    expect(layers.look.pin).toBe(true);
    expect(layers.look.secondary).toBe(COLOURWAYS.eh3.secondary);
    const rival = buildVehicleBody(1, def, sheet);
    expect(rival.materials.paint.color.getHex()).toBe(LIVERIES[1]);
    // Rivals keep exactly the program they always had: no layer hook.
    expect(rival.materials.layers).toBeNull();
    expect(bodyLayersOf(rival.materials.paint)).toBeUndefined();
  });

  it('builds a body for every colourway without a layer on non-closed machines', () => {
    for (const d of bodies) {
      const body = buildVehicleBody(0, d, sheetOf(d.id));
      const way = COLOURWAYS[d.id];
      expect(body.materials.paint.color.getHex(), d.id).toBe(way.primary);
      if (sheetOf(d.id).kind === 'closed') expect(body.materials.layers, d.id).not.toBeNull();
      else expect(body.materials.layers, d.id).toBeNull();
    }
  }, 120000);

  it('applies a livery edit to the player body in place and reverts it', () => {
    const bodiesLib = new VehicleBodies();
    const frame = snapshot(['rm8', 'rm8']);
    try {
      bodiesLib.update(frame, frame, 1, hosts(2));
      const first = built(bodiesLib).get(0)!,
        rival = built(bodiesLib).get(1)!;
      const paint = first.materials.paint;
      expect(paint.color.getHex()).toBe(COLOURWAYS.rm8.primary);
      expect(rival.materials.paint.color.getHex()).toBe(LIVERIES[1]);

      bodiesLib.setPlayerLivery(LIVERY_PRESETS.nocturne);
      // Same body, same material: recoloured, not rebuilt.
      expect(built(bodiesLib).get(0)).toBe(first);
      expect(first.materials.paint).toBe(paint);
      expect(paint.color.getHex()).toBe(0x132a41);
      expect(first.materials.accent.color.getHex()).toBe(0x69d3d0);
      expect(first.materials.helmet.color.getHex()).toBe(0x132a41);
      expect(first.materials.look.source).toBe('livery');
      expect(bodyLayersOf(paint)!.look.layers).toEqual(['lower']);
      expect(bodyLayersOf(paint)!.look.accent).toBe(0x69d3d0);
      // The rival is untouched.
      expect(rival.materials.paint.color.getHex()).toBe(LIVERIES[1]);

      bodiesLib.setPlayerLivery(LIVERY_PRESETS.orchid);
      expect(paint.color.getHex()).toBe(0x392447);
      expect(bodyLayersOf(paint)!.look.layers).toEqual(['flash']);

      // The default identity returns the machine colourway.
      bodiesLib.setPlayerLivery({ ...DEFAULT_LIVERY });
      expect(paint.color.getHex()).toBe(COLOURWAYS.rm8.primary);
      expect(bodyLayersOf(paint)!.look.layers).toEqual(['stripes']);
      bodiesLib.setPlayerLivery(null);
      expect(paint.color.getHex()).toBe(COLOURWAYS.rm8.primary);
    } finally {
      bodiesLib.clear();
    }
  });

  it('wears a livery edit made before the body exists (festival start, garage swap)', () => {
    const bodiesLib = new VehicleBodies();
    const frame = snapshot(['tc1']);
    try {
      bodiesLib.setPlayerLivery(LIVERY_PRESETS.glacier);
      bodiesLib.update(frame, frame, 1, hosts(1));
      expect(built(bodiesLib).get(0)!.materials.paint.color.getHex()).toBe(0xdde4e4);
      // A garage swap rebuilds the body; the edit still applies to the new machine.
      frame[carBase(0) + RACE_BASE + R.VEHICLE] = vehicleIndex('rs5');
      bodiesLib.update(frame, frame, 1, hosts(1));
      const swapped = built(bodiesLib).get(0)!;
      expect(swapped.definition.id).toBe('rs5');
      expect(swapped.materials.paint.color.getHex()).toBe(0xdde4e4);
      expect(swapped.materials.look.number).toBe(LIVERY_PRESETS.glacier.number);
    } finally {
      bodiesLib.clear();
    }
  });
});
