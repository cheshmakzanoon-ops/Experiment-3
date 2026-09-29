import { chromium, type FullConfig } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { browserBackend, requireBrowserBackend } from './browser-backend.ts';

/** Observe the same launch configuration as the tests, before accepting any
 * scene evidence. Retain actual adapter data even if the backend assertion fails. */
export default async function verifyBrowserBackend(config: FullConfig) {
  const selected = browserBackend(process.env.APEX_BROWSER_BACKEND);
  const project = config.projects[0];
  if (!project) throw new Error('No browser project configured');
  const browser = await chromium.launch({
    ...project.use.launchOptions,
    headless: project.use.headless,
  });
  try {
    const page = await browser.newPage();
    const observation = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2');
      if (!gl) throw new Error('The configured browser has no WebGL2 context');
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      if (!debug) throw new Error('The configured browser did not expose its graphics adapter');
      gl.clearColor(0.25, 0.5, 0.75, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const pixel = new Uint8Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      const observed = {
        renderer: gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) as string,
        vendor: gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) as string,
        version: gl.getParameter(gl.VERSION) as string,
        pixel: [...pixel],
        error: gl.getError(),
      };
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return observed;
    });
    const report = {
      requested: selected.name,
      ...observation,
      softwareRendererDetected: /llvmpipe|swiftshader|softpipe/i.test(observation.renderer),
      physicalHardwareValidated: false,
    };
    writeFileSync('browser-backend.json', JSON.stringify(report, null, 2));
    console.log(`Observed ${selected.name} test backend: ${observation.renderer}`);
    requireBrowserBackend(selected.name, observation.renderer);
    if (
      observation.error !== 0 ||
      observation.pixel.length !== 4 ||
      observation.pixel.some((value, i) => value !== [64, 128, 191, 255][i])
    )
      throw new Error('Software graphics framebuffer validation failed');
  } finally {
    await browser.close();
  }
}
