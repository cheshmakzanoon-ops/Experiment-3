import frontEndCss from './front-end.css?inline';
import stencilUrl from './fonts/saira-stencil-one-latin-400-normal.woff2?url';
import { glyph, plateSvg, type GlyphName } from './glyphs.ts';
import {
  BOARD_DISCIPLINES,
  DISCIPLINE_SPECS,
  dirtMachineFor,
  disciplineFacts,
  disciplineOf,
  entryDefaults,
  machinesFor,
  venuesFor,
  type BoardDiscipline,
} from './disciplines.ts';
import { circuitArt, circuitArtSvg, regionArtSvg } from './track-art.ts';
import { CIRCUITS, type CircuitId } from '../simulation/circuits.ts';
import { SOLVANE } from '../simulation/open-world/region-data.ts';
import { circuitGroup } from './circuit-menu.ts';
import { uiCue } from './ui-cue.ts';

/** The launch board: the paddock menu's discipline plates, venue sheet and
 * option dials (art direction sections 1-2 and 8). It is a layer over the
 * existing session form, not a replacement: every control is still a native
 * `<select>` with its original id, and every change goes through those selects
 * (value plus a `change` event), so the rules preview, the machine preview, the
 * motocross presenter and the e2e contracts keep working unchanged. */

export const FRONT_END_STYLE_ID = 'mb-front-end';
/** Install the front-end tokens and component styles once per document. They are
 * injected like the other presenters' sheets so DOM fixtures see them too. */
export function installFrontEnd(doc: Document = document) {
  if (doc.getElementById(FRONT_END_STYLE_ID)) return false;
  const style = doc.createElement('style');
  style.id = FRONT_END_STYLE_ID;
  style.textContent = `@font-face{font-family:'Saira Stencil One';font-style:normal;font-weight:400;font-display:swap;src:url(${stencilUrl}) format('woff2')}\n${frontEndCss}`;
  doc.head.append(style);
  return true;
}

/** Radio group of the four disciplines (rendered by the template; behaviour below). */
export function boardPlatesHtml() {
  return `<div id="boardPlates" class="lb-plates" role="radiogroup" aria-label="Discipline">${BOARD_DISCIPLINES.map(
    (id) => {
      const spec = DISCIPLINE_SPECS[id],
        facts = disciplineFacts(id);
      return `<button type="button" class="lb-plate" role="radio" data-discipline="${id}" aria-checked="false" tabindex="-1" aria-label="${spec.label}, ${facts.count} ${facts.noun.toLowerCase()}"><span class="lb-plate-art">${plateSvg(spec.shape, spec.numeral, id === 'festival' ? 'SOLVANE' : '')}</span><b>${spec.label}</b><small>${facts.count} ${facts.noun}</small></button>`;
    },
  ).join('')}</div>`;
}

/** One option row: a label, the native select, and a hand each way. The hands
 * are pointer and touch conveniences (hidden from assistive technology, out
 * of the Tab order); keyboard and controller use the select itself. */
export function dialHtml(
  id: string,
  label: string,
  icon: GlyphName | null,
  select: string,
  className = '',
) {
  return `<div class="lb-dial${className ? ` ${className}` : ''}" data-dial="${id}"><label><span class="lb-dial-face"><span class="lb-dial-label">${icon ? glyph(icon, 'lb-dial-glyph') : ''}<span class="lb-dial-name">${label}</span><span class="lb-dial-count" aria-hidden="true"></span></span>${select}${glyph('caret', 'lb-dial-caret')}</span></label><button type="button" class="lb-step" data-step="-1" tabindex="-1" aria-hidden="true">${glyph('chevLeft')}</button><button type="button" class="lb-step" data-step="1" tabindex="-1" aria-hidden="true">${glyph('chevRight')}</button></div>`;
}

/** A curated one-click setup that appears in the SERIES strip (art direction
 * section 9). `apply` writes form values through `set`, which assigns the
 * select and dispatches `change`, exactly like a hand edit. */
