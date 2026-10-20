/** Real FestivalHud/CircuitPace with synthetic motion and status. No renderer,
 * worker, completed physical drive, saved progression, or frame-rate claim. */
import '@fontsource-variable/saira';
import {
  CircuitPace,
  type CircuitPaceReason,
  type CircuitPaceRecord,
} from '../../src/simulation/open-world/circuit-pace.ts';
import { OpenWorldSimulation, festivalVehicles } from '../../src/simulation/open-world/session.ts';
import type { FestivalResult } from '../../src/simulation/open-world/festival-result.ts';
import { FestivalHud } from '../../src/ui/festival-hud.ts';

const sim = new OpenWorldSimulation({ vehicle: 'rh3', traffic: false });
sim.command({ type: 'start', event: 'saltmarsh-practice' });
const event = sim.events.find((entry) => entry.spec.id === 'saltmarsh-practice')!;
const actions: string[] = [];
const hud = new FestivalHud(
  document.querySelector<HTMLElement>('#app')!,
  sim.world,
  sim.events,
  festivalVehicles(),
  {
    start: (id) => actions.push(`start:${id}`),
    continue: () => actions.push('continue'),
    retry: (id) => actions.push(`retry:${id}`),
    cancel: () => actions.push('cancel'),
    reset: () => actions.push('reset'),
    resume: () => actions.push('resume'),
    exit: () => actions.push('exit'),
    lighting: (mode) => actions.push(`lighting:${mode}`),
    vehicle: (id) => actions.push(`vehicle:${id}`),
    travel: (id) => actions.push(`travel:${id}`),
    autopilot: (on) => actions.push(`autopilot:${on}`),
    traffic: (on) => actions.push(`traffic:${on}`),
    map: () => actions.push('map'),
    photo: (open) => actions.push(`photo:${open}`),
  },
);
function timedPace(
  duration: number,
  portion = 1,
  reference: CircuitPaceRecord | null = null,
  reason: CircuitPaceReason | null = null,
) {
  const pace = new CircuitPace(event.distance, reference);
  if (reason) pace.invalidate(reason);
  for (let i = 1; i <= Math.round(portion * 100); i++)
    pace.sample((event.distance * i) / 100, (duration * i) / 100);
  return pace;
}
const benchmark = timedPace(100);
benchmark.finish(true, 100);
const reference = benchmark.record()!;
let sequence = 0;
let lastPace: CircuitPace | null = null;
function inspect() {
  const node = (selector: string) => document.querySelector<HTMLElement>(selector)!;
  const box = (selector: string) => {
    const element = node(selector),
      r = element.getBoundingClientRect();
    return {
      x: r.x,
      y: r.y,
      right: r.right,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    };
  };
  const visible = (selector: string) =>
    node(selector).getClientRects().length > 0 &&
    getComputedStyle(node(selector)).visibility !== 'hidden';
  return {
    practiceVisible: visible('#festPractice'),
    liveVisible: visible('#festPracticeLive'),
    liveText: node('#festPracticeLiveValue').textContent,
    liveTrend: node('#festPracticeLive').dataset.trend,
    liveAria: node('#festPracticeLive').getAttribute('aria-label'),
    liveRole: node('#festPracticeLive').getAttribute('role'),
    liveAriaLive: node('#festPracticeLive').getAttribute('aria-live'),
    live: box('#festPracticeLive'),
    liveDelta: lastPace?.status().liveDelta ?? null,
    resultVisible: visible('#festResults'),
    practice: box('#festPractice'),
    event: box('#festEvent'),
    result: box('#festResults'),
    speed: box('.fest-speed'),
    minimap: box('.fest-minimap'),
    practiceText: node('#festPractice').textContent,
    resultText: node('#festResults').textContent,
    eventRow: node('#festEventRow').textContent,
    splitCount: node('#festPracticeSplits').children.length,
    resultRows: node('#festResults').querySelectorAll('tbody tr').length,
    state: node('#festPractice').dataset.state,
    activeLabel: document.activeElement?.getAttribute('data-fest'),
    pageWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    acceptedRecord: lastPace?.record() ?? null,
    actions: [...actions],
  };
}
function draw(mode = 'running') {
  hud.showPhoto(false);
  hud.showMap(false);
  hud.showMenu(false);
  const status = structuredClone(sim.status());
  const finished = mode.startsWith('completed');
  const reason: CircuitPaceReason | null = mode.includes('autopilot')
    ? 'autopilot'
    : mode.includes('offroad')
      ? 'off-road'
      : null;
  const duration = mode === 'behind' ? 104 : mode === 'even' ? 100 : 96;
  const comparison =
    mode === 'first-run'
      ? null
      : mode === 'legacy-reference'
        ? { time: reference.time, crossings: reference.crossings }
        : reference;
  const pace = timedPace(duration, finished ? 1 : 0.78, comparison, reason);
  lastPace = pace;
  const elapsed = duration * (finished ? 1 : 0.78);
  status.mode = finished ? 'finished' : 'running';
  status.time = elapsed;
  status.speedKmh = 112;
  status.autopilot = reason === 'autopilot';
  status.event = {
    ...status.event!,
    countdown: 0,
    elapsed,
    progress: finished ? 1 : 0.78,
    practice: pace.status(elapsed),
  };
  if (finished) {
    const practice = pace.finish(true, elapsed);
    status.event.practice = practice;
    status.result = {
      kind: 'festival-result',
      version: 2,
      runId: `synthetic-practice-hud:${++sequence}`,
      regionId: sim.world.region.id,
      eventId: event.spec.id,
      eventName: event.spec.name,
      eventKind: 'circuit',
      vehicleId: 'rh3',
      completed: true,
      abandoned: false,
      position: 1,
      entrants: 1,
      time: elapsed,
      trapKmh: null,
      averageKmh: null,
      driftScore: null,
      driftLines: [],
      stars: 3,
      legalDistance: event.distance,
      offRouteSeconds: reason === 'off-road' ? 1 : 0,
      standings: [{ car: 0, name: 'YOU', vehicleId: 'rh3', time: elapsed, progress: 1 }],
      at: elapsed,
      assisted: reason === 'autopilot',
      practice,
    } satisfies FestivalResult;
  }
  hud.update(status, sim.player.body.position.x, sim.player.body.position.z, 0, 3, 0.6);
  return inspect();
}
function overlay(mode: string) {
  if (mode === 'menu')
    hud.showMenu(true, {
      lighting: 'day',
      vehicle: 'rh3',
      discovered: [event.spec.id],
      autopilot: false,
      inEvent: true,
      traffic: false,
    });
  else if (mode === 'map') hud.showMap(true);
  else if (mode === 'photo') hud.showPhoto(true);
  return inspect(); // No update: paused-worker modal suppression must be immediate.
}
Object.assign(window, {
  practiceHudReview: { draw, inspect, overlay, dispose: () => hud.dispose(), ready: true },
});
draw();
