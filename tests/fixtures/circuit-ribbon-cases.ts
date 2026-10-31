import { CircuitScene, circuitKerbHeight } from '../../src/rendering/circuit.ts';
import { Track, trackPoint } from '../../src/simulation/track.ts';
import { CIRCUITS } from '../../src/simulation/circuits.ts';
import * as T from 'three';

/** These case definitions were executed against untouched a937cacf source before
 * extraction. Oracle bytes must not be regenerated from the refactored method. */
export function ribbonOracleCases() {
  const aurel = new Track('clear');
  const coast = new Track('clear', false, undefined, CIRCUITS.vellamar);
  const gp = new Track('clear', false, undefined, CIRCUITS['poggio-alto']);
  const bank = aurel.points.reduce((a, b) => (Math.abs(a.bank) >= Math.abs(b.bank) ? a : b)).s;
  let widthChange = 0,
    station = 0;
  for (let i = 1; i < coast.points.length; i++) {
    const delta = Math.abs(coast.points[i].width - coast.points[i - 1].width);
    if (delta > widthChange) {
      widthChange = delta;
      station = coast.points[i].s;
    }
  }
  type Options = Parameters<CircuitScene['ribbon']>[1];
  const cases: { name: string; track: Track; options: Options }[] = [];
  const road = (track: Track, start: number, end: number): Options => ({
    start,
    end,
    step: 1.8,
    columns: 14,
    road: true,
    offset: (s, t) => (t * 2 - 1) * track.at(s, trackPoint()).width,
  });
  cases.push({ name: 'aurel-straight-road', track: aurel, options: road(aurel, 0, 43) });
  cases.push({
    name: 'aurel-banked-road',
    track: aurel,
    options: road(aurel, bank - 32, bank + 32),
  });
  cases.push({
    name: 'coast-width-changing-road',
    track: coast,
    options: road(coast, station - 45, station + 45),
  });
  cases.push({
    name: 'aurel-lap-seam-road',
    track: aurel,
    options: road(aurel, aurel.length - 42, aurel.length + 42),
  });
  for (const side of [-1, 1]) {
    cases.push({
      name: `edge-paint-${side}`,
      track: aurel,
      options: {
        start: 0,
        end: 163.25,
        step: 2,
        offset: (s, t) => side * (aurel.at(s, trackPoint()).width - 0.17 + t * 0.14),
        height: () => 0.006,
      },
    });
    cases.push({
      name: `pit-paint-${side}`,
      track: coast,
      options: {
        start: coast.length - coast.pit.divergeStart,
        end: coast.length,
        step: 1,
        offset: (s, t) => coast.pitOffset(s) + side * (3.35 + t * 0.12),
        height: () => 0.008,
      },
    });
    cases.push({
      name: `kerb-${side}`,
      track: aurel,
      options: {
        start: bank - 4,
        end: bank + 6,
        step: 0.16,
        columns: 6,
        stripes: true,
        offset: (s, t) => side * (aurel.at(s, trackPoint()).width + t * 1.1),
        height: (s, l, t) => circuitKerbHeight(aurel, s, l, t * 1.1),
      },
    });
  }
  cases.push({
    name: 'bank-clamp-and-custom-holes',
    track: aurel,
    options: {
      start: bank - 12,
      end: bank + 15,
      step: 1.7,
      columns: 8,
      offset: (_s, t) => 24 - 48 * t,
      height: (s, l, t) => Math.sin(s * 0.03) * 0.002 + l * t * 0.0001,
      include: (s, l) => Math.floor(s / 3) % 3 !== 1 || l > 0,
      attributes: {
        coverage: (s, l) => Math.cos(s * 0.12) + l * 0.03,
        signedDistance: (_s, l) => l,
      },
    },
  });
  cases.push({
    name: 'gp-runoff-and-kerb-attributes',
    track: gp,
    options: {
      start: 90,
      end: 174.1,
      step: 2.3,
      columns: 4,
      stripes: true,
      runoff: true,
      offset: (s, t) => (t * 2 - 1) * (gp.at(s, trackPoint()).width + 4),
      height: () => -0.008,
    },
  });
  cases.push({
    name: 'non-gp-runoff-default-step',
    track: aurel,
    options: {
      start: 345,
      end: 356,
      runoff: true,
      columns: 4,
      offset: (s, t) => (t * 2 - 1) * (aurel.at(s, trackPoint()).width + 4),
    },
  });
  return cases;
}

export function renderRibbonCase(entry: ReturnType<typeof ribbonOracleCases>[number]) {
  const surfaces = new T.Group();
  const scene = Object.assign(Object.create(CircuitScene.prototype), {
    track: entry.track,
    surfaces,
    group: new T.Group(),
  }) as CircuitScene;
  const material = new T.MeshStandardMaterial({ side: T.DoubleSide });
  const first = scene.ribbon(material, entry.options);
  return { first, material, meshes: surfaces.children as T.Mesh[] };
}