export interface SeriesEntry {
  id: string;
  /** Chip text (short, caps). */
  label: string;
  /** Strip group heading, e.g. 'WILDCARD'. Entries with the same group share a row. */
  group?: string;
  /** Longer accessible name and tooltip. */
  title?: string;
  apply: (set: (id: string, value: string) => void) => void;
}
const seriesRegistry: SeriesEntry[] = [];
const boards = new Set<LaunchBoard>();
/** Add a series chip to every launch board (idempotent per id). The strip is
 * hidden while it has no chips. */
export function registerSeries(entry: SeriesEntry) {
  if (seriesRegistry.some((e) => e.id === entry.id)) return;
  seriesRegistry.push(entry);
  for (const board of boards) board.renderSeries();
}
export const registeredSeries = () => seriesRegistry.slice();

const FIELD_IDS = [
  'mode',
  'circuit',
  'vehicle',
  'laps',
  'weather',
  'opponents',
  'compound',
  'assist',
  'startSlot',
] as const;
const GROUP_LABEL: Readonly<Record<string, string>> = Object.freeze({
  original: 'ORIGINAL',
  'real-world': 'REAL-WORLD APPROXIMATION',
  unconventional: 'UNCONVENTIONAL',
  'off-road': 'OFF-ROAD',
});
const WEATHER_GLYPH: Readonly<Record<string, GlyphName>> = Object.freeze({
  clear: 'sun',
  changeable: 'mixed',
  rain: 'rain',
});
const REGION_BLURB =
  'Harbour to massif on open roads. Drive to an event marker or travel from the world map.';

export interface LaunchBoard {
  /** Re-read the form and repaint the board (idempotent, cheap). */
  sync(): void;
  /** Switch discipline: restores that discipline's last entry, else its defaults. */
  setDiscipline(discipline: BoardDiscipline): void;
  renderSeries(): void;
  dispose(): void;
}

