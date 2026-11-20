import { expect, type Page } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const marker = Buffer.from([217, 25, 143, 217, 25, 143, 217, 25, 143]);

/** The headed Mesa renderer is already on an X11 display. Read the presented
 * pixels there so capturing evidence cannot queue another full WebGL draw.
 * Calibrate the viewport once on about:blank before loading the real game. */
export async function motocrossScreenCapture(page: Page) {
  if (process.env.APEX_BROWSER_BACKEND !== 'mesa')
    return async (path: string) => {
      await page.screenshot({ path, timeout: 60000 });
    };

  const viewport = page.viewportSize();
  if (!viewport) throw new Error('The motocross capture requires a fixed viewport');
  await page.bringToFront();
  await page.setContent(
    '<style>html{background:#d9198f}body:after{content:"";position:fixed;right:0;bottom:0;width:8px;height:8px;background:#1cd78b}</style>',
  );
  let crop = '';
  await expect
    .poll(
      async () => {
        const { stdout } = await run(
          'import',
          ['-silent', '-window', 'root', '-depth', '8', 'ppm:-'],
          { encoding: 'buffer', timeout: 10000, maxBuffer: 64 * 1024 * 1024 },
        );
        const header = /^P6\s+(?:#[^\n]*\n\s*)*(\d+)\s+(\d+)\s+255\r?\n/.exec(
          stdout.toString('ascii', 0, 1024),
        );
        if (!header) throw new Error('Cannot read the X11 display dimensions from its PPM header');
        const screenWidth = Number(header[1]),
          pixels = stdout.subarray(header[0].length),
          start = pixels.indexOf(marker);
        if (start < 0 || start % 3 !== 0) return false;
        const x = (start / 3) % screenWidth,
          y = Math.floor(start / 3 / screenWidth),
          end = start + ((viewport.height - 1) * screenWidth + viewport.width - 1) * 3;
        if (pixels[end] !== 28 || pixels[end + 1] !== 215 || pixels[end + 2] !== 139) return false;
        crop = `${viewport.width}x${viewport.height}+${x}+${y}`;
        return true;
      },
      { timeout: 20000, message: 'locate both corners of the presented Chromium viewport' },
    )
    .toBe(true);
  console.info(`[MX journey] Capturing the presented X11 viewport at ${crop}`);
  return async (path: string) => {
    await run(
      'import',
      ['-silent', '-window', 'root', '-crop', crop, '+repage', '-strip', `PNG24:${path}`],
      { timeout: 60000 },
    );
  };
}
