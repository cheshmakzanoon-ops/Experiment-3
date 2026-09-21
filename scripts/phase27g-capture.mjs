/** Explicit inspection runner. It does not replace CI, the original application
 * route, human driving, hardware measurements or independent visual approval. */
import { build } from 'vite';
import { chromium } from '@playwright/test';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
const [output, eventDirectory] = process.argv.slice(2);
if (!output || !eventDirectory)
  throw new Error(
    'Usage: node scripts/phase27g-capture.mjs NEW_OUTPUT EVENT_DIRECTORY [--ids=1,2,3]',
  );
const retainedBuffer = process.argv.includes('--retained-buffer');
const requested = process.argv.find((s) => s.startsWith('--ids='));
const ids = requested ? requested.slice(6).split(',').map(Number) : null;
if (ids?.some((id) => !Number.isInteger(id) || id < 1 || id > 100))
  throw new Error('Invalid reference IDs');
const directory = resolve(output),
  root = process.cwd();
await mkdir(directory);
async function files(dir) {
  return (
    await Promise.all(
      (await readdir(dir, { withFileTypes: true })).map((e) =>
        e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
      ),
    )
  ).flat();
}
const hash = (value) => createHash('sha256').update(value).digest('hex');
async function sourceIdentity() {
  const h = createHash('sha256');
  for (const p of [
    ...(await files(resolve('src'))),
    resolve('package-lock.json'),
    resolve('index.html'),
    resolve('vite.config.ts'),
  ].sort()) {
    h.update(relative(root, p).replaceAll('\\', '/') + '\0');
    h.update(await readFile(p));
    h.update('\0');
  }
  return h.digest('hex');
}
function chunk(result) {
  const c = (Array.isArray(result) ? result : [result])
    .flatMap((r) => r.output ?? [])
    .find((p) => p.type === 'chunk' && p.isEntry);
  if (!c) throw new Error('No executable fixture bundle');
  return c;
}
async function bundle(entry, format, name) {
  return chunk(
    await build({
      configFile: false,
      logLevel: 'error',
      build: { write: false, lib: { entry: resolve(entry), formats: [format], name } },
    }),
  ).code;
}
const source = await sourceIdentity();
const catalogue = await bundle('src/ui/reference-catalogue.ts', 'es');
const routes = await bundle('src/ui/reference-routes.ts', 'es');
const { REFERENCES } = await import(
  'data:text/javascript;base64,' + Buffer.from(catalogue).toString('base64')
);
const { referenceRoute } = await import(
  'data:text/javascript;base64,' + Buffer.from(routes).toString('base64')
);
const eventsCode = await bundle('src/rendering/reference-events.ts', 'es');
const { referenceEvent } = await import(
  'data:text/javascript;base64,' + Buffer.from(eventsCode).toString('base64')
);
const code = await bundle('e2e/fixtures/phase27g-reference.ts', 'iife', 'Phase27GReference');
const index = JSON.parse(await readFile(join(eventDirectory, 'index.json'), 'utf8'));
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
  helperHash: hash(code),
  scope:
    'Production-component inspection. Not normal navigation, human approval, full application validation or physical hardware measurement.',
  startedAt: new Date().toISOString(),
  comparisons: [],
  retainedDiagnosticBuffer: retainedBuffer,
  attemptedIds: [],
  errors,
};
const status = (entry) =>
  entry.status === 'excluded'
    ? 'not-applicable'
    : entry.duplicateOf
      ? 'duplicate'
      : entry.status === 'supplementary'
        ? 'hardware-unverified'
        : 'needs-work';

