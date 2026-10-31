import { _electron as electron } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const executable =
  process.platform === 'win32'
    ? 'desktop-out/win-unpacked/MOTOBOUND.exe'
    : process.platform === 'darwin'
      ? `desktop-out/${process.arch === 'arm64' ? 'mac-arm64' : 'mac'}/MOTOBOUND.app/Contents/MacOS/MOTOBOUND`
      : 'desktop-out/linux-unpacked/motobound';
await mkdir('desktop-evidence', { recursive: true });
const profile = await mkdtemp(join(tmpdir(), 'motobound-smoke-'));
const report = {
  platform: process.platform,
  arch: process.arch,
  executable,
  source: JSON.parse(await readFile('desktop-stage/DESKTOP_BUILD.json', 'utf8')),
  checks: [],
  console: [],
  processLog: [],
  errors: [],
  remoteRequests: [],
};
let application, page;
try {
  application = await electron.launch({
    executablePath: resolve(executable),
    args: [
      `--user-data-dir=${profile}`,
      '--enable-logging=stderr',
      ...(process.env.MOTOBOUND_CI_GL === 'mesa' ? ['--use-gl=angle', '--use-angle=gl'] : []),
    ],
    timeout: 120000,
  });
  for (const stream of [application.process().stdout, application.process().stderr])
    stream?.on('data', (data) => report.processLog.push(String(data).slice(0, 8000)));
  report.gpu = await application.evaluate(({ app }) => app.getGPUFeatureStatus());
  page = await application.firstWindow({ timeout: 120000 });
  page.on('console', (message) =>
    report.console.push({ type: message.type(), text: message.text() }),
  );
  page.on('pageerror', (error) => report.errors.push(error.message));
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) report.remoteRequests.push(request.url());
  });
  await page.waitForURL('motobound://game/babylon.html', { timeout: 120000 });
  await page.waitForFunction(
    () =>
      /DRIVING|PAUSED|could not start/.test(document.querySelector('#status')?.textContent ?? ''),
    {},
    { timeout: 120000 },
  );
  report.initialStatus = await page.locator('#status').textContent();
  if (!/DRIVING|PAUSED/.test(report.initialStatus ?? ''))
    throw new Error(report.initialStatus || 'Babylon did not start');
  report.checks.push('packaged offline Babylon entry started');
  const resume = page.getByRole('button', { name: 'Resume', exact: true });
  if (await resume.isVisible()) await resume.click();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector('#status')?.textContent?.includes('PAUSED'),
  );
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector('#status')?.textContent?.includes('DRIVING'),
  );
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  report.checks.push('pause/resume/restart');
  const preferences = await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(),
  );
  if (
    !preferences.contextIsolation ||
    !preferences.sandbox ||
    preferences.nodeIntegration ||
    preferences.webSecurity === false
  )
    throw new Error('Desktop renderer isolation is not active');
  report.checks.push('sandbox/context isolation active, Node integration disabled');
  report.gpu = await application.evaluate(({ app }) => app.getGPUFeatureStatus());
  await page.screenshot({ path: 'desktop-evidence/packaged-babylon.png' });
  if (report.errors.length || report.remoteRequests.length)
    throw new Error('Unexpected renderer errors or remote runtime requests');
  report.success = true;
} catch (error) {
  report.success = false;
  report.failure = String(error);
  console.error(report.failure);
  try {
    await page?.screenshot({ path: 'desktop-evidence/failure.png' });
  } catch {
    // A failed launch may not have produced a renderer to capture.
  }
  process.exitCode = 1;
} finally {
  await writeFile('desktop-evidence/report.json', JSON.stringify(report, null, 2) + '\n');
  await application?.close();
}
