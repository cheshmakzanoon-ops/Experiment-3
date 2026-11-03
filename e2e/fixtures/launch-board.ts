import '@fontsource-variable/saira/wdth.css';
import '@fontsource-variable/saira/wdth-italic.css';
import '../../src/ui/style.css';
import { Interface } from '../../src/ui/interface.ts';
import { registerSeries } from '../../src/ui/launch-board.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';

/** The production Interface with no renderer: the paddock board, its form and
 * its controller handler. Start requests are recorded as JSON in #boardEvents
 * (DOM component evidence only, not a gameplay claim). */
export function mountLaunchBoard() {
  const root = document.createElement('main');
  root.id = 'app';
  document.body.replaceChildren(root);
  const events = document.createElement('output');
  events.id = 'boardEvents';
  events.hidden = true;
  const log: unknown[] = [];
  document.body.append(events);
  const noop = () => {};
  const ui: Interface = new Interface(root, new Simulation(DEFAULT_OPTIONS).track, {
    action: (name) => {
      log.push({ action: name });
      events.textContent = JSON.stringify(log);
      if (name === 'modalClose') ui.closeModal();
    },
    start: (options, held) => {
      log.push({ start: options, held: !!held });
      events.textContent = JSON.stringify(log);
    },
    apply: noop,
    seek: noop,
    replaySpeed: noop,
    exportSetup: noop,
    importSetup: noop,
    previewMachine: (machine) => {
      log.push({ preview: machine });
      events.textContent = JSON.stringify(log);
    },
  });
  ui.ready();
  ui.showMode('menu');
}

/** Extension point check: what the Wildcard Series agent will call. */
export function registerFixtureSeries() {
  registerSeries({
    id: 'fixture-wildcard',
    group: 'WILDCARD',
    label: 'ALPINE HYPERCAR',
    title: 'Hypercar on the alpine pass',
    apply: (set) => {
      set('circuit', 'alpine-pass');
      set('vehicle', 'hy9');
      set('mode', 'race');
    },
  });
}

/** A controller the page can press: buttons by index, axes by value. */
export function installFakePad() {
  const pad = {
    connected: true,
    id: 'fixture pad',
    index: 0,
    mapping: 'standard',
    timestamp: 0,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
  };
  Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad] });
  (window as unknown as { fakePad: typeof pad }).fakePad = pad;
}
export function press(index: number, down: boolean) {
  const pad = (window as unknown as { fakePad: { buttons: { pressed: boolean }[] } }).fakePad;
  pad.buttons[index].pressed = down;
}
