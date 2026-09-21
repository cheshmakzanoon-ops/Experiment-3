/** Explicit, local high-resolution component inspection, not part of normal CI.
 * No reference pixels are loaded into the renderer. The original catalogue and
 * all unresolved functionality remain present beside source-identified PNGs. */
import { build } from 'vite';
import { chromium } from '@playwright/test';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
const output = process.argv[2];
if (!output) throw new Error('Usage: node scripts/phase27f-capture.mjs /new/evidence/directory');
const requested = process.argv.find((value) => value.startsWith('--ids='));
const requestedIds = requested ? requested.slice(6).split(',').map(Number) : null;
if (requestedIds?.some((id) => !Number.isInteger(id) || id < 1 || id > 100))
  throw new Error('Requested reference IDs must be integers from 1 to 100');
const directory = resolve(output),
  root = process.cwd();
await mkdir(directory); // Refuse to overwrite an existing evidence run.
async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)])),
    )
  ).flat();
}
const fingerprint = createHash('sha256');
for (const p of [
  ...(await files(resolve('src'))),
  resolve('package-lock.json'),
  resolve('index.html'),
  resolve('vite.config.ts'),
].sort()) {
  fingerprint.update(relative(root, p).replaceAll('\\', '/') + '\0');
  fingerprint.update(await readFile(p));
  fingerprint.update('\0');
}
const source = fingerprint.digest('hex');
const catalogueBuild = await build({
  configFile: false,
  logLevel: 'error',
  build: {
    write: false,
    lib: { entry: resolve('src/ui/reference-catalogue.ts'), formats: ['es'] },
  },
});
function outputChunk(result) {
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((r) => r.output ?? []);
  const chunk = outputs.find((p) => p.type === 'chunk' && p.isEntry);
  if (!chunk) throw new Error('Vite did not produce an executable entry chunk');
  return chunk;
}
const catChunk = outputChunk(catalogueBuild);
const { REFERENCES } = await import(
  'data:text/javascript;base64,' + Buffer.from(catChunk.code).toString('base64')
);
const built = await build({
  configFile: false,
  logLevel: 'error',
  build: {
    write: false,
    lib: {
      entry: resolve('e2e/fixtures/phase27f-reference.ts'),
      name: 'ReferenceWorkbench',
      formats: ['iife'],
    },
  },
});
const chunk = outputChunk(built);
const browser = await chromium.launch({
  headless: !process.env.HEADED,
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
const audit = {
  source,
  scope: 'component reference inspection; not human approval',
  captureTime: new Date().toISOString(),
  comparisons: [],
};
// Narrative portraits, department UIs and original hardware need their own
// relevant evidence. Never attach an unrelated car picture as their counterpart.
const photoIds = [
  39, 70, 79, 80, 85, 87, 93, 94, 1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 16, 22, 24, 26, 27, 28, 29, 30,
  31, 32, 33, 36, 41, 42, 44, 45, 46, 47, 66, 67, 68, 73, 75, 76, 77, 78, 81, 82, 83, 84, 86, 88,
  90, 96, 98, 100,
];
try {
  await page.setContent(
    '<!doctype html><title>Source-identified reference component inspection</title>',
  );
  await page.addScriptTag({ content: chunk.code });
  let state = '';
  for (const entry of REFERENCES) {
    let counterpart = null;
    if (
      photoIds.includes(entry.id) &&
      !entry.duplicateOf &&
      (!requestedIds || requestedIds.includes(entry.id))
    ) {
      const kind = [47, 94].includes(entry.id) ? 'grid' : entry.group === 'wet' ? 'rain' : 'clear';
      if (state !== kind) {
        await page.evaluate((k) => window.ReferenceWorkbench.begin(k), kind);
        state = kind;
      }
      const result = await page.evaluate((id) => window.ReferenceWorkbench.capture(id), entry.id);
      if (
        result.glError !== 0 ||
        result.contextLost ||
        result.opaqueSamples === 0 ||
        result.nonblackSamples === 0 ||
        result.width !== 1920 ||
        result.height !== 1080
      ) {
        await writeFile(
          join(directory, `failed-reference-${entry.id}.json`),
          JSON.stringify({ ...result, png: undefined }, null, 2),
        );
        await writeFile(
          join(directory, `failed-reference-${entry.id}.png`),
          Buffer.from(result.png.slice(result.png.indexOf(',') + 1), 'base64'),
        );
        throw new Error(
          `Invalid high-resolution renderer capture: reference ${entry.id}, ${result.width}x${result.height}, GL ${result.glError}, opaque ${result.opaqueSamples}, nonblack ${result.nonblackSamples}`,
        );
      }
      const bytes = Buffer.from(result.png.slice(result.png.indexOf(',') + 1), 'base64');
      const name = `reference-${String(entry.id).padStart(3, '0')}-${source.slice(0, 12)}.png`;
      await writeFile(join(directory, name), bytes);
      counterpart = {
        ...result,
        png: undefined,
        imageFile: name,
        imageHash: createHash('sha256').update(bytes).digest('hex'),
        source,
      };
    }
    audit.comparisons.push({
      id: entry.id,
      referenceHash: entry.sha256,
      title: entry.title,
      classification: entry.status,
      duplicateOf: entry.duplicateOf,
      status:
        entry.status === 'excluded'
          ? 'not-applicable'
          : entry.duplicateOf
            ? 'duplicate'
            : entry.status === 'supplementary'
              ? 'hardware-unverified'
              : 'needs-work',
      counterpart,
      humanReviewer: null,
      originalGap: entry.gap,
      limitation: counterpart
        ? 'Actual production camera/photo component. Native cockpit/pod/chase/trackside views replace irrelevant exterior-photo angles where appropriate; HUD, missing UI/actors, event timing and complete-image fidelity remain unaccepted.'
        : 'No relevant new high-resolution counterpart captured; missing evidence is explicit.',
    });
    await writeFile(
      join(directory, 'reference-inspection.json'),
      JSON.stringify({ ...audit, errors }, null, 2),
    );
    console.log(
      `${String(entry.id).padStart(3, '0')}: ${counterpart ? 'rendered' : 'no new counterpart'}`,
    );
  }
  if (errors.length) throw new Error(errors.join('\n'));
} finally {
  await page.evaluate(() => window.ReferenceWorkbench?.finish()).catch(() => {});
  await browser.close();
}
