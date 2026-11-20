import type { CDPSession, Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const inset = 32;
const size = 12;

function findMarker(pixels: Buffer, width: number, height: number, green: boolean) {
  const matches = (i: number) => {
    const r = pixels[i],
      g = pixels[i + 1],
      b = pixels[i + 2];
    return green ? g > r + 70 && g > b + 25 && b > r + 25 : r > g + 70 && b > g + 45 && r > b + 20;
  };
  for (let y = 1; y <= height - size; y++)
    for (let x = 1; x <= width - size; x++) {
      const i = (y * width + x) * 3;
      if (!matches(i) || matches(i - 3) || matches(i - width * 3)) continue;
      if (
        matches(i + (size - 1) * 3) &&
        matches(i + (size - 1) * width * 3) &&
        matches(i + (size - 1) * (width + 1) * 3)
      )
        return { x, y };
    }
  return null;
}

/** Copy the visible Chromium view when the window system cannot supply a
 * calibrated crop. The caller checks the dimensions and image identity. */
async function captureView(page: Page, session: CDPSession, path: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const viewport = page.viewportSize()!;
    const { data } = await Promise.race([
      session.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: false,
        captureBeyondViewport: false,
        clip: { x: 0, y: 0, ...viewport, scale: 1 },
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Timed out reading the Chromium view')), 60000);
      }),
    ]);
    await writeFile(path, Buffer.from(data, 'base64'));
  } finally {
    clearTimeout(timer);
  }
}

/** Read a dedicated virtual display without queuing another WebGL draw.
 * Locate two inset targets on about:blank before opening the real game. */
export async function motocrossScreenCapture(page: Page) {
  // One channel follows the tab across both venues. Per-image detach can
  // stall after Chromium has already delivered a complete riding screenshot.
  // The browser releases this session when the page target closes.
  let channel: Promise<CDPSession> | undefined;
  const session = () => (channel ??= page.context().newCDPSession(page));
  const readView = async (path: string) => captureView(page, await session(), path);
  if (process.env.APEX_MOTOCROSS_XVFB_CAPTURE !== '1') {
    // A normal Playwright screenshot can request another compositor frame
    // while the ride is already GPU-bound. Read the last presented view on
    // either software backend; the caller verifies every capture's identity.
    return readView;
  }
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('The motocross capture requires a fixed viewport');
  await page.bringToFront();
  const chrome = await session();
  const { windowId } = await chrome.send('Browser.getWindowForTarget');
  // Xvfb has no window manager. Leave room for Chromium's toolbar and
  // native frame while Playwright keeps the game viewport at its set size.
  await chrome.send('Browser.setWindowBounds', {
    windowId,
    bounds: {
      left: 0,
      top: 0,
      width: viewport.width + 96,
      height: viewport.height + 160,
    },
  });
  await page.setContent(`<style>
    html { background:#182029 } i,b { position:fixed; width:${size}px; height:${size}px }
    i { left:${inset}px; top:${inset}px; background:#d9198f }
    b { right:${inset}px; bottom:${inset}px; background:#1cd78b }
    </style><i></i><b></b>`);
  let crop = '',
    observed = '';
  for (let attempt = 0; attempt < 3 && !crop; attempt++) {
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    const { stdout } = await run(
      'import',
      ['-silent', '-screen', '-window', 'root', '-depth', '8', 'ppm:-'],
      { encoding: 'buffer', timeout: 10000, maxBuffer: 64 * 1024 * 1024 },
    );
    const header = /^P6\s+(?:#[^\n]*\n\s*)*(\d+)\s+(\d+)\s+255\r?\n/.exec(
      stdout.toString('ascii', 0, 1024),
    );
    if (!header) throw new Error('Cannot read the X11 display dimensions from its PPM header');
    const width = Number(header[1]),
      height = Number(header[2]),
      pixels = stdout.subarray(header[0].length);
    const first = findMarker(pixels, width, height, false),
      last = findMarker(pixels, width, height, true);
    if (first && last) {
      const x = first.x - inset,
        y = first.y - inset;
      if (
        last.x - first.x === viewport.width - 2 * inset - size &&
        last.y - first.y === viewport.height - 2 * inset - size &&
        x >= 0 &&
        y >= 0 &&
        x + viewport.width <= width &&
        y + viewport.height <= height
      ) {
        crop = `${viewport.width}x${viewport.height}+${x}+${y}`;
        break;
      }
    }
    const center = 3 * (Math.floor(height / 2) * width + Math.floor(width / 2));
    observed = JSON.stringify({
      screen: [width, height],
      first,
      last,
      centerRGB: [...pixels.subarray(center, center + 3)],
    });
  }
  if (!crop) {
    console.info(`[MX journey] Reading the Chromium view. X11 targets: ${observed}`);
    return readView;
  }
  console.info(`[MX journey] Capturing the presented X11 viewport at ${crop}`);
  return async (path: string) => {
    await run(
      'import',
      [
        '-silent',
        '-screen',
        '-window',
        'root',
        '-crop',
        crop,
        '+repage',
        '-strip',
        `PNG24:${path}`,
      ],
      { timeout: 60000 },
    );
  };
}
