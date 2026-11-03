import * as T from 'three';
import { VEHICLES } from '../../../src/simulation/vehicles.ts';
import { bodySheetFor } from '../../../src/rendering/vehicle-bodies/body-sheet.ts';
import { buildVehicleBody } from '../../../src/rendering/vehicle-bodies/index.ts';

// Geometry audit of every catalogue body (near LOD), headless: size vs the definition's
// collision box, tyre radius, wheel placement vs the physics hubs, and tyre-to-arch
// clearance by downward raycast (archGap NaN: no panel above the tyre; negative: the tyre
// top is above the first panel hit, low confidence). Usage:
//   npx vite-node scripts/studio/tools/body-audit.mts [id ...]
const only = process.argv.slice(2);
const rows: string[] = [];
rows.push(
  'id'.padEnd(7) +
    [
      'kind',
      'tri',
      'len',
      'defLen',
      'wid',
      'defW',
      'hgt',
      'defH',
      'tyreR',
      'defR',
      'archGapF',
      'archGapR',
      'hubErr',
    ]
      .map((s) => s.padStart(9))
      .join(''),
);
for (const def of Object.values(VEHICLES)) {
  if (def.id === 'apx01' || def.dynamicsKind !== 'four-wheel') continue;
  if (only.length && !only.includes(def.id)) continue;
  const sheet = bodySheetFor(def);
  if (!sheet) continue;
  const body = buildVehicleBody(1, def, sheet);
  const lod = body.lods[0];
  const root = lod.group;
  // Park the wheels at their rest hub height like the renderer does.
  body.wheels[0].forEach((w, i) => {
    w.pivot.position.y = def.wheelPositions[i][1] - def.spec.restLength * 0.0;
  });
  root.updateMatrixWorld(true);
  const wheelMeshes = new Set<T.Object3D>();
  body.wheels[0].forEach((w) => w.pivot.traverse((o) => wheelMeshes.add(o)));
  const bodyBox = new T.Box3(),
    tmp = new T.Box3();
  const bodyMeshes: T.Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof T.Mesh && !wheelMeshes.has(o)) {
      bodyMeshes.push(o);
    }
  });
  for (const m of bodyMeshes) bodyBox.union(tmp.setFromObject(m));
  const tyre = new T.Box3().setFromObject(body.wheels[0][0].tyre);
  const tyreR = (tyre.max.y - tyre.min.y) / 2;
  // Arch clearance: cast down from above at the wheel centre onto body meshes.
  const ray = new T.Raycaster();
  const gaps: number[] = [];
  const hubErr: number[] = [];
  body.wheels[0].forEach((w, i) => {
    const wb = new T.Box3().setFromObject(w.tyre);
    const cx = (wb.min.x + wb.max.x) / 2,
      cz = (wb.min.z + wb.max.z) / 2;
    hubErr.push(Math.abs(cz - def.wheelPositions[i][2]));
    ray.set(new T.Vector3(cx, 3, cz), new T.Vector3(0, -1, 0));
    const hits = ray.intersectObjects(bodyMeshes, false).filter((h) => h.object.visible);
    // The lowest hit above the tyre top is the arch roof (cabin hits come first from above).
    const above = hits.filter((h) => h.point.y > wb.max.y - 0.02);
    const roof = above.length ? above[above.length - 1].point.y : NaN;
    gaps.push(roof - wb.max.y);
  });
  const g = (a: number, b: number) => ((gaps[a] + gaps[b]) / 2).toFixed(3);
  const defLen = def.halfExtents[2] * 2;
  rows.push(
    def.id.padEnd(7) +
      [
        sheet.kind,
        String(
          bodyMeshes.reduce((n, m) => {
            const geo = m.geometry as T.BufferGeometry;
            return n + (geo.index ? geo.index.count : geo.getAttribute('position').count) / 3;
          }, 0),
        ),
        (bodyBox.max.z - bodyBox.min.z).toFixed(2),
        defLen.toFixed(2),
        (bodyBox.max.x - bodyBox.min.x).toFixed(2),
        (def.halfExtents[0] * 2).toFixed(2),
        (bodyBox.max.y - bodyBox.min.y).toFixed(2),
        (def.halfExtents[1] * 2).toFixed(2),
        tyreR.toFixed(3),
        def.spec.wheelRadius.toFixed(3),
        g(0, 1),
        g(2, 3),
        Math.max(...hubErr).toFixed(3),
      ]
        .map((s) => s.padStart(9))
        .join(''),
  );
}
console.log(rows.join('\n'));
