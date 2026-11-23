import * as T from 'three';
import { expect, it } from 'vitest';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { buildVehicleBody } from '../src/rendering/vehicle-bodies/index.ts';
import { bodySheetFor } from '../src/rendering/vehicle-bodies/body-sheet.ts';

it.each(['fx26', 'fr3', 'jf2'])(
  'retains a slotted, detachable %s front assembly through the three optical tiers',
  (id) => {
    const def = VEHICLES[id],
      sheet = bodySheetFor(def)!;
    if (sheet.kind !== 'open-wheel') throw Error('Expected a Formula car');
    const body = buildVehicleBody(0, def, sheet),
      widths: number[] = [],
      counts: number[] = [];
    for (const lod of body.lods) {
      const front = lod.front.find((part) => part.name === 'Front wing (detachable)')!;
      const b = new T.Box3().setFromObject(front),
        extent = new T.Vector3();
      b.getSize(extent);
      widths.push(extent.x);
      expect(extent.z).toBeGreaterThan(0.47);
      expect(extent.y).toBeGreaterThan(0.2);
      const p = new T.Vector3(),
        slices = new Set<number>();
      let triangles = 0;
      front.traverse((part) => {
        if (!(part instanceof T.Mesh)) return;
        const a = part.geometry.getAttribute('position');
        for (let i = 0; i < a.count; i++) {
          p.fromBufferAttribute(a, i);
          expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
          if (p.x > 0 && p.x < 0.75 && Math.abs(p.z - (b.min.z + 0.27)) < 0.11)
            slices.add(Math.round(p.x * 12));
        }
        triangles += (part.geometry.index?.count ?? a.count) / 3;
      });
      expect(slices.size).toBeGreaterThan(3);
      counts.push(triangles);
      expect(lod.group.children).toContain(front);
    }
    expect(widths[0]).toBeCloseTo(sheet.frontWingSpan ?? 1.75, 1);
    expect(widths[1]).toBeCloseTo(widths[0], 3);
    expect(widths[2]).toBeCloseTo(widths[0], 3);
    expect(counts[0]).toBeGreaterThan(counts[1]);
    expect(counts[1]).toBeGreaterThan(counts[2]);
  },
);
