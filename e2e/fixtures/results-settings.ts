import { Interface } from '../../src/ui/interface.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { DEFAULT_OPTIONS, validateOptions } from '../../src/simulation/config.ts';
import { DEFAULT_SETTINGS } from '../../src/storage/data.ts';
import { F, H, carBase } from '../../src/simulation/protocol.ts';
import { circuitArt } from '../../src/ui/track-art.ts';
import { renderShareCard } from '../../src/ui/results-card.ts';

/** The production Interface for the results and settings screens, no renderer or worker. Actions
 * are logged into #rsEvents; settings applied are kept on `window.rsApplied`. */
export function mountScreens() {
  const root = document.createElement('main');
  root.id = 'app';
  document.body.replaceChildren(root);
  const events = document.createElement('output');
  events.id = 'rsEvents';
  events.hidden = true;
  document.body.append(events);
  const simulation = new Simulation(validateOptions(DEFAULT_OPTIONS));
  const w = window as unknown as Record<string, unknown>;
  const ui: Interface = new Interface(root, simulation.track, {
    action: (name) => {
      events.textContent += `${name};`;
      if (name === 'modalClose') ui.closeModal();
    },
    start: () => {},
    apply: (settings) => {
      w.rsApplied = settings;
    },
    seek: () => {},
    replaySpeed: () => {},
    exportSetup: () => {},
    importSetup: () => {},
  });
  ui.ready();
  ui.showMode('menu');
  w.rsUi = ui;
  w.rsSimulation = simulation;
  return { ui, simulation };
}
export function showResults() {
  const { ui, simulation } = mountScreens();
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
export function showSettings() {
  const { ui } = mountScreens();
  ui.settings(structuredClone(DEFAULT_SETTINGS));
}
/** Draw the share card and describe the PNG: signature, size and a few pixels. */
export async function shareCardProbe() {
  const blob = await renderShareCard({
    session: 'Grand Prix · 3 laps',
    venue: 'Aurel Grand Circuit',
    machine: 'APX-01 Formula',
    weather: 'DRY',
    player: 'Alex River',
    position: 2,
    field: 8,
    finished: true,
    raceTime: '3:01.200',
    bestLap: '0:58.400',
    gaps: ['+2.310 s to the winner'],
    podium: [
      { place: 1, name: 'A. MOREAU', time: '2:58.890' },
      { place: 2, name: 'ALEX RIVER', time: '3:01.200' },
      { place: 3, name: 'K. SATO', time: '3:05.820' },
    ],
    path: circuitArt('aurel').d,
    date: '3 Nov 2026',
  });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  const px = (x: number, y: number) => [...ctx.getImageData(x, y, 1, 1).data];
  // Count the pixels that are not the board's asphalt: a blank card would have almost none.
  const all = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let inked = 0;
  for (let i = 0; i < all.length; i += 4)
    if (all[i] !== 26 || all[i + 1] !== 27 || all[i + 2] !== 30) inked++;
  return {
    type: blob.type,
    size: blob.size,
    signature: [...bytes.slice(0, 8)],
    width: bitmap.width,
    height: bitmap.height,
    strip: px(10, 10),
    board: px(600, 600),
    inkedShare: inked / (canvas.width * canvas.height),
  };
}
