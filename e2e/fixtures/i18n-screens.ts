import { Interface } from '../../src/ui/interface.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { DEFAULT_OPTIONS, DEFAULT_SETUP, validateOptions } from '../../src/simulation/config.ts';
import { DEFAULT_SETTINGS, backupKey } from '../../src/storage/data.ts';
import { F, H, carBase } from '../../src/simulation/protocol.ts';
import { CareerController } from '../../src/career/controller.ts';
import { wildcardBoardHtml } from '../../src/ui/wildcard-board.ts';
import { setLocale, type Locale } from '../../src/i18n/index.ts';

/** The production Interface in a given language with no renderer or worker, for the language
 * checks: `mount(scene, locale)` builds the screen, `snapshot(scene)` serialises it with the
 * language controls (`[data-i18n-ui]`) taken out, so the English markup can be compared with
 * the markup captured before any string was localised (e2e/fixtures/i18n-en). */
export type Scene =
  | 'loading'
  | 'paddock'
  | 'hud'
  | 'firstrun'
  | 'results'
  | 'settings'
  | 'career'
  | 'wildcard'
  | 'pause';
export const SCENES: readonly Scene[] = [
  'loading',
  'paddock',
  'hud',
  'firstrun',
  'results',
  'settings',
  'career',
  'wildcard',
  'pause',
];

export async function mount(scene: Scene, locale: Locale) {
  await setLocale(locale);
  document.documentElement.lang = locale;
  document.body.replaceChildren();
  const root = document.createElement('main');
  root.id = 'app';
  document.body.append(root);
  const events = document.createElement('output');
  events.id = 'i18nEvents';
  events.hidden = true;
  document.body.append(events);
  const simulation = new Simulation(validateOptions(DEFAULT_OPTIONS));
  const data = new Map<string, unknown>();
  let career: CareerController | null = null;
  const ui: Interface = new Interface(root, simulation.track, {
    action: (name) => {
      events.textContent += `${name};`;
      if (name === 'career' || name.startsWith('career:')) career?.action(name);
      if (name === 'modalClose') ui.closeModal();
    },
    start: () => {},
    apply: () => {},
    seek: () => {},
    replaySpeed: () => {},
    exportSetup: () => {},
    importSetup: () => {},
  });
  (window as unknown as Record<string, unknown>).i18nUi = ui;
  if (scene === 'loading') return;
  if (scene === 'career') {
    career = new CareerController({
      store: {
        async read(key) {
          return structuredClone(data.get(key));
        },
        async write(key, value) {
          data.set(key, structuredClone(value));
        },
        async writeWithBackup(key, value) {
          if (data.has(key)) data.set(backupKey(key), data.get(key));
          data.set(key, structuredClone(value));
        },
      },
      modal: (html) => ui.modalContent(html),
      modalRoot: () => ui.get('modalContent'),
      toast: (message) => ui.toast(message),
      setResultsExtra: () => {},
      start: () => {},
      pause: () => {},
      state: () => 'menu',
      track: () => simulation.track,
      setup: () => ({ ...DEFAULT_SETUP }),
      assist: () => 'sport',
    });
    await career.load({});
  }
  ui.ready();
  ui.showMode('menu');
  if (scene === 'paddock' || scene === 'hud') return;
  if (scene === 'firstrun') ui.firstRun('keys');
  else if (scene === 'settings') ui.settings(structuredClone(DEFAULT_SETTINGS));
  else if (scene === 'wildcard') ui.modalContent(wildcardBoardHtml(null));
  else if (scene === 'career') {
    (root.querySelector('[data-action="career"]') as HTMLElement).click();
    await new Promise((resolve) => setTimeout(resolve, 50));
  } else if (scene === 'pause') {
    ui.showMode('paused');
    ui.pause();
  } else if (scene === 'results') {
    ui.options = simulation.options;
    ui.showMode('results');
    const frame = simulation.makeFrame();
    const cars = Math.round(frame[H.CARS]);
    for (let id = 0; id < cars; id++) {
      const o = carBase(id);
      frame[o + F.RANK] = id + 1;
      frame[o + F.LAPS] = 3;
      frame[o + F.FINISH] = 181.2 + id * 2.31;
      frame[o + F.BEST_LAP] = 58.4 + id * 0.173;
    }
    ui.results(frame);
  }
}

const part: Record<Scene, string> = {
  loading: '#loading',
  paddock: '#menu',
  hud: '#hud',
  firstrun: '#modalContent',
  results: '#modalContent',
  settings: '#modalContent',
  career: '#modalContent',
  wildcard: '#modalContent',
  pause: '#modalContent',
};
/** The markup of the scene without the language controls. */
export function snapshot(scene: Scene): string {
  const node = document.querySelector(part[scene])!.cloneNode(true) as HTMLElement;
  node.querySelectorAll('[data-i18n-ui]').forEach((e) => e.remove());
  // Path geometry is not text: keep a short digest so a change still shows, not 500 KB of curve.
  node.querySelectorAll('path[d]').forEach((p) => {
    const d = p.getAttribute('d')!;
    let h = 2166136261;
    for (let i = 0; i < d.length; i++) h = Math.imul(h ^ d.charCodeAt(i), 16777619) >>> 0;
    p.setAttribute('d', `#${d.length}:${h.toString(16)}`);
  });
  return node.outerHTML;
}

/** Layout facts of the open scene: horizontal overflow of the page, the dialog and the
 * paddock body, and every visible control whose text is clipped or leaves its box. */
export function layout(scene: Scene) {
  const root = document.documentElement;
  const dialog = document.querySelector<HTMLDialogElement>('#modal');
  const body = document.querySelector<HTMLElement>('.menu-body');
  const scope = (
    part[scene] === '#modalContent' ? dialog! : document.querySelector(part[scene])!
  ) as HTMLElement;
  const wide = (el: HTMLElement | null) => (el ? el.scrollWidth - el.clientWidth : 0);
  const clipped: string[] = [];
  const bad: string[] = [];
  const visible = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && el.offsetParent !== null;
  };
  const name = (el: HTMLElement) =>
    `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''}[${(el.textContent ?? '').trim().slice(0, 40)}]`;
  for (const el of scope.querySelectorAll<HTMLElement>('button, a, label, h1, h2, h3, .lb-plate b')) {
    if (!visible(el) || el.closest('[hidden]')) continue;
    const style = getComputedStyle(el);
    // Text that is cut off by the element's own box.
    const cuts = style.overflowX !== 'visible' || style.textOverflow === 'ellipsis';
    if (cuts && el.scrollWidth > el.clientWidth + 1) clipped.push(name(el));
    // A control that pokes out of the viewport sideways.
    const r = el.getBoundingClientRect();
    if (r.right > innerWidth + 1 || r.left < -1) bad.push(name(el));
  }
  return {
    page: wide(root),
    dialog: wide(dialog && dialog.open ? dialog : null),
    menuBody: scene === 'paddock' ? wide(body) : 0,
    clipped,
    outside: bad,
  };
}
