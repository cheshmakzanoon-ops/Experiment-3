import { graphicsPreset, type GraphicsOptions, type QualityPreset } from '../rendering/options.ts';
import { FpsMeter, type FpsStats } from './fps-meter.ts';

/** The graphics guide in GARAGE & SETTINGS: what each render quality preset changes (read
 * from the preset data itself, so the table cannot drift from the game), a suggestion from the
 * GPU's name, and a live frame-rate readout. The suggestion is a guess from a name: it cannot
 * see the CPU, the driver, the monitor or the thermal state, and the screen says so. Nothing
 * here touches the network: the name comes from the browser's WebGL debug-renderer extension. */
export const QUALITY_ORDER: readonly QualityPreset[] = ['low', 'medium', 'high', 'ultra'];
const LABEL: Readonly<Record<QualityPreset, string>> = {
  low: 'LOW',
  medium: 'MEDIUM',
  high: 'HIGH',
  ultra: 'ULTRA',
};

/** The GPU's name as the browser reports it (the unmasked renderer, else the generic one). */
export function gpuName(gl: WebGLRenderingContext | WebGL2RenderingContext | null): string | null {
  if (!gl) return null;
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return typeof name === 'string' && name.trim() ? name.trim() : null;
  } catch {
    return null;
  }
}
/** Ask for the name through a throwaway context (released at once). Null when WebGL is unavailable. */
export function readGpuName(doc: Document = document): string | null {
  try {
    const canvas = doc.createElement('canvas');
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as
      | WebGLRenderingContext
      | WebGL2RenderingContext
      | null;
    const name = gpuName(gl);
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return name;
  } catch {
    return null;
  }
}

export interface Recommendation {
  preset: QualityPreset;
  /** Why, in a clause that names the GPU class (from the name, not from a measurement). */
  reason: string;
  /** `guess` when the name matched a known family; `unknown` when it did not (Medium, the default). */
  basis: 'guess' | 'unknown';
}
const num = (value: string) => Number.parseInt(value, 10);
/** A preset for a GPU name. Families are matched in the order a name can mislead: software first,
 * then discrete cards by model number, Apple, Intel, handhelds and mobile; anything else is unknown. */
export function recommendPreset(name: string | null): Recommendation {
  const unknown: Recommendation = {
    preset: 'medium',
    reason: name
      ? 'This GPU is not in the list this screen knows, so Medium, the default, stands.'
      : 'The browser does not report a GPU name, so Medium, the default, stands.',
    basis: 'unknown',
  };
  if (!name) return unknown;
  const n = name.toLowerCase();
  const guess = (preset: QualityPreset, reason: string): Recommendation => ({
    preset,
    reason,
    basis: 'guess',
  });
  if (/swiftshader|llvmpipe|softpipe|software|basic render|offscreen/.test(n))
    return guess('low', 'a software renderer: there is no GPU doing the drawing.');
  if (/steam deck|van ?gogh|custom gpu 0405|amd custom gpu/.test(n))
    return guess(
      'medium',
      'a handheld GPU class: Medium holds the most headroom for 40 fps or more.',
    );
  let m = n.match(/rtx\s*(\d{4})/);
  if (m) {
    const model = num(m[1]);
    const line = Math.floor(model / 1000) * 10;
    const suffix = model % 100;
    if (suffix < 60) return guess('medium', `an entry discrete GPU (RTX ${model}).`);
    return suffix >= 70 && line >= 30
      ? guess('ultra', `a high-end discrete GPU (RTX ${line} series, model ${model}).`)
      : guess('high', `a discrete RTX ${line} series GPU (model ${model}).`);
  }
  m = n.match(/gtx\s*(\d{3,4})/);
  if (m) {
    const model = num(m[1]);
    return model >= 1660 || (model >= 1060 && model < 1600)
      ? guess('high', `a discrete GTX GPU (model ${model}).`)
      : guess('medium', `an older or entry discrete GTX GPU (model ${model}).`);
  }
  m = n.match(/radeon\s*(?:pro\s*)?rx\s*(\d{3,4})/);
  if (m) {
    const model = num(m[1]);
    const ultra =
      (model >= 6800 && model < 7000) || (model >= 7700 && model < 8000) || model >= 9070;
    if (ultra) return guess('ultra', `a high-end discrete Radeon (RX ${model}).`);
    if (model >= 5600) return guess('high', `a discrete Radeon (RX ${model}).`);
    return guess('medium', `an older or entry discrete Radeon (RX ${model}).`);
  }
  m = n.match(/apple\s*m(\d)(?:\s*(pro|max|ultra))?/);
  if (m)
    return m[2] === 'max' || m[2] === 'ultra'
      ? guess('ultra', `an Apple M${m[1]} ${m[2]}: a large integrated GPU.`)
      : guess('high', `an Apple M${m[1]} GPU.`);
  if (/apple gpu/.test(n))
    return guess('medium', 'an Apple GPU the browser does not name more closely.');
  m = n.match(/arc\s*(?:graphics\s*)?(?:pro\s*)?([ab])\s*(\d{3})/);
  if (m)
    return num(m[2]) >= 700
      ? guess('high', `an Intel Arc ${m[1].toUpperCase()}${m[2]}.`)
      : guess('medium', `an Intel Arc ${m[1].toUpperCase()}${m[2]}.`);
  if (/radeon.*(780m|760m|680m|660m)/.test(n))
    return guess('medium', 'a recent integrated Radeon GPU.');
  if (/intel.*(uhd|hd graphics|iris|xe)|radeon.*(vega|graphics)|amd radeon\(tm\) graphics/.test(n))
    return guess('low', 'an integrated GPU sharing the system memory.');
  if (/adreno|mali|powervr|videocore/.test(n)) return guess('low', 'a mobile GPU.');
  return unknown;
}

