/** Browser observations, never a minimum-spec/VRAM/physical-device certificate.
 * Collected only for an explicitly requested local evidence export. */
export interface ReviewHardware {
  version: 1;
  platform: string;
  userAgent: string;
  logicalProcessors: number | null;
  reportedDeviceMemoryGiB: number | null;
  graphics: {
    vendor: string | null;
    renderer: string | null;
    version: string | null;
    softwareRendererDetected: boolean | null;
  };
  javascriptHeapBytes: number | null;
  gpuVRAMBytes: null;
  physicalControllerVerified: false;
  browserReportsWindows: boolean;
  osStringIsNotAttestation: true;
}
const text = (v: unknown, limit = 256) => (typeof v === 'string' ? v.slice(0, limit) : null);
const positive = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
export function reviewHardware(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  nav: Pick<Navigator, 'platform' | 'userAgent' | 'hardwareConcurrency'> & {
    deviceMemory?: number;
  } = navigator,
  perf: { memory?: { usedJSHeapSize?: number } } = performance as Performance & {
    memory?: { usedJSHeapSize?: number };
  },
): ReviewHardware {
  let vendor: string | null = null,
    renderer: string | null = null,
    version: string | null = null;
  try {
    version = text(gl.getParameter(gl.VERSION));
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    if (debug) {
      vendor = text(gl.getParameter(debug.UNMASKED_VENDOR_WEBGL));
      renderer = text(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL));
    }
  } catch {
    /* Privacy policy/context loss may make identity unavailable. */
  }
  return {
    version: 1,
    platform: nav.platform.slice(0, 80),
    userAgent: nav.userAgent.slice(0, 1024),
    logicalProcessors: positive(nav.hardwareConcurrency),
    reportedDeviceMemoryGiB: positive(nav.deviceMemory),
    graphics: {
      vendor,
      renderer,
      version,
      softwareRendererDetected:
        renderer === null
          ? null
          : /swiftshader|llvmpipe|softpipe|software rasterizer/i.test(renderer),
    },
    javascriptHeapBytes: positive(perf.memory?.usedJSHeapSize),
    gpuVRAMBytes: null,
    physicalControllerVerified: false,
    browserReportsWindows: /win/i.test(nav.platform),
    osStringIsNotAttestation: true,
  };
}

interface DeviceRange {
  id: string;
  index: number;
  mapping: string;
  samples: number;
  axes: { minimum: number; maximum: number }[];
  buttons: { minimum: number; maximum: number }[];
}
/** Bounded samples of browser-visible inputs. An axis changing is an observation,
 * NOT proof of a physical wheel/human: browser automation can supply inputs. */
export class ReviewInputEvidence {
  private devices = new Map<string, DeviceRange>();
  private samples = 0;
  private keyboardEvents = 0;
  private untrustedEvents = 0;
  private failures = 0;
  private lastAt = -Infinity;
  clear() {
    this.devices.clear();
    this.samples = this.keyboardEvents = this.untrustedEvents = this.failures = 0;
    this.lastAt = -Infinity;
  }
  keyboard(trusted: boolean) {
    if (trusted) this.keyboardEvents++;
    else this.untrustedEvents++;
  }
  sample(now: number, getPads: () => readonly (Gamepad | null)[]) {
    if (!Number.isFinite(now) || now - this.lastAt < 200) return;
    this.lastAt = now;
    this.samples++;
    try {
      for (const pad of getPads().slice(0, 8)) {
        if (!pad?.connected) continue;
        const key = `${pad.index}:${pad.id}`;
        let device = this.devices.get(key);
        if (!device) {
          if (this.devices.size >= 8) continue;
          device = {
            id: pad.id.slice(0, 160),
            index: pad.index,
            mapping: pad.mapping,
            samples: 0,
            axes: [],
            buttons: [],
          };
          this.devices.set(key, device);
        }
        device.samples++;
        const ranges = (values: readonly number[], target: DeviceRange['axes'], min: number) => {
          for (let i = 0; i < values.length; i++) {
            const v = values[i];
            if (!Number.isFinite(v) || v < min || v > 1) continue;
            target[i] ??= { minimum: v, maximum: v };
            target[i].minimum = Math.min(v, target[i].minimum);
            target[i].maximum = Math.max(v, target[i].maximum);
          }
        };
        ranges(pad.axes.slice(0, 32), device.axes, -1);
        ranges(
          pad.buttons.slice(0, 64).map((b) => b.value),
          device.buttons,
          0,
        );
      }
    } catch {
      this.failures++;
    }
  }
  report() {
    return {
      samples: this.samples,
      trustedKeyboardEvents: this.keyboardEvents,
      untrustedKeyboardEvents: this.untrustedEvents,
      accessFailures: this.failures,
      devices: structuredClone([...this.devices.values()]),
      physicalControllerVerified: false,
      humanVerified: false,
      scope: 'browser-input-observations-not-hardware-certification' as const,
    };
  }
}