export function installLaunchBoard(menu: HTMLElement): LaunchBoard {
  installFrontEnd(menu.ownerDocument);
  const sel = (id: string) => menu.querySelector<HTMLSelectElement>(`#${id}`)!;
  const form = menu.querySelector<HTMLFormElement>('#sessionForm')!;
  const plates = [...menu.querySelectorAll<HTMLButtonElement>('.lb-plate')];
  const group = menu.querySelector<HTMLElement>('#boardPlates')!;
  const strip = menu.querySelector<HTMLElement>('#boardSeries')!;
  const map = menu.querySelector<HTMLElement>('#venueMap')!;
  const kicker = menu.querySelector<HTMLElement>('#circuitEyebrow')!;
  const blurb = menu.querySelector<HTMLElement>('#circuitBlurb')!;
  const motto = menu.querySelector<HTMLElement>('h1')!;
  const regionTitle = menu.querySelector<HTMLElement>('#regionTitle')!;
  const circuitStats = menu.querySelector<HTMLElement>('#circuitStats')!;
  const lengthStat = menu.querySelector<HTMLElement>('#circuitLength')!;
  const regionStats = menu.querySelector<HTMLElement>('#regionStats')!;
  const enter = form.querySelector<HTMLButtonElement>('.enter.primary')!;
  const enterLabel = [...enter.childNodes].find((n) => n.nodeType === Node.TEXT_NODE)!;
  const rules = menu.querySelector<HTMLElement>('#sessionRules')!;
  const dials = new Map<string, HTMLElement>(
    [...menu.querySelectorAll<HTMLElement>('.lb-dial')].map((d) => [d.dataset.dial!, d]),
  );
  const memory = new Map<BoardDiscipline, Record<string, string>>();
  const abort = new AbortController();
  const on = (target: EventTarget, type: string, handler: (event: Event) => void) =>
    target.addEventListener(type, handler, { signal: abort.signal });

  const fields = () => ({
    mode: sel('mode').value,
    circuit: sel('circuit').value,
    vehicle: sel('vehicle').value,
  });
  const snapshot = () => Object.fromEntries(FIELD_IDS.map((id) => [id, sel(id).value]));
  /** Assign a select and announce it like a hand edit (the form's own rules run). */
  const set = (id: string, value: string) => {
    const select = sel(id);
    if (select.value === value) return;
    select.value = value;
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };
  let current: BoardDiscipline = 'circuit';
  /** True while a discipline or series writes several fields: the half-written
   * states in between must not be remembered as anyone's entry. */
  let applying = false;

  /** Values a step may land on: the discipline's own venues and machines. */
  const allowed = (id: string, value: string) => {
    const d = disciplineOf(fields());
    if (id === 'circuit') return venuesFor(d).length === 0 || venuesFor(d).includes(value as CircuitId);
    if (id === 'vehicle') return machinesFor(d, sel('circuit').value).includes(value);
    if (id === 'mode') return value !== 'festival' || d === 'festival';
    return true;
  };
  const optionsOf = (id: string) =>
    [...sel(id).options].filter((o) => !o.disabled && o.value && allowed(id, o.value));
  const indexIn = (id: string) => optionsOf(id).findIndex((o) => o.value === sel(id).value);

  /** A dirt venue that cannot take the current machine (a motocross bike at a
   * rallycross venue) gets the venue's first machine, as the SERIES chips do. */
  const repairMachine = () => {
    const d = disciplineOf(fields());
    if (d !== 'dirt') return;
    const list = machinesFor('dirt', sel('circuit').value);
    const machine = dirtMachineFor(sel('circuit').value);
    if (machine && !list.includes(sel('vehicle').value)) set('vehicle', machine);
  };
  const flip = (dial: HTMLElement | undefined, direction: 1 | -1) => {
    if (!dial) return;
    dial.dataset.flip = direction > 0 ? 'next' : 'prev';
    window.setTimeout(() => {
      if (dial.dataset.flip) delete dial.dataset.flip;
    }, 160);
  };
  const step = (id: string, direction: 1 | -1) => {
    const select = sel(id);
    if (select.disabled) return;
    const options = optionsOf(id);
    if (!options.length) return;
    const at = options.findIndex((o) => o.value === select.value);
    const next =
      at < 0
        ? direction > 0
          ? 0
          : options.length - 1
        : (at + direction + options.length) % options.length;
    set(id, options[next].value);
    if (id === 'circuit') repairMachine();
    flip(dials.get(id), direction);
    uiCue('tick');
  };
  on(menu, 'click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.lb-step');
    if (!button || !menu.contains(button)) return;
    const id = button.closest<HTMLElement>('.lb-dial')?.dataset.dial;
    if (id) step(id, Number(button.dataset.step) > 0 ? 1 : -1);
  });
  // A keyboard or native-list change flips the dial in the direction of travel.
  const lastIndex = new Map<string, number>();
  for (const id of FIELD_IDS)
    on(sel(id), 'change', () => {
      const now = [...sel(id).options].findIndex((o) => o.value === sel(id).value),
        before = lastIndex.get(id);
      lastIndex.set(id, now);
      if (before !== undefined && before !== now && !dials.get(id)?.dataset.flip)
        flip(dials.get(id), now > before ? 1 : -1);
    });
  // Enter on a dial confirms the entry (a closed select ignores Enter natively).
  on(form, 'keydown', (event) => {
    const e = event as KeyboardEvent;
    if (e.key !== 'Enter' || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    if (!(e.target instanceof HTMLSelectElement) || enter.disabled) return;
    e.preventDefault();
    form.requestSubmit(enter);
  });
  on(form, 'submit', () => {
    const refused = /^(Cannot start|Unavailable)/.test(rules.textContent ?? '');
    rules.dataset.state = refused ? 'error' : '';
    uiCue(refused ? 'deny' : 'confirm');
  });

  // ---- Discipline plates -------------------------------------------------
  function setDiscipline(next: BoardDiscipline) {
    if (next === current && disciplineOf(fields()) === next) return;
    memory.set(current, snapshot());
    const saved = memory.get(next);
    applying = true;
    if (saved) {
      // Order matters: the mode handler adjusts laps and the grid, the weather
      // handler picks wet tyres, and a venue change resets the machine preview.
      for (const id of FIELD_IDS) set(id, saved[id]);
    } else if (next === 'dirt') {
      menu.querySelector<HTMLButtonElement>('[data-mx-venue="valley-ridge-mx"]')?.click();
    } else {
      const wanted = entryDefaults(next, snapshot());
      for (const id of ['mode', 'circuit', 'vehicle'] as const)
        if (wanted[id] !== undefined) set(id, wanted[id]);
    }
    applying = false;
    current = next;
    uiCue('select');
    sync();
  }
  on(group, 'click', (event) => {
    const plate = (event.target as HTMLElement).closest<HTMLButtonElement>('.lb-plate');
    if (plate) setDiscipline(plate.dataset.discipline as BoardDiscipline);
  });
  on(group, 'keydown', (event) => {
    const e = event as KeyboardEvent;
    const keys: Record<string, number> = {
      ArrowRight: 1,
      ArrowDown: 1,
      ArrowLeft: -1,
      ArrowUp: -1,
    };
    let to = -1;
    const at = plates.findIndex((p) => p === document.activeElement);
    if (e.key in keys) to = (at + keys[e.key] + plates.length) % plates.length;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = plates.length - 1;
    if (to < 0) return;
    e.preventDefault();
    e.stopPropagation();
    plates[to].focus();
    setDiscipline(plates[to].dataset.discipline as BoardDiscipline);
  });

  // ---- Series strip ------------------------------------------------------
  const dirtShortcuts = menu.querySelector<HTMLElement>('.mx-entry');
  if (dirtShortcuts) strip.append(dirtShortcuts);
  const extra = document.createElement('div');
  extra.className = 'lb-series-extra';
  strip.append(extra);
  function renderSeries() {
    const groups = new Map<string, SeriesEntry[]>();
    for (const entry of seriesRegistry)
      groups.set(entry.group ?? 'SERIES', [...(groups.get(entry.group ?? 'SERIES') ?? []), entry]);
    extra.replaceChildren(
      ...[...groups].map(([name, entries]) => {
        const nav = document.createElement('nav');
        nav.className = 'lb-series-group';
        nav.setAttribute('aria-label', name);
        const title = document.createElement('span');
        title.textContent = name;
        nav.append(title);
        for (const entry of entries) {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.textContent = entry.label;
          chip.dataset.series = entry.id;
          if (entry.title) chip.title = entry.title;
          chip.addEventListener('click', () => {
            applying = true;
            entry.apply(set);
            repairMachine();
            applying = false;
            uiCue('select');
            sync();
          });
          nav.append(chip);
        }
        return nav;
      }),
    );
    strip.hidden = !dirtShortcuts && seriesRegistry.length === 0;
  }

  // ---- Repaint -----------------------------------------------------------
  let mapKey = '';
  const text = (node: Element, value: string) => {
    if (node.textContent !== value) node.textContent = value;
  };
  function sync() {
    const f = fields(),
      d = disciplineOf(f),
      spec = DISCIPLINE_SPECS[d];
    current = d;
    if (!applying) memory.set(d, snapshot());
    menu.dataset.board = d;
    for (const plate of plates) {
      const checked = plate.dataset.discipline === d;
      plate.setAttribute('aria-checked', String(checked));
      plate.tabIndex = checked ? 0 : -1;
    }
    // The headline is the discipline's pit-board message. The motocross
    // presenter owns it at its own venues (MX and SX have their own lines).
    if (menu.dataset.discipline !== 'motocross' && menu.dataset.discipline !== 'supercross')
      text(motto, spec.motto);
    const festival = d === 'festival';
    // Stage 1: the venue sheet.
    const circuitDial = dials.get('circuit')!;
    circuitDial.hidden = festival;
    regionTitle.hidden = !festival;
    circuitStats.hidden = festival;
    regionStats.hidden = !festival;
    text(circuitDial.querySelector('.lb-dial-name')!, spec.venueNoun);
    const key = festival ? 'region' : f.circuit;
    if (key !== mapKey) {
      mapKey = key;
      map.innerHTML = festival
        ? regionArtSvg(SOLVANE)
        : circuitArtSvg(f.circuit as CircuitId, { numbers: true });
      map.dataset.kind = festival ? 'region' : (CIRCUITS[f.circuit as CircuitId]?.offroad ? 'dirt' : 'circuit');
    }
    if (festival) {
      text(kicker, 'OPEN WORLD');
      text(blurb, REGION_BLURB);
      regionStats.innerHTML = `<span><b>${SOLVANE.events.length}</b> EVENTS</span><span><b>${SOLVANE.roads.length}</b> ROADS</span><span><b>${SOLVANE.towns.length}</b> TOWNS</span>`;
    } else {
      const def = CIRCUITS[f.circuit as CircuitId];
      if (def) {
        text(kicker, GROUP_LABEL[circuitGroup(def.id)] ?? '');
        // The lap length of the circuit on the sheet, not of whichever track is
        // loaded: the sampled centreline is the same curve `Track` measures.
        text(lengthStat, (circuitArt(def).length / 1000).toFixed(3));
      }
    }
    // Counters: "07 / 42" beside each stepped dial.
    for (const id of ['circuit', 'vehicle']) {
      const list = optionsOf(id),
        at = indexIn(id);
      const node = dials.get(id)?.querySelector('.lb-dial-count');
      if (node)
        text(node, list.length > 1 && at >= 0 ? `${String(at + 1).padStart(2, '0')} / ${list.length}` : '');
    }
    // Weather glyph and tyre tint follow the value.
    const weather = dials.get('weather')?.querySelector('.lb-dial-glyph');
    const glyphName = WEATHER_GLYPH[sel('weather').value] ?? 'sun';
    if (weather && weather.getAttribute('data-glyph') !== glyphName) {
      weather.outerHTML = glyph(glyphName, 'lb-dial-glyph').replace('<svg ', `<svg data-glyph="${glyphName}" `);
    }
    const compound = dials.get('compound')?.querySelector<HTMLElement>('.lb-dial-face');
    if (compound) compound.dataset.value = sel('compound').value;
    // Dials that do not apply to this entry dim; they stay reachable.
    const timed = f.mode === 'time-trial';
    const na: Record<string, boolean> = {
      laps: festival || timed,
      opponents: festival || timed,
      startSlot: festival || f.mode !== 'race',
      compound: festival,
    };
    for (const [id, dial] of dials) {
      dial.toggleAttribute('data-na', !!na[id]);
      for (const hand of dial.querySelectorAll<HTMLButtonElement>('.lb-step'))
        hand.disabled = sel(id).disabled;
    }
    rules.dataset.state = /^(Cannot start|Unavailable)/.test(rules.textContent ?? '') ? 'error' : '';
    // The primary action names what it does.
    const label = festival ? 'ENTER FESTIVAL ' : 'ENTER CIRCUIT ';
    if (enterLabel.textContent !== label) enterLabel.textContent = label;
    for (const chip of strip.querySelectorAll<HTMLButtonElement>('[data-mx-venue]'))
      chip.setAttribute('aria-pressed', String(chip.dataset.mxVenue === f.circuit));
  }

  const board: LaunchBoard = {
    sync,
    setDiscipline,
    renderSeries,
    dispose() {
      abort.abort();
      boards.delete(board);
    },
  };
  boards.add(board);
  for (const id of FIELD_IDS) {
    lastIndex.set(id, [...sel(id).options].findIndex((o) => o.value === sel(id).value));
    on(sel(id), 'change', sync);
  }
  renderSeries();
  sync();
  return board;
}