const effects = (g: GraphicsOptions) =>
  [
    g.crowd && 'crowd',
    g.bloom && 'bloom',
    g.ambientOcclusion && 'AO',
    g.localFog && 'haze',
    g.lensEffects && 'lens',
    g.lightShafts && 'sun shafts',
  ]
    .filter(Boolean)
    .join(' · ') || 'none';
/** The rows of the preset comparison: label and the value for each preset, read from `graphicsPreset`. */
export function presetRows(): { label: string; values: Record<QualityPreset, string> }[] {
  const g = Object.fromEntries(QUALITY_ORDER.map((q) => [q, graphicsPreset(q)])) as Record<
    QualityPreset,
    GraphicsOptions
  >;
  const row = (label: string, f: (o: GraphicsOptions) => string) => ({
    label,
    values: Object.fromEntries(QUALITY_ORDER.map((q) => [q, f(g[q])])) as Record<
      QualityPreset,
      string
    >,
  });
  return [
    row('RESOLUTION', (o) => `${Math.round(o.resolutionScale * 100)}%`),
    row('EDGES', (o) =>
      o.temporalAA
        ? `${o.msaa}× MSAA + TAA`
        : o.msaa
          ? `${o.msaa}× MSAA`
          : o.antialias
            ? 'FXAA'
            : 'none',
    ),
    row('SHADOWS', (o) =>
      o.shadowSize ? `${o.shadowSize} px, ${o.shadowCascades} cascades` : 'off',
    ),
    row('REFLECTIONS', (o) =>
      o.ssr ? 'probe + screen-space' : o.reflections === 'local' ? 'local probe' : 'sky only',
    ),
    row('EXTRAS', effects),
  ];
}
/** One preset as a line a narrow column can wrap: every row's value, labelled. */
export function presetLine(preset: QualityPreset) {
  return presetRows()
    .map((r) => `${r.label.toLowerCase()} ${r.values[preset]}`)
    .join(' · ');
}
const esc = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/** The guide's markup: the presets (the chosen one marked), the suggestion and the frame-rate readout. */
export function qualityGuideHtml(current: QualityPreset, gpu: string | null) {
  const rec = recommendPreset(gpu);
  const list = QUALITY_ORDER.map(
    (q) =>
      `<li data-preset="${q}"${q === current ? ' aria-current="true"' : ''}><b>${LABEL[q]}</b><span>${esc(presetLine(q))}</span></li>`,
  ).join('');
  const reason = rec.reason.charAt(0).toUpperCase() + rec.reason.slice(1);
  return `<section class="gq" aria-label="Graphics guide"><h4 class="gq-label">WHAT EACH PRESET CHANGES</h4><ol class="gq-list">${list}</ol><div class="gq-rec" data-basis="${rec.basis}"><b>FOR THIS GPU · ${LABEL[rec.preset]}</b><span class="gq-gpu">${gpu ? esc(gpu) : 'GPU name not reported'}</span><p>${esc(reason)} It is a guess from the name: the frame rate below is the measurement.</p><button type="button" class="gq-use" data-use="${rec.preset}">USE ${LABEL[rec.preset]}</button></div><div class="gq-fps"><b>FRAME RATE · THIS WINDOW</b><output class="gq-fps-now" aria-live="off">—</output><small class="gq-fps-low"></small><p>The game is not drawing while this screen is open, so this is the rate the window delivers frames: it drops when the GPU or the machine is busy. For the race itself, press F3 in a session.</p></div></section>`;
}

/** Wire the guide inside `form`: the table follows the quality select, USE sets it, and the
 * frame-rate meter runs while the screen is open. Returns the disposer. */
export function bindQualityGuide(form: HTMLFormElement): () => void {
  const guide = form.querySelector<HTMLElement>('.gq');
  const select = form.elements.namedItem('quality') as HTMLSelectElement | null;
  if (!guide || !select) return () => undefined;
  const mark = () => {
    for (const el of guide.querySelectorAll<HTMLElement>('[data-preset]')) {
      if (el.dataset.preset === select.value) el.setAttribute('aria-current', 'true');
      else el.removeAttribute('aria-current');
    }
  };
  select.addEventListener('change', mark);
  const use = guide.querySelector<HTMLButtonElement>('.gq-use');
  use?.addEventListener('click', () => {
    select.value = use.dataset.use!;
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    mark();
  });
  const now = guide.querySelector<HTMLOutputElement>('.gq-fps-now')!;
  const low = guide.querySelector<HTMLElement>('.gq-fps-low')!;
  const show = (stats: FpsStats | null) => {
    if (!stats) return;
    now.value = `${Math.round(stats.fps)} FPS`;
    now.dataset.band = stats.fps >= 55 ? 'good' : stats.fps >= 30 ? 'fair' : 'low';
    low.textContent = `1% LOW ${Math.round(stats.low)} FPS`;
  };
  const meter = new FpsMeter(show);
  meter.start();
  return () => {
    meter.stop();
    select.removeEventListener('change', mark);
  };
}
