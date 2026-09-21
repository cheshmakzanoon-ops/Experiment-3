import { expect, it } from 'vitest';
import { reviewHardware, ReviewInputEvidence } from '../src/ui/review-hardware.ts';
const nav = {
  platform: 'Linux x86_64',
  userAgent: 'Synthetic browser fixture',
  hardwareConcurrency: 8,
};
it('keeps unavailable values unknown and never converts resource/OS/device identity to hardware acceptance', () => {
  const gl = {
    VERSION: 1,
    getParameter: () => null,
    getExtension: () => null,
  } as unknown as WebGL2RenderingContext;
  const h = reviewHardware(gl, nav, {});
  expect(h.graphics.renderer).toBeNull();
  expect(h.graphics.softwareRendererDetected).toBeNull();
  expect(h.gpuVRAMBytes).toBeNull();
  expect(h.javascriptHeapBytes).toBeNull();
  expect(h.reportedDeviceMemoryGiB).toBeNull();
  expect(h.physicalControllerVerified).toBe(false);
  expect(h.browserReportsWindows).toBe(false);
});
it('identifies a reported software renderer and distinguishes JS heap from VRAM', () => {
  const gl = {
    VERSION: 1,
    getParameter: (p: number) => (p === 3 ? 'ANGLE SwiftShader' : p === 2 ? 'Google' : 'WebGL2'),
    getExtension: () => ({ UNMASKED_VENDOR_WEBGL: 2, UNMASKED_RENDERER_WEBGL: 3 }),
  } as unknown as WebGL2RenderingContext;
  const h = reviewHardware(
    gl,
    { ...nav, platform: 'Win32' },
    { memory: { usedJSHeapSize: 12345 } },
  );
  expect(h.graphics.softwareRendererDetected).toBe(true);
  expect(h.javascriptHeapBytes).toBe(12345);
  expect(h.gpuVRAMBytes).toBeNull();
  expect(h.osStringIsNotAttestation).toBe(true);
});
it('records bounded input ranges, handles device access failure and never claims physical/human proof', () => {
  const e = new ReviewInputEvidence();
  const pad = {
    index: 0,
    id: 'Synthetic unit-test device',
    mapping: 'standard',
    connected: true,
    axes: [0, 0],
    buttons: [{ value: 0 }],
  } as unknown as Gamepad;
  e.sample(0, () => [pad]);
  e.sample(50, () => [pad]);
  e.sample(200, () => [
    {
      ...pad,
      axes: [-0.75, 0.25],
      buttons: [{ value: 1, pressed: true, touched: true }],
    } as Gamepad,
  ]);
  e.sample(400, () => {
    throw new Error('Access unavailable');
  });
  e.keyboard(true);
  e.keyboard(false);
  const r = e.report();
  expect(r.samples).toBe(3);
  expect(r.accessFailures).toBe(1);
  expect(r.devices[0].axes[0]).toEqual({ minimum: -0.75, maximum: 0 });
  expect(r.devices[0].buttons[0]).toEqual({ minimum: 0, maximum: 1 });
  expect(r.physicalControllerVerified).toBe(false);
  expect(r.humanVerified).toBe(false);
  e.clear();
  expect(e.report().samples).toBe(0);
  expect(r.devices).toHaveLength(1);
});