// Preserve all 100 identities even when an early GPU capture fails. Unattempted
// entries remain explicitly unmeasured; they are not dropped or approved.
audit.comparisons = REFERENCES.map((entry) => ({
  id: entry.id,
  title: entry.title,
  referenceHash: entry.sha256,
  classification: entry.status,
  duplicateOf: entry.duplicateOf,
  status: status(entry),
  originalGap: entry.gap,
  route: referenceRoute(entry),
  limitation: 'No new relevant counterpart. The original gap remains open.',
  counterpart: null,
  humanReviewer: null,
  humanAccepted: false,
  visualAccepted: false,
}));
try {
  await page.setContent(
    '<!doctype html><title>27G component inspection — not full application acceptance</title>',
  );
  await page.addScriptTag({ content: code });
  await page.addStyleTag({ path: resolve('src/ui/style.css') });
  let current = '';
  for (const entry of REFERENCES) {
    const route = referenceRoute(entry),
      rule = referenceEvent(entry.id);
    let counterpart = null,
      limitation = 'No new relevant counterpart. The original gap remains open.';
    if (
      status(entry) === 'needs-work' &&
      route?.destination !== 'gap' &&
      (!ids || ids.includes(entry.id))
    ) {
      const weather = entry.group === 'wet' || rule?.kind.startsWith('wet-') ? 'rain' : 'clear';
      const kind = rule?.kind ?? 'motion',
        event = index.results[`${weather}-${kind}`];
      if (event) {
        if (current !== weather) {
          await page.evaluate(({ w, retain }) => window.Phase27GReference.begin(w, retain), {
            w: weather,
            retain: retainedBuffer,
          });
          current = weather;
        }
        audit.attemptedIds.push(entry.id);
        const bytes = await readFile(join(eventDirectory, event.file));
        const result = await page.evaluate(
          ({ id, record }) => window.Phase27GReference.capture(id, record),
          { id: entry.id, record: JSON.parse(bytes) },
        );
        const prefix = `reference-${String(entry.id).padStart(3, '0')}-${source.slice(0, 12)}`;
        if (
          result.glError !== 0 ||
          result.contextLost ||
          result.opaque !== 576 ||
          result.nonblack === 0 ||
          result.width !== 1920 ||
          result.height !== 1080
        ) {
          await writeFile(
            join(directory, `failed-${prefix}.json`),
            JSON.stringify({ ...result, png: undefined }, null, 2),
          );
          await writeFile(
            join(directory, `failed-${prefix}.png`),
            Buffer.from(result.png.split(';base64,')[1], 'base64'),
          );
          await page.screenshot({ path: join(directory, `failed-${prefix}-compositor.png`) });
          audit.comparisons[entry.id - 1].limitation =
            'Capture attempted but encoded pixels failed. The invalid image is retained separately, not counted as a counterpart.';
          throw new Error(
            `Invalid rendered counterpart ${entry.id}; no retries or assertion relaxation`,
          );
        }
        const canvasBytes = Buffer.from(result.png.split(';base64,')[1], 'base64');
        const pageBytes = await page.screenshot({ animations: 'disabled' });
        await writeFile(join(directory, `${prefix}-components.png`), pageBytes);
        const includeCanvas =
          result.interfaceKind === 'none' ||
          result.interfaceKind === 'actual-snapshot-HUD' ||
          result.interfaceKind === 'actual-photo-and-decal-controls';
        if (includeCanvas) await writeFile(join(directory, `${prefix}-canvas.png`), canvasBytes);
        counterpart = {
          ...result,
          png: undefined,
          source,
          inputEvent: event.file,
          inputHash: hash(bytes),
          imageFile: `${prefix}-components.png`,
          imageHash: hash(pageBytes),
          canvasFile: includeCanvas ? `${prefix}-canvas.png` : null,
          canvasHash: includeCanvas ? hash(canvasBytes) : null,
        };
        limitation =
          'Source-linked component diagnostic, not an accepted complete-image match. Event conditions do not certify framing, full chronology, UI relevance, audio or commercial art quality. The original gap is retained.';
      } else
        limitation = `The ordinary ${weather} run did not observe ${kind}; no fabricated event or unrelated car photo is substituted.`;
    }
    audit.comparisons[entry.id - 1] = {
      id: entry.id,
      title: entry.title,
      referenceHash: entry.sha256,
      classification: entry.status,
      duplicateOf: entry.duplicateOf,
      status: status(entry),
      originalGap: entry.gap,
      route,
      limitation,
      counterpart,
      humanReviewer: null,
      humanAccepted: false,
      visualAccepted: false,
    };
    await writeFile(join(directory, 'reference-inspection.json'), JSON.stringify(audit, null, 2));
    console.log(
      String(entry.id).padStart(3, '0'),
      counterpart ? 'captured' : status(entry),
      counterpart?.observation?.time ?? '',
    );
  }
  audit.finishedAt = new Date().toISOString();
  audit.finalSource = await sourceIdentity();
  if (audit.finalSource !== source)
    throw new Error('Runtime source changed during capture; this is not final-source evidence');
  if (errors.length) throw new Error(errors.join('\n'));
  await writeFile(join(directory, 'reference-inspection.json'), JSON.stringify(audit, null, 2));
} catch (error) {
  audit.failure = String(error);
  audit.failedAt = new Date().toISOString();
  audit.finalSource = await sourceIdentity();
  await writeFile(join(directory, 'reference-inspection.json'), JSON.stringify(audit, null, 2));
  throw error;
} finally {
  await page.evaluate(() => window.Phase27GReference?.finish()).catch(() => {});
  await browser.close();
}
