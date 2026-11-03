/**
 * Player-facing loading copy. The renderer and session start report detailed
 * engineering progress ("Compiling shadow casters…", "Loading A07 start
 * gantry"); the loading screen translates each message into a short stage
 * title and a progress estimate, so players see "Preparing cars 62%" rather
 * than internal asset names. The raw detail is kept for developer mode only.
 */
export interface LoadingStage {
  /** Short, player-facing title for the current stage. */
  title: string;
  /** Overall progress estimate, 0–1. */
  fraction: number;
}

const ASSET_STAGES: readonly [RegExp, string][] = [
  [/bodywork|car\b|cars\b|driver|cockpit/i, 'Loading cars'],
  [/garage|pit|tyre|tire|wheel|jack|blanket|logistic/i, 'Building the pit lane'],
  [
    /barrier|guardrail|fence|gate|marshal|gantry|signal|board|camera|planting|grandstand/i,
    'Building the circuit',
  ],
];

/** Translate one raw loader message into a stage title and progress estimate. */
export function loadingStage(raw: string, previous = 0): LoadingStage {
  const text = raw.replace(/…$/, '').trim();
  // Boot asset loading: "37% · Loading A07 start gantry". Assets are the first
  // 85 % of the boot bar; the final compile/draw finishes it.
  if (/scene ready/i.test(text))
    return { title: 'Almost ready', fraction: Math.max(previous, 0.9) };
  const percent = /^(\d{1,3})%\s*·\s*(.*)$/.exec(text);
  if (percent) {
    const label = percent[2];
    const title = ASSET_STAGES.find(([pattern]) => pattern.test(label))?.[1] ?? 'Loading circuit';
    return { title, fraction: Math.min(1, Number(percent[1]) / 100) * 0.85 };
  }
  // Session preparation: cars are built one by one, then materials, shadows
  // and the two camera views are warmed before the lights.
  const car = /car (\d+)\s*\/\s*(\d+)/i.exec(text);
  if (car) {
    const n = Number(car[1]),
      total = Math.max(1, Number(car[2]));
    return { title: 'Preparing cars', fraction: 0.1 + 0.3 * Math.min(1, n / total) };
  }
  const stages: readonly [RegExp, string, number][] = [
    // The Solvane festival's own stages (src/session/free-roam.ts). Without these
    // the bar sat at 2 % for the whole festival load ("Building ..." matched the
    // generic circuit rule and nothing else matched at all).
    [/solvane festival region/i, 'Preparing the festival', 0.02],
    [/event routes and town streets/i, 'Planning the roads', 0.08],
    [/roads, buildings and water/i, 'Building Solvane', 0.14],
    [/photographed trees/i, 'Planting the coast', 0.22],
    [/authored coastal details/i, 'Dressing the harbour', 0.3],
    [/festival simulation/i, 'Starting the world', 0.4],
    [/streaming terrain/i, 'Streaming the terrain', 0.55],
    [/photographed sky/i, 'Painting the sky', 0.68],
    [/photographed ground/i, 'Laying the ground', 0.76],
    [/baking festival materials/i, 'Preparing materials', 0.84],
    [/compiling the festival/i, 'Preparing graphics', 0.9],
    [/warming the festival view/i, 'Setting up cameras', 0.95],
    [/^(travelling to|preparing another run at)\b/i, 'Travelling', 0.5],
    [/bodywork, materials and/i, 'Loading circuit', 0],
    [/^building GP motorcycles and riders$/i, 'Preparing motorcycles', 0.42],
    [/^building (.+)$/i, '', 0.02],
    [/grid, race timing|recording buffers/i, 'Preparing session', 0.05],
    [/compiling circuit and vehicle/i, 'Preparing graphics', 0.45],
    [/shadow casters/i, 'Preparing graphics', 0.55],
    [/shadows and scene reflections/i, 'Setting up cameras', 0.62],
    [/pit-service|pit service/i, 'Readying the pit crew', 0.7],
    [/completed chase/i, 'Setting up cameras', 0.8],
    [/cockpit, mirrors/i, 'Setting up the cockpit', 0.86],
    [/completed cockpit/i, 'Warming up tyres', 0.94],
  ];
  for (const [pattern, title, fraction] of stages) {
    const match = pattern.exec(text);
    if (!match) continue;
    // "Building Vellamar Coast Circuit / VELLAMAR" → "Loading Vellamar Coast Circuit".
    if (!title) return { title: `Loading ${match[1].split(' / ')[0]}`, fraction };
    return { title, fraction };
  }
  return { title: 'Loading', fraction: previous };
}

/** Rotating racing tips shown under the loading bar. */
export const LOADING_TIPS: readonly string[] = [
  'Brake in a straight line, then release smoothly as you turn in.',
  'Cold tyres have less grip. Build temperature on your first lap.',
  'Harvest energy on the straights you do not need, deploy where you do.',
  'Press C to change camera. The cockpit view gives the best sense of speed.',
  'In the wet, avoid the painted kerbs and look for grip off the usual racing line.',
  'Press P to request a pit stop and choose your next set of tyres.',
  'A smooth exit is worth more than a late apex.',
];
