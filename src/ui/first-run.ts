import { DEFAULT_BINDINGS, keyName, type Bindings } from '../input/bindings.ts';
import {
  BOARD_DISCIPLINES,
  DISCIPLINE_SPECS,
  disciplineFacts,
  type BoardDiscipline,
} from './disciplines.ts';
import { glyph, plateSvg } from './glyphs.ts';
import { uiCue } from './ui-cue.ts';

/** First launch (G3: first launch to first driving in at most three inputs).
 * One screen on the paddock board's own parts: the input (keyboard or controller),
 * the four discipline plates, then DRIVE THE FIRST LAP. Both choices arrive
 * preselected (the controller if one is connected, the circuit plate), so the
 * shortest path is one input. SKIP goes straight to the paddock. The first lap is
 * the Driving Academy's programme (src/ui/driving-academy.ts): solo, dry, medium
 * tyres, the braking zones and the racing line painted on the road. What the
 * player chose is remembered in the save store under `firstrun:v1`, written when
 * the screen opens, so any way out of it (a skip, Escape, a closed window) counts
 * as seen and it is never shown twice. */
export const FIRST_RUN_KEY = 'firstrun:v1';
export type FirstRunDevice = 'keys' | 'pad';
export interface FirstRunRecord {
  version: 1;
  /** Epoch milliseconds when the screen was first shown. */
  at: number;
  device: FirstRunDevice;
  /** The plate chosen, or null when skipped. */
  discipline: BoardDiscipline | null;
  /** True once the first lap was started from this screen. */
  drove: boolean;
}

export function validateFirstRun(raw: unknown): FirstRunRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  if (v.version !== 1) return null;
  if (v.device !== 'keys' && v.device !== 'pad') return null;
  if (typeof v.at !== 'number' || !Number.isFinite(v.at) || v.at < 0) return null;
  const discipline =
    v.discipline === null || v.discipline === undefined
      ? null
      : (BOARD_DISCIPLINES as readonly unknown[]).includes(v.discipline)
        ? (v.discipline as BoardDiscipline)
        : undefined;
  if (discipline === undefined) return null;
  return { version: 1, at: v.at, device: v.device, discipline, drove: v.drove === true };
}

/** Whether the first-launch screen opens. A harness that drives the browser by
 * script (navigator.webdriver) must not get a modal over the menu it expects, so
 * it skips the screen unless `?firstrun=1` asks for it; `?firstrun=0` never shows
 * it. A player (webdriver false) sees it exactly once. */
export function shouldShowFirstRun(input: {
  record: FirstRunRecord | null;
  automated: boolean;
  search: string;
}) {
  const asked = new URLSearchParams(input.search).get('firstrun');
  if (asked === '0') return false;
  if (asked === '1') return true;
  return !input.record && !input.automated;
}

const ARROWS: Readonly<Record<string, string>> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};
/** A key as a player reads it: arrows as arrows, the rest as the settings screen names them. */
const keyLabel = (code: string) => ARROWS[code] ?? keyName(code);
const DEVICE_LINE: Record<FirstRunDevice, (b: Bindings) => string> = {
  keys: (b) =>
    `${keyLabel(b.throttle)} throttle · ${keyLabel(b.brake)} brake · ${keyLabel(b.left)} / ${keyLabel(b.right)} steer`,
  pad: () => 'Right trigger throttle · left trigger brake · left stick steer',
};
/** The short control reminder shown as a toast when the first lap starts. */
export function firstLapHint(device: FirstRunDevice, bindings: Bindings = DEFAULT_BINDINGS) {
  return `${DEVICE_LINE[device](bindings)} · ${device === 'pad' ? 'START' : 'ESC'} pause. The line on the road marks the braking zones.`;
}

