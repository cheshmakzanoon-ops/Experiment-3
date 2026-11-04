import { Interface } from '../../src/ui/interface.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import type { FirstRunDevice } from '../../src/ui/first-run.ts';

/** The production Interface and first-launch screen over the paddock board, no renderer or
 * worker. Actions are logged into #frEvents; `window.frUi` exposes the Interface. */
export function mountFirstRun(device: FirstRunDevice = 'keys') {
  const root = document.createElement('main');
  root.id = 'app';
  document.body.replaceChildren(root);
  const events = document.createElement('output');
  events.id = 'frEvents';
  events.hidden = true;
  document.body.append(events);
  const track = new Simulation(DEFAULT_OPTIONS).track;
  const ui: Interface = new Interface(root, track, {
    action: (name) => {
      events.textContent += `${name};`;
      if (name === 'modalClose') ui.closeModal();
    },
    start: () => {},
    apply: () => {},
    seek: () => {},
    replaySpeed: () => {},
    exportSetup: () => {},
    importSetup: () => {},
  });
  ui.ready();
  ui.showMode('menu');
  ui.firstRun(device);
  (window as unknown as { frUi: Interface }).frUi = ui;
}
