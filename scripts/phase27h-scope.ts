/** Curated source/test ownership. These are inspectable counterparts, NOT
 * declarations that a complete requirement is satisfied. Every numbered section
 * is independently bound to its verbatim clauses by phase27h-matrix.ts. */
export interface SectionOwner {
  source: string[];
  tests: string[];
  render: string[];
}
const s = (names: string) => names.split(' ').map((name) => `src/simulation/${name}.ts`);
const r = (names: string) => names.split(' ').map((name) => `src/rendering/${name}.ts`);
const t = (names: string) => names.split(' ').map((name) => `tests/${name}.test.ts`);
const e = (names: string) => (names ? names.split(' ').map((name) => `e2e/${name}.spec.ts`) : []);
const owners = new Map<number, SectionOwner>();
function own(ids: string, source: string[], tests: string[], render: string[] = []) {
  for (const token of ids.split(',')) {
    const [first, last = first] = token.split('-').map(Number);
    for (let id = first; id <= last; id++) {
      if (owners.has(id)) throw new Error(`Repeated section ${id}`);
      owners.set(id, { source, tests, render });
    }
  }
}
own('1', s('world vehicle'), t('directive physics safety'), e('15-review-journey'));
own(
  '2',
  ['docs/MASTER_DIRECTIVE.md', 'docs/IMPLEMENTATION_MATRIX.md'],
  t('directive acceptance-matrix'),
);
own('3', ['package.json', 'vite.config.ts'], t('directive startup'), e('01-worker-portability'));
own('4', ['src/main.ts', 'src/workers/physics.worker.ts'], t('directive'));
own(
  '5',
  ['src/main.ts', 'src/workers/physics.worker.ts', ...s('world')],
  t('core physics'),
  e('application'),
);
own('6-9', s('rigid vehicle'), t('rotation road-contact physics'));
own('10-11', s('road-contact contact vehicle bvh'), t('road-contact contact tire-carcass'));
own('12-17', s('tire vehicle'), t('physics road-contact'));
own('18-21', s('tire vehicle config'), t('physics'), e('02-wheel-fidelity'));
own('22', s('contamination vehicle track'), t('marbles physics'), e('00-marbles'));
own('23-25', s('vehicle config'), t('brake-coupling physics'), e('03-skid-contact'));
own('26-28', s('vehicle clutch config'), t('clutch physics'));
own('29', s('vehicle config'), t('brake-coupling physics'));
own(
  '30-34',
  s('aero aero-map vehicle'),
  t('aero-surface physics skid-contact'),
  e('10-aero-surface'),
);
own('35-36', s('track bvh'), t('core contact road-contact'), e('06-circuit-survey'));
own('37-39', s('track protocol contamination'), t('marbles recording'), e('00-marbles'));
own(
  '40-42',
  s('surface-drainage weather track tire'),
  t('weather wet-presentation wet-broadcast-fidelity'),
  e('00-wet-presentation weather'),
);
own('43-48', s('ai driver-brain traffic'), t('driver-brain traffic physics race-control'));
own('49-50', s('driver-brain ai config'), t('driver-brain physics'));
own('51-53', s('collision obb damage vehicle'), t('contact physics safety'), e('03-skid-contact'));
own('54-55', r('renderer materials'), t('rendering presentation'), e('04-reference-visual'));
own(
  '56',
  r('materials surface-detail'),
  t('cockpit-detail phase27f-models'),
  e('05-cockpit-detail'),
);
own(
  '57-58',
  r('reflections circuit renderer'),
  t('reflections wet-presentation'),
  e('00-wet-presentation 13-wet-lighting-closure'),
);
own(
  '59-61',
  r('daylight local-atmosphere renderer venue-lighting'),
  t('phase27g-completion phase27g-presentation'),
  e('19-phase27g-completion 18-phase27g'),
);
own('62', r('motion-blur'), t('motion-blur'), e('motion'));
own(
  '63-66',
  r('renderer camera-dynamics trackside race-composition'),
  t('camera trackside phase27g-completion'),
  e('camera-continuity 12-presentation-continuity'),
);
own(
  '67-70',
  r('effects spray-clouds rain-streaks'),
  t('skid-contact wet-presentation spray-lighting'),
  e('00-wet-presentation 03-skid-contact'),
);
own(
  '71-75',
  [
    'src/audio/engine.ts',
    'src/audio/engine-voices.ts',
    'src/audio/spatial.ts',
    'src/audio/surface-audio.ts',
  ],
  t('audio spatial-audio'),
  e('audio spatial-audio'),
);
own(
  '76-79',
  [
    'src/input/pump.ts',
    'src/input/controller.ts',
    'src/input/calibration.ts',
    'src/input/bindings.ts',
  ],
  t('input controller-buttons calibration bindings'),
  e('calibration'),
);
own(
  '80-81',
  [
    'src/storage/telemetry-schema.ts',
    'src/storage/telemetry-sampler.ts',
    'src/storage/telemetry-export.ts',
    'src/storage/telemetry-plots.ts',
  ],
  t('telemetry-export telemetry-plots recording'),
  e('instruments'),
);
own(
  '82',
  ['src/storage/replay-pages.ts', 'src/storage/recorders.ts', ...r('frame-state')],
  t('recording skid-recording'),
  e('replay-state'),
);
own('83-86', s('race marshal track'), t('race-control marshal'), e('application'));
own(
  '87-88',
  s('race pit-safety vehicle'),
  t('pit-approach pit-release pit-presentation'),
  e('pit-presentation'),
);
own('89', s('config vehicle aero'), t('physics aero-surface calibration'), e('07-reference-tools'));
own(
  '90-91',
  ['src/ui/interface.ts', ...r('steering-display cockpit')],
  t('instruments steering-display cockpit-detail'),
  e('instruments 05-cockpit-detail'),
);
own('92', r('options renderer'), t('presentation phase27g-completion'), e('presentation'));
own(
  '93-94',
  ['src/core/performance.ts', ...r('gpu-timer renderer')],
  t('performance gpu-timer'),
  e('performance'),
);
own(
  '95',
  r('lod crowd crowd-impostor'),
  t('wheel-pose phase27g-seams presentation-continuity'),
  e('19-phase27g-completion 11-phase27c'),
);
own(
  '96',
  r('geometry grandstand pit-crew'),
  t('rendering phase27g-models phase27g-venue'),
  e('06-circuit-survey'),
);
own('97', r('texture-budget materials'), t('presentation'), e('07-reference-tools'));
own(
  '98',
  r('build-queue hero-shells renderer'),
  t('build-queue startup hero-shells'),
  e('construction 20-phase27h'),
);
own(
  '99-100',
  ['src/workers/physics.worker.ts', ...s('protocol world ai')],
  t('physics recording safety'),
  e('01-worker-portability'),
);
own(
  '101-102',
  ['src/ui/interface.ts', ...r('engineering-view renderer')],
  t('engineering instruments'),
  e('instruments'),
);
own('103-104', s('world vehicle tire'), t('physics safety core'));
own('105-106', s('world rigid'), t('physics rotation'));
own('107-110', s('vehicle aero tire'), t('physics brake-coupling'));
own('111', s('road-contact track vehicle'), t('road-contact physics'), e('02-wheel-fidelity'));
own('112', s('weather track tire'), t('weather wet-presentation'), e('00-wet-presentation'));
own('113', s('damage collision vehicle'), t('physics contact'));
own('114', s('aero vehicle'), t('physics aero-surface'));
own('115', s('ai traffic driver-brain'), t('traffic driver-brain physics'));
own('116', s('race world'), t('race-control marshal physics'), e('application'));
own(
  '117',
  ['playwright.config.ts', '.github/workflows/ci.yml'],
  t('startup'),
  e('application 20-phase27h'),
);
own(
  '118',
  ['src/core/performance.ts', '.github/workflows/ci.yml'],
  t('performance gpu-timer'),
  e('performance'),
);
own('119-120', s('world rigid vehicle'), t('safety core physics'), e('01-worker-portability'));
own('121', s('config tire aero vehicle'), t('physics aero-surface brake-coupling'));
own(
  '122-123',
  r('car hero-shells car-surfaces car-architecture car-floor manufacturing menu-preview'),
  t('hero-shells phase27g-models phase27f-models menu-preview'),
  e('20-phase27h 10-aero-surface'),
);
own(
  '124',
  r('cockpit car driver-anatomy driver-tailoring'),
  t('cockpit-detail phase27g-seams'),
  e('05-cockpit-detail 20-phase27h'),
);
own(
  '125',
  r('driver driver-anatomy elbow-sleeve wheel-grip'),
  t('driver elbow-sleeve phase27g-models'),
  e('05-cockpit-detail 20-phase27h'),
);
own(
  '126-127',
  r('wheel-pose tire-carcass tire-profile car'),
  t('wheel-pose tire-carcass wheel-alignment'),
  e('02-wheel-fidelity'),
);
own(
  '128-129',
  r(
    'circuit circuit-barriers track-infrastructure venue-districts venue-architecture venue-materials venue-plaza venue-landmark venue-service landscape grandstand',
  ),
  t('phase27g-venue circuit-detail paddock-detail aurel-environment venue-landmark'),
  e('06-circuit-survey 18-phase27g 26-aurel-environment'),
);
own(
  '130',
  s('track bvh surface-drainage'),
  t('road-contact circuit-detail'),
  e('06-circuit-survey'),
);
own(
  '131-132',
  ['src/ui/interface.ts', 'src/ui/style.css', 'src/main.ts', ...r('menu-preview')],
  t('presentation startup menu-preview'),
  e('construction presentation'),
);
own(
  '133',
  ['src/ui/presentation.ts', 'src/ui/audio-accessibility.ts', 'src/audio/driving-cues.ts'],
  t('reference-depth presentation'),
  e('09-reference-depth'),
);
own(
  '134-135',
  ['src/audio/engine.ts', ...r('effects renderer'), ...s('protocol')],
  t('spatial-audio wet-presentation skid-recording'),
  e('spatial-audio 03-skid-contact'),
);
own(
  '136',
  ['src/workers/physics.worker.ts', 'src/main.ts', ...s('protocol')],
  t('recording safety'),
  e('01-worker-portability'),
);
own('137-138', s('config aero-map'), t('calibration physics'));
own(
  '139',
  ['src/storage/data.ts', 'src/storage/replay-pages.ts', 'src/storage/team-career.ts'],
  t('team-career recording'),
  e('07-reference-tools'),
);
own(
  '140-143',
  ['docs/MASTER_DIRECTIVE.md', 'docs/IMPLEMENTATION_MATRIX.md', 'scripts/phase27h-matrix.ts'],
  t('directive acceptance-matrix'),
  e('15-review-journey 20-phase27h'),
);
own('144-145', ['eslint.config.js', 'tsconfig.json', 'package.json'], t('directive'));
own(
  '146',
  ['src/core/session-review.ts', 'src/ui/tab-evidence.ts', ...s('world'), ...r('renderer')],
  t('session-review tab-evidence acceptance-matrix'),
  e('15-review-journey 17-session-review'),
);
own(
  '147-148',
  ['docs/MASTER_DIRECTIVE.md', ...s('world'), ...r('renderer')],
  t('physics acceptance-matrix'),
  e('15-review-journey 20-phase27h'),
);
// 27H.6 counterpart/coverage links, not acceptance receipts. Extend only the
// independently applicable rows; never mutate arrays shared by range owners.
function extend(ids: number[], source: string[], tests: string[], render: string[]) {
  for (const id of ids) {
    const prior = owners.get(id);
    if (!prior) throw new Error(`Missing section ${id}`);
    owners.set(id, {
      source: [...new Set([...prior.source, ...source])],
      tests: [...new Set([...prior.tests, ...tests])],
      render: [...new Set([...prior.render, ...render])],
    });
  }
}
extend(
  [66],
  r('race-structures broadcast-sightlines'),
  t('race-structures'),
  e('29-populated-race-review'),
);
extend(
  [67, 68, 84, 87, 88, 93, 94],
  r('race-review presentation-review'),
  t('race-review'),
  e('29-populated-race-review'),
);
extend([90], ['src/ui/interface.ts', 'src/ui/style.css'], [], e('28-race-hud-layout'));
extend([54, 56, 57, 58, 122], r('materials'), t('phase27h6'), e('28-race-pit-presentation'));
extend(
  [63, 64, 65, 66, 87, 88, 96],
  r('pit-presentation pit-crew pit-machinery race-composition'),
  t('phase27h6'),
  e('28-race-pit-presentation'),
);
extend([93, 94, 118, 146], [], [], e('28-race-pit-presentation'));
export const SECTION_OWNERS: ReadonlyMap<number, SectionOwner> = owners;