const DEVICES: readonly { id: FirstRunDevice; label: string }[] = [
  { id: 'keys', label: 'KEYBOARD' },
  { id: 'pad', label: 'CONTROLLER' },
];
const esc = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The first-launch screen. `device` and `discipline` are the preselected radios. */
export function firstRunHtml(
  options: { device: FirstRunDevice; discipline?: BoardDiscipline; bindings?: Bindings } = {
    device: 'keys',
  },
) {
  const bindings = options.bindings ?? DEFAULT_BINDINGS;
  const discipline = options.discipline ?? 'circuit';
  return `<section class="fr" data-device="${options.device}"><header><div><span class="eyebrow">FIRST LAUNCH</span><h2>Pick your first lap.</h2></div><button type="button" data-action="firstrun:skip">SKIP TO THE PADDOCK</button></header><p class="fr-lead">A short solo session, dry, on medium tyres, with the braking zones and the racing line painted on the road. It runs the Driving Academy: five timed laps that score how repeatable you are. Everything else is in the paddock.</p><div class="fr-groups"><div class="fr-group"><h3 class="fr-label" id="frDeviceLabel"><b>1</b> INPUT</h3><div class="fr-devices" role="radiogroup" aria-labelledby="frDeviceLabel">${DEVICES.map(
    (d) =>
      `<button type="button" role="radio" class="fr-device" data-device="${d.id}" aria-checked="${d.id === options.device}" tabindex="${d.id === options.device ? 0 : -1}"><b>${d.label}</b><small>${esc(DEVICE_LINE[d.id](bindings))}</small></button>`,
  ).join(
    '',
  )}</div></div><div class="fr-group"><h3 class="fr-label" id="frDisciplineLabel"><b>2</b> DISCIPLINE</h3><div class="fr-plates" role="radiogroup" aria-labelledby="frDisciplineLabel">${BOARD_DISCIPLINES.map(
    (id) => {
      const spec = DISCIPLINE_SPECS[id],
        facts = disciplineFacts(id);
      return `<button type="button" role="radio" class="fr-plate" data-discipline="${id}" aria-checked="${id === discipline}" tabindex="${id === discipline ? 0 : -1}"><span class="fr-plate-art">${plateSvg(spec.shape, spec.numeral, id === 'festival' ? 'SOLVANE' : '')}</span><b>${spec.label}</b><small>${esc(spec.skill)}</small><em>${facts.count} ${facts.noun} · ${facts.machines} MACHINES</em></button>`;
    },
  ).join(
    '',
  )}</div></div></div><div class="fr-go"><button type="button" class="primary" data-action="firstrun:go">DRIVE THE FIRST LAP ${glyph('go', 'enter-glyph')}</button><p class="fr-keys" aria-hidden="true"><span data-for="keys"><kbd>←</kbd><kbd>→</kbd> CHANGE · <kbd>ENTER</kbd> DRIVE · <kbd>ESC</kbd> SKIP</span><span data-for="pad"><kbd>A</kbd> SELECT · <kbd>START</kbd> DRIVE · <kbd>B</kbd> SKIP</span></p></div></section>`;
}

/** What the player has picked on the open screen. */
export function firstRunChoice(root: ParentNode): {
  device: FirstRunDevice;
  discipline: BoardDiscipline;
} {
  const checked = (selector: string) =>
    root.querySelector<HTMLElement>(`${selector}[aria-checked="true"]`);
  const device = checked('.fr-device')?.dataset.device;
  const discipline = checked('.fr-plate')?.dataset.discipline;
  return {
    device: device === 'pad' ? 'pad' : 'keys',
    discipline: (BOARD_DISCIPLINES as readonly string[]).includes(discipline ?? '')
      ? (discipline as BoardDiscipline)
      : 'circuit',
  };
}

/** Roving radios: one tab stop per group; arrows, Home and End move and select, and a
 * focus that lands on a radio selects it, so a controller walking the screen (D-pad
 * moves focus) chooses as it goes. Enter on a radio drives. Returns the disposer. */
export function bindFirstRun(root: HTMLElement): () => void {
  const abort = new AbortController();
  const { signal } = abort;
  const section = root.querySelector<HTMLElement>('.fr');
  if (!section) return () => undefined;
  const select = (radio: HTMLElement, cue = true) => {
    const group = radio.closest('[role="radiogroup"]')!;
    const radios = [...group.querySelectorAll<HTMLElement>('[role="radio"]')];
    let changed = false;
    for (const r of radios) {
      const on = r === radio;
      changed ||= on && r.getAttribute('aria-checked') !== 'true';
      r.setAttribute('aria-checked', String(on));
      r.tabIndex = on ? 0 : -1;
    }
    if (radio.dataset.device) section.dataset.device = radio.dataset.device;
    if (changed && cue) uiCue('select');
  };
  section.addEventListener(
    'click',
    (event) => {
      const radio = (event.target as HTMLElement).closest<HTMLElement>('[role="radio"]');
      if (radio) select(radio);
    },
    { signal },
  );
  section.addEventListener(
    'focusin',
    (event) => {
      const radio = (event.target as HTMLElement).closest<HTMLElement>('[role="radio"]');
      if (radio) select(radio);
    },
    { signal },
  );
  section.addEventListener(
    'keydown',
    (event) => {
      const radio = (event.target as HTMLElement).closest<HTMLElement>('[role="radio"]');
      if (!radio) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        section.querySelector<HTMLElement>('[data-action="firstrun:go"]')?.click();
        return;
      }
      const radios = [
        ...radio.closest('[role="radiogroup"]')!.querySelectorAll<HTMLElement>('[role="radio"]'),
      ];
      const at = radios.indexOf(radio);
      const move: Record<string, number> = {
        ArrowRight: 1,
        ArrowDown: 1,
        ArrowLeft: -1,
        ArrowUp: -1,
      };
      let to = -1;
      if (event.key in move) to = (at + move[event.key] + radios.length) % radios.length;
      else if (event.key === 'Home') to = 0;
      else if (event.key === 'End') to = radios.length - 1;
      if (to < 0) return;
      event.preventDefault();
      event.stopPropagation();
      radios[to].focus();
    },
    { signal },
  );
  // Land on the chosen plate, so Enter or A drives with the default in one input.
  section.querySelector<HTMLElement>('[data-action="firstrun:go"]')?.focus({ preventScroll: true });
  return () => abort.abort();
}
