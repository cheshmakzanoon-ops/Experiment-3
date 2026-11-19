import { it } from 'vitest';
import { nativeGeometryCases } from './helpers/native-geometry-proof.mjs';

for (const { name, run } of nativeGeometryCases)
  it(name, async () => {
    const detail = await run();
    console.info('APEX_NATIVE_GEOMETRY_PROOF ' + JSON.stringify({ name, ...detail }));
  });