export const REFERENCE_CHECKS: Record<string, string[]> = {
  circuit: e('06-circuit-survey'),
  motion: e('motion 20-phase27h'),
  cockpit: e('05-cockpit-detail 20-phase27h'),
  pit: e('pit-presentation 29-populated-race-review 28-race-pit-presentation'),
  livery: e('07-reference-tools 09-reference-depth'),
  photo: e('09-reference-depth 20-phase27h'),
  driver: e('11-phase27c 20-phase27h'),
  wet: e('00-wet-presentation weather 29-populated-race-review 28-race-pit-presentation'),
  hq: e('09-reference-depth 18-phase27g'),
  engineering: e('07-reference-tools'),
  personnel: e('07-reference-tools 18-phase27g'),
  finance: e('07-reference-tools'),
  rivalry: e('07-reference-tools'),
  media: e('18-phase27g'),
  identity: e('07-reference-tools 18-phase27g'),
  mechanical: e('02-wheel-fidelity 10-aero-surface 20-phase27h'),
  tutorial: e('08-reference-implementation'),
  hud: e('instruments presentation 28-race-hud-layout'),
  settings: e('presentation 09-reference-depth'),
  objectives: e('08-reference-implementation'),
  calendar: e('07-reference-tools'),
  practice: e('08-reference-implementation'),
  story: e('18-phase27g'),
  broadcast: e('camera-continuity 29-populated-race-review 28-race-pit-presentation'),
  accessibility: e('09-reference-depth'),
  effects: e('03-skid-contact'),
  pregrid: e('08-reference-implementation'),
  hardware: e('calibration'),
  leaderboard: [],
  night: e('08-reference-implementation 18-phase27g 28-race-pit-presentation'),
  start: e('application 29-populated-race-review 28-race-pit-presentation'),
  excluded: [],
};
