/** Texture-construction cost only. Run in an otherwise idle process with:
 * node --experimental-transform-types scripts/surface-authoring-cost.ts
 * The warmup/order and byte counts are explicit; this is not game FPS. */
import { createServer } from 'vite';
import { performance } from 'node:perf_hooks';
import type { surfacePixels as Pixels } from '../src/rendering/surface-detail.ts';

const server = await createServer({
  configFile: false,
  appType: 'custom',
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true, entries: [] },
});
try {
  const { surfacePixels } = (await server.ssrLoadModule('/src/rendering/surface-detail.ts')) as {
    surfacePixels: typeof Pixels;
  };
  const { legacySurfacePixels } = (await server.ssrLoadModule(
    '/e2e/fixtures/race-surface-control.ts',
  )) as {
    legacySurfacePixels: typeof Pixels;
  };
  surfacePixels('asphalt');
  legacySurfacePixels('asphalt');
  const rows = [];
  for (let round = 0; round < 4; round++)
    for (const candidate of round % 2 ? [true, false] : [false, true]) {
      const start = performance.now();
      const data = (candidate ? surfacePixels : legacySurfacePixels)('asphalt');
      rows.push({
        candidate,
        milliseconds: performance.now() - start,
        cpuMapBytes: data.albedo.byteLength + data.height.byteLength + data.roughness.byteLength,
      });
    }
  console.log(
    JSON.stringify(
      {
        scope: 'Local 512px texture authoring only; not frame time or GPU memory',
        node: process.version,
        warmupCallsPerVariant: 1,
        rows,
      },
      null,
      2,
    ),
  );
} finally {
  await server.close();
}
