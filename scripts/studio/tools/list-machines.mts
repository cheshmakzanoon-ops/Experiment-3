import { VEHICLES } from '../../../src/simulation/vehicles.ts';
import { bodySheetFor } from '../../../src/rendering/vehicle-bodies/body-sheet.ts';

// Prints every catalogue machine with its class, body kind and paint data.
//   npx vite-node scripts/studio/tools/list-machines.mts
for (const d of Object.values(VEHICLES)) {
  const s = bodySheetFor(d);
  const detail = !s
    ? 'none'
    : s.kind === 'closed'
      ? `closed/${s.style}/${s.paint}/${s.stripe}`
      : s.kind === 'open-wheel'
        ? `open-wheel/${s.era}/${s.paint}/${s.stripe}`
        : s.kind === 'buggy'
          ? `buggy/${s.paint}/${s.stripe}`
          : `kart/${s.paint}`;
  console.log(
    d.id.padEnd(8),
    String(d.classId).padEnd(14),
    d.dynamicsKind.padEnd(10),
    detail.padEnd(30),
    d.name,
  );
}
