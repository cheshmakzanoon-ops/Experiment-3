import { Interface } from '../../src/ui/interface.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import { DEFAULT_SETTINGS } from '../../src/storage/data.ts';

/** Real interface component; no renderer, storage or completed-race claims. */
export function mountMenuAccess() {
  const root = document.createElement('main');
  root.id = 'app';
  document.body.replaceChildren(root);
  const events = document.createElement('output');
  events.id = 'menuAccessEvents';
  events.hidden = true;
  document.body.append(events);
  const record = (value: string) => {
    events.textContent += `${value};`;
  };
  let settings = structuredClone(DEFAULT_SETTINGS);
  const noop = () => {};
  const ui: Interface = new Interface(root, new Simulation(DEFAULT_OPTIONS).track, {
    action: (name) => {
      record(name);
      if (name === 'settings') ui.settings(settings);
      if (name === 'modalClose') ui.closeModal();
    },
    start: (options) => record(`start:${options.mode}`),
    apply: (next) => {
      settings = next;
      record(`apply:${next.quality}`);
      ui.closeModal();
    },
    seek: noop,
    replaySpeed: noop,
    exportSetup: noop,
    importSetup: noop,
  });
  ui.ready();
}
