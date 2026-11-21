import { expect, it } from 'vitest';
import { PAINT_TOLERANCE, paintStations } from '../src/rendering/open-world/paint-tessellation.ts';
import { festivalMarkings, forEachPaintSpan } from '../src/simulation/open-world/festival-markings.ts';
import { openWorld } from '../src/simulation/open-world/world.ts';
import { trackPoint } from '../src/simulation/track.ts';

it('preserves the painted footprint and deck clearance across every paved road class', () => {
  const net = openWorld().network, mark = festivalMarkings(net);
  const a = trackPoint(), b = trackPoint(), sample = trackPoint();
  const classes = new Set<string>();
  let horizontal = 0, vertical = 0, sections = 0, legacy = 0, checked = 0;
  for (const edge of net.edges) {
    const height = (p: typeof a, l: number) => net.surfaceHeight(p, l, edge.spec.halfWidth, edge.spec.crown);
    for (const line of [...mark.lines[edge.index], ...mark.crossings[edge.index].flatMap(c => c.lines)]) {
      const left = line.lateral - line.width / 2, right = line.lateral + line.width / 2;
      forEachPaintSpan(line, (from, to) => {
        classes.add(edge.roadClass);
        const rows = paintStations(net, edge, from, to, left, right);
        legacy += Math.ceil((to - from) / 2);
        sections += rows.length - 1;
        if (rows[0] !== from || rows.at(-1) !== to) throw new Error('Lost paint endpoint');
        for (let i = 1; i < rows.length; i++) {
          const s = rows[i - 1], span = rows[i] - s;
          if (span > PAINT_TOLERANCE.span + 1e-8 || span <= 0) throw new Error('Invalid paint section');
          net.at(edge.offset + s, a);
          net.at(edge.offset + rows[i], b);
          // Independent quarter-metre probes do not alias the construction samples.
          for (let m = Math.min(span / 2, 0.137); m < span; m += 0.41) {
            net.at(edge.offset + s + m, sample);
            const t = m / span;
            for (const l of [left, right]) {
              const xa = a.x + a.nx * l, za = a.z + a.nz * l, ya = height(a, l);
              const x = xa + (b.x + b.nx * l - xa) * t, z = za + (b.z + b.nz * l - za) * t;
              horizontal = Math.max(horizontal, Math.hypot(sample.x + sample.nx * l - x, sample.z + sample.nz * l - z));
              vertical = Math.max(vertical, Math.abs(height(sample, l) - (ya + (height(b, l) - ya) * t)));
            }
            checked++;
          }
        }
      });
    }
  }
  expect(classes).toEqual(new Set(['town', 'highway', 'mountain', 'country', 'runway', 'circuit']));
  expect(checked).toBeGreaterThan(200000);
  expect(sections / legacy).toBeLessThan(0.38);
  expect(horizontal).toBeLessThan(0.0095);
  expect(vertical).toBeLessThan(0.0026);
});
