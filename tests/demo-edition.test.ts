import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { disciplineEvents, licenceAvailability } from '../src/career/ladder.ts';
import { LICENCE_IDS } from '../src/career/licences.ts';
import { liveRegistry } from '../src/career/registry.ts';
import { newCareer } from '../src/career/save.ts';
import { WILDCARD_SERIES } from '../src/career/wildcard-series.ts';
import { desktopBridge, type MotoboundDesktop } from '../src/desktop/bridge.ts';
import {
  DEMO_BUILD,
  DEMO_SLICE,
  FULL_GAME,
  clockText,
  createDemoPolicy,
  demoPolicy,
  festivalClock,
  useDemoPolicy,
} from '../src/release/demo.ts';
import { demoSessionLock, fullGameCounts } from '../src/release/demo-gates.ts';
import { openWishlist, wishlistAvailable, wishlistSource } from '../src/release/wishlist.ts';
import { CIRCUIT_IDS } from '../src/simulation/circuits.ts';
import { festivalAdmits } from '../src/simulation/open-world/festival-machines.ts';
import { VEHICLES, VEHICLE_IDS } from '../src/simulation/vehicles.ts';
import { circuitOptionsHtml } from '../src/ui/circuit-menu.ts';
import { demoBoardPlateHtml, lockedPanelHtml, wishlistButtonHtml } from '../src/ui/demo-plate.ts';
import { entryDefaults, machinesFor, venuesFor, disciplineFacts } from '../src/ui/disciplines.ts';
import { careerHub } from '../src/ui/career-hub.ts';
import { machineSelectOptions, sessionRulesSummary } from '../src/ui/machine-options.ts';
import { bestMedal, wildcardBoardHtml, wildcardProgress } from '../src/ui/wildcard-board.ts';

/** The Steam demo edition: one data table (src/release/demo.ts) and the gates that read it. */

describe('the slice is real data that the catalogues contain', () => {
  it('names only circuits, machines, events and licences that exist', () => {
    for (const id of DEMO_SLICE.circuits) expect(CIRCUIT_IDS, id).toContain(id);
    for (const id of [...DEMO_SLICE.machines, ...DEMO_SLICE.festival.machines])
      expect(VEHICLE_IDS, id).toContain(id);
    const events = WILDCARD_SERIES.map((e) => e.id);
    for (const id of DEMO_SLICE.wildcard) expect(events, id).toContain(id);
    for (const id of DEMO_SLICE.licences) expect(LICENCE_IDS, id).toContain(id);
  });
  it('is the planned slice: 3 circuits, 2 formula cars, 1 GP bike, 1 motocross bike, 5 events, 1 licence', () => {
    expect(DEMO_SLICE.circuits).toHaveLength(3);
    const classes = DEMO_SLICE.machines.map((id) => VEHICLES[id].classId);
    expect(classes.filter((c) => c === 'formula')).toHaveLength(2);
    expect(classes.filter((c) => c === 'gp-bike')).toHaveLength(1);
    expect(classes.filter((c) => c === 'motocross')).toHaveLength(1);
    expect(DEMO_SLICE.wildcard).toHaveLength(5);
    expect(DEMO_SLICE.licences).toEqual(['braking']);
    expect(DEMO_SLICE.festival.seconds).toBeGreaterThan(0);
  });
  it('keeps the slice playable: the cars and the GP bike have a venue that takes them', () => {
    for (const id of ['aurel', 'vellamar']) {
      expect(DEMO_SLICE.circuits).toContain(id);
    }
    expect(DEMO_SLICE.circuits).toContain('valley-ridge-mx');
  });
  it('lends the festival road cars the festival admits', () => {
    for (const id of DEMO_SLICE.festival.machines) {
      expect(festivalAdmits(VEHICLES[id]), id).toBe(true);
      expect(DEMO_SLICE.machines, id).not.toContain(id);
    }
  });
  it('covers every discipline and the hook across the five events', () => {
    const entries = WILDCARD_SERIES.filter((e) => DEMO_SLICE.wildcard.includes(e.id));
    expect(new Set(entries.map((e) => e.kind))).toEqual(
      new Set(['class-mismatch', 'cross-discipline']),
    );
    expect(new Set(entries.map((e) => e.event.weather)).size).toBeGreaterThanOrEqual(3);
  });
});

describe('the full game has no policy and nothing is gated', () => {
  it('is the full game in unit tests (no build flag injected)', () => {
    expect(DEMO_BUILD).toBe(false);
    expect(demoPolicy()).toBeNull();
  });
  it('opens every menu list, session, event and plate', () => {
    expect(demoSessionLock({ circuit: 'riviera', mode: 'race', vehicles: ['sk125'] })).toBeNull();
    expect(demoSessionLock({ circuit: 'aurel', mode: 'festival', vehicles: ['sc7'] })).toBeNull();
    expect(
      demoSessionLock({ circuit: 'aurel', mode: 'race' }, 'wildcard.karts-after-dark'),
    ).toBeNull();
    expect(fullGameCounts()).toBeNull();
    expect(circuitOptionsHtml()).not.toContain(FULL_GAME);
    expect(machineSelectOptions()).not.toContain(FULL_GAME);
    expect(venuesFor('circuit')).toHaveLength(CIRCUIT_IDS.length - 4);
    expect(demoBoardPlateHtml()).toBe('');
    expect(wishlistButtonHtml('x')).toBe('');
    expect(lockedPanelHtml('x', 'y')).toBe('');
    expect(wildcardProgress(null).total).toBe(WILDCARD_SERIES.length);
    expect(wildcardBoardHtml(null)).not.toContain('data-locked');
    expect(liveRegistry().lockedLicences).toBeUndefined();
    expect(liveRegistry().vehicles).toHaveLength(VEHICLE_IDS.length);
  });
});

describe('the demo policy', () => {
  let restore: () => void;
  beforeEach(() => {
    restore = useDemoPolicy(createDemoPolicy());
  });
  afterEach(() => restore());

  it('answers from the slice and falls back to the full game when removed', () => {
    const policy = demoPolicy()!;
    expect(policy.circuitOpen('aurel')).toBe(true);
    expect(policy.circuitOpen('riviera')).toBe(false);
    expect(policy.machineOpen('apx01')).toBe(true);
    expect(policy.machineOpen('apx01', 'festival')).toBe(false);
    expect(policy.machineOpen('eh3', 'festival')).toBe(true);
    expect(policy.machineOpen('eh3', 'circuit')).toBe(false);
    expect(policy.machineOpen('bikes')).toBe(false);
    expect(policy.wildcardOpen('descent-in-the-cloud')).toBe(true);
    expect(policy.wildcardOpen('karts-after-dark')).toBe(false);
    expect(policy.licenceOpen('braking')).toBe(true);
    expect(policy.licenceOpen('jump')).toBe(false);
    restore();
    expect(demoPolicy()).toBeNull();
  });
});

describe('session gate (every start goes through it)', () => {
  let restore: () => void;
  beforeEach(() => {
    restore = useDemoPolicy(createDemoPolicy());
  });
  afterEach(() => restore());

  it('lets the slice through, including the default formula field', () => {
    expect(demoSessionLock({ circuit: 'aurel', mode: 'race' })).toBeNull();
    expect(
      demoSessionLock({ circuit: 'vellamar', mode: 'practice', vehicles: ['fx26', 'fx26'] }),
    ).toBeNull();
    expect(
      demoSessionLock({ circuit: 'aurel', mode: 'race', vehicles: ['gpr1', 'gpr1'] }),
    ).toBeNull();
    expect(
      demoSessionLock({ circuit: 'valley-ridge-mx', mode: 'race', vehicles: ['mx450'] }),
    ).toBeNull();
    expect(demoSessionLock({ mode: 'practice' })).toBeNull();
  });
  it('refuses a circuit, a machine or a mixed grid outside the slice, naming FULL GAME', () => {
    const venue = demoSessionLock({ circuit: 'riviera', mode: 'race' });
    expect(venue).toMatch(/RIVIERA.*FULL GAME/);
    const machine = demoSessionLock({ circuit: 'aurel', mode: 'race', vehicles: ['gt8f'] });
    expect(machine).toMatch(/GT-8F.*FULL GAME/);
    expect(demoSessionLock({ circuit: 'aurel', mode: 'race', vehicles: ['apx01', 'tc1'] })).toMatch(
      /TC-1.*FULL GAME/,
    );
    expect(demoSessionLock({ circuit: 'aurel', mode: 'race', vehicles: ['gpr2'] })).toMatch(
      FULL_GAME,
    );
  });
  it('lets the festival lend only its coast cars', () => {
    expect(demoSessionLock({ mode: 'festival', vehicles: ['eh3'] })).toBeNull();
    expect(demoSessionLock({ mode: 'festival', vehicles: ['rd2', 'rd2'] })).toBeNull();
    expect(demoSessionLock({ mode: 'festival', vehicles: ['sc7'] })).toMatch(FULL_GAME);
    expect(demoSessionLock({ mode: 'festival' })).toMatch(FULL_GAME); // the formula default
  });
  it('lets an open Wildcard event loan its own venue and machine, and nothing else on them', () => {
    // Career door: the event key decides.
    expect(
      demoSessionLock(
        { circuit: 'speedbowl', mode: 'race', vehicles: ['fx26'] },
        'wildcard.formula-on-the-wall',
      ),
    ).toBeNull();
    expect(
      demoSessionLock(
        { circuit: 'neon-city', mode: 'race', vehicles: ['sk125'] },
        'wildcard.karts-after-dark',
      ),
    ).toMatch(/KARTS AFTER DARK.*FULL GAME/);
    // Any other door (CONTINUE, the form): the session is matched on its content.
    for (const entry of WILDCARD_SERIES.filter((e) => DEMO_SLICE.wildcard.includes(e.id)))
      expect(
        demoSessionLock({
          circuit: entry.event.circuit,
          mode: entry.event.mode,
          vehicles: [entry.event.vehicles].flat() as string[],
        }),
        entry.id,
      ).toBeNull();
    for (const entry of WILDCARD_SERIES.filter((e) => !DEMO_SLICE.wildcard.includes(e.id)))
      expect(
        demoSessionLock({
          circuit: entry.event.circuit,
          mode: entry.event.mode,
          vehicles: [entry.event.vehicles].flat() as string[],
        }),
        entry.id,
      ).toMatch(FULL_GAME);
    // The loan does not open the venue to other machines.
    expect(demoSessionLock({ circuit: 'speedbowl', mode: 'race', vehicles: ['apx01'] })).toMatch(
      FULL_GAME,
    );
  });
  it('counts what the full game adds from the catalogues', () => {
    const counts = fullGameCounts()!;
    expect(counts.circuits).toBe(CIRCUIT_IDS.length - 3);
    expect(counts.machines).toBe(VEHICLE_IDS.length - 4 - 2);
    expect(counts.wildcard).toBe(WILDCARD_SERIES.length - 5);
    expect(counts.licences).toBe(LICENCE_IDS.length - 1);
  });
  it('shows FULL GAME in the paddock rules line, the one the form reads', () => {
    expect(
      sessionRulesSummary({
        mode: 'race',
        opponents: 7,
        compound: 'medium',
        vehicle: 'apx01',
        circuit: 'riviera',
      }),
    ).toMatch(/^Unavailable: .*RIVIERA.*FULL GAME/);
    expect(
      sessionRulesSummary({
        mode: 'race',
        opponents: 7,
        compound: 'medium',
        vehicle: 'apx01',
        circuit: 'aurel',
      }),
    ).not.toMatch(/FULL GAME/);
  });
});

describe('the Paddock Board shows the rest as FULL GAME plates', () => {
  let restore: () => void;
  beforeEach(() => {
    restore = useDemoPolicy(createDemoPolicy());
  });
  afterEach(() => restore());

  it('keeps locked venues and machines listed, disabled and labelled', () => {
    const circuits = circuitOptionsHtml();
    expect(circuits).toContain('<option value="aurel">');
    expect(circuits).toMatch(/<option value="riviera" disabled>[^<]*· FULL GAME<\/option>/);
    expect((circuits.match(/ disabled>/g) ?? []).length).toBe(CIRCUIT_IDS.length - 3);
    const machines = machineSelectOptions();
    expect(machines).toMatch(/<option value="apx01" selected>/);
    expect(machines).toMatch(/<option value="gt8f" disabled>[^<]*· FULL GAME<\/option>/);
    // The festival's coast cars are in the demo (open under the FESTIVAL plate).
    expect(machines).not.toMatch(/<option value="eh3" disabled>/);
  });
  it('offers each discipline only its slice, and defaults land inside it', () => {
    expect(venuesFor('circuit')).toEqual(['aurel', 'vellamar']);
    expect(venuesFor('gp')).toEqual(['aurel', 'vellamar']);
    expect(venuesFor('dirt')).toEqual(['valley-ridge-mx']);
    expect(machinesFor('circuit', 'aurel')).toEqual(['apx01', 'fx26']);
    expect(machinesFor('gp', 'aurel')).toEqual(['gpr1']);
    expect(machinesFor('dirt', 'valley-ridge-mx')).toEqual(['mx450']);
    expect(machinesFor('festival', '')).toEqual(expect.arrayContaining(['eh3', 'rd2']));
    expect(machinesFor('festival', '')).toHaveLength(2);
    expect(disciplineFacts('circuit').count).toBe(2);
    const festival = entryDefaults('festival', {
      mode: 'race',
      circuit: 'aurel',
      vehicle: 'apx01',
    });
    expect(DEMO_SLICE.festival.machines).toContain(festival.vehicle);
    expect(
      entryDefaults('festival', { mode: 'festival', circuit: 'aurel', vehicle: 'sc7' }).vehicle,
    ).toBe(festival.vehicle);
    expect(
      entryDefaults('gp', { mode: 'race', circuit: 'riviera', vehicle: 'sbk1000' }),
    ).toMatchObject({
      circuit: 'aurel',
      vehicle: 'gpr1',
    });
  });
  it('renders the board plate with the counts, and a wishlist button only where a shell can open it', () => {
    const plate = demoBoardPlateHtml();
    expect(plate).toContain('id="demoPlate"');
    // Derived, so every new venue does not need a test edit: every circuit outside the demo slice.
    const locked = CIRCUIT_IDS.filter((id) => !DEMO_SLICE.circuits.includes(id)).length;
    expect(plate).toMatch(new RegExp(`<b>${locked}</b> MORE CIRCUITS`));
    expect(plate).toContain('MORE WILDCARD EVENTS');
    // No bridge in a unit test: a label, not a button that cannot work.
    expect(plate).not.toContain('data-action="demo:wishlist');
    expect(plate).toContain('FULL GAME ON STEAM');
  });
  it('tallies and lists the Wildcard board with open events first and locked ones as plates', () => {
    const progress = wildcardProgress(null);
    expect(progress.total).toBe(5);
    expect(DEMO_SLICE.wildcard).toContain(progress.next!.id);
    const html = wildcardBoardHtml(newCareer());
    expect((html.match(/class="wc-row"/g) ?? []).length).toBe(WILDCARD_SERIES.length);
    expect((html.match(/data-locked="true"/g) ?? []).length).toBe(WILDCARD_SERIES.length - 5);
    expect(html).toContain('OF 5 MEDALLED');
    expect(html).toContain('5 OF 21 IN THE DEMO'.replace('21', String(WILDCARD_SERIES.length)));
    // Open events start; locked events do not offer a start button.
    for (const entry of WILDCARD_SERIES) {
      const start = `data-action="career:wildcardGo:${entry.id}"`;
      if (DEMO_SLICE.wildcard.includes(entry.id)) expect(html, entry.id).toContain(start);
      else expect(html, entry.id).not.toContain(start);
    }
    // The first row is an open one.
    const first = html.match(/class="wc-row"[^>]*data-id="([^"]+)"/)![1];
    expect(DEMO_SLICE.wildcard).toContain(first);
    expect(bestMedal(WILDCARD_SERIES[0], null)).toBeNull();
  });
});

describe('the career is cut to the slice and the first licence', () => {
  let restore: () => void;
  beforeEach(() => {
    restore = useDemoPolicy(createDemoPolicy());
  });
  afterEach(() => restore());

  it('builds its registry from the slice only', () => {
    const registry = liveRegistry();
    expect(registry.vehicles.map((v) => v.id).sort()).toEqual(
      [...DEMO_SLICE.machines, ...DEMO_SLICE.festival.machines].sort(),
    );
    expect(
      registry.venues
        .filter((v) => v.venueKind !== 'festival')
        .map((v) => v.id)
        .sort(),
    ).toEqual([...DEMO_SLICE.circuits].sort());
    expect(registry.venues.some((v) => v.venueKind === 'festival')).toBe(true);
    expect(registry.lockedLicences).toEqual(LICENCE_IDS.filter((id) => id !== 'braking'));
    for (const event of registry.events) {
      expect(DEMO_SLICE.circuits).toContain(event.circuit);
    }
  });
  it('offers the first licence and shows the others as FULL GAME', () => {
    const registry = liveRegistry();
    const save = newCareer();
    expect(licenceAvailability(registry, save, 'braking').locked).toBeUndefined();
    for (const id of LICENCE_IDS.filter((l) => l !== 'braking')) {
      const a = licenceAvailability(registry, save, id);
      expect(a.locked, id).toBe(true);
      expect(a.status, id).toBe('coming');
      expect(a.definition, id).toBeNull();
      expect(a.reasons, id).toEqual([FULL_GAME]);
    }
    const html = careerHub(save, registry, { page: 'licences', discipline: 'circuit-cars' });
    expect((html.match(/data-locked="true"/g) ?? []).length).toBe(LICENCE_IDS.length - 1);
    expect(html).toContain('This licence test is in the full game');
    expect(html).not.toContain('career:licence:cornering');
    expect(html).toContain('career:licence:braking');
  });
  it('names the full game where a tier asks for a licence the demo lacks', () => {
    const registry = liveRegistry();
    const events = disciplineEvents(registry, newCareer(), 'circuit-cars');
    const reasons = events.flatMap((e) => e.reasons).join('\n');
    expect(reasons).toMatch(/Cornering line licence \(bronze\) · FULL GAME/);
    // The club meeting on a loaned machine still runs: the demo career is never empty.
    expect(events.find((e) => e.kind === 'recovery')).toBeDefined();
  });
  it('renders every career page without throwing', () => {
    const registry = liveRegistry();
    for (const page of ['hub', 'events', 'licences', 'garage', 'dealership'] as const)
      for (const discipline of ['circuit-cars', 'road-bikes', 'off-road', 'festival'] as const)
        expect(
          () => careerHub(newCareer(), registry, { page, discipline }),
          `${page}/${discipline}`,
        ).not.toThrow();
  });
});

describe('the coast visit clock', () => {
  it('counts only driving seconds and never passes its limit', () => {
    const clock = festivalClock(10, 0.25);
    expect(clock.tick(0.2, false)).toBe(false);
    expect(clock.elapsed).toBe(0);
    clock.tick(0.2, true);
    expect(clock.elapsed).toBeCloseTo(0.2, 6);
    clock.tick(5, true); // a hitch counts as one step
    expect(clock.elapsed).toBeCloseTo(0.45, 6);
    clock.tick(Number.NaN, true);
    clock.tick(-3, true);
    expect(clock.elapsed).toBeCloseTo(0.45, 6);
    for (let i = 0; i < 100; i++) clock.tick(0.25, true);
    expect(clock.expired).toBe(true);
    expect(clock.elapsed).toBe(10);
    expect(clock.remaining).toBe(0);
    expect(clock.tick(0.25, true)).toBe(true);
  });
  it('formats time left', () => {
    expect(clockText(900)).toBe('15:00');
    expect(clockText(59.2)).toBe('1:00');
    expect(clockText(0)).toBe('0:00');
    expect(clockText(-4)).toBe('0:00');
  });
});

describe('the wishlist call to action (no network in the page)', () => {
  const bridge = (openStore?: MotoboundDesktop['shell'] extends infer S ? S : never) =>
    ({ version: 1, shell: openStore }) as unknown as MotoboundDesktop;

  it('has no bridge in a browser and says where the game lives instead', async () => {
    expect(desktopBridge()).toBeNull();
    expect(wishlistAvailable()).toBe(false);
    const result = await openWishlist('paddock');
    expect(result).toMatchObject({ ok: false, reason: 'no-desktop' });
  });
  it('hands the shell only a sanitised campaign label', async () => {
    const seen: string[] = [];
    const shell = {
      openStore: async (source: string) => {
        seen.push(source);
        return { opened: true, reason: null };
      },
    };
    expect(wishlistAvailable(bridge(shell))).toBe(true);
    await expect(openWishlist('Festival End!?', bridge(shell))).resolves.toEqual({ ok: true });
    expect(seen).toEqual(['festival-end']);
    expect(wishlistSource('../../etc/passwd')).toBe('etc-passwd');
    expect(wishlistSource('')).toBe('demo');
    expect(wishlistSource('x'.repeat(100))).toHaveLength(32);
  });
  it('reports a store page that is not configured, a refusal and a crash without throwing', async () => {
    const make = (impl: () => Promise<{ opened: boolean; reason: string | null }>) =>
      bridge({ openStore: impl });
    await expect(
      openWishlist(
        'x',
        make(async () => ({ opened: false, reason: 'not-configured' })),
      ),
    ).resolves.toMatchObject({ ok: false, reason: 'not-configured' });
    await expect(
      openWishlist(
        'x',
        make(async () => ({ opened: false, reason: 'blocked' })),
      ),
    ).resolves.toMatchObject({ ok: false, reason: 'refused' });
    await expect(
      openWishlist(
        'x',
        make(async () => Promise.reject(new Error('ipc'))),
      ),
    ).resolves.toMatchObject({ ok: false, reason: 'failed' });
  });
});

describe('the demo build is wired the way the release process needs', () => {
  const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  it('is a product-class build in its own directory with its own edition label', () => {
    const vite = read('vite.config.ts');
    expect(vite).toContain("process.env.MOTOBOUND_DEMO === '1'");
    expect(vite).toContain('__DEMO_BUILD__: JSON.stringify(demoBuild)');
    expect(vite).toMatch(/variant, edition/);
    const script = read('scripts/build-demo.mjs');
    expect(script).toContain("MOTOBOUND_DEMO: '1'");
    expect(script).toContain("'dist-demo'");
    expect(script).toContain('ip-guard.mjs');
    expect(script).toMatch(/MOTOBOUND_SUPPLIED_PLAYER.*MOTOBOUND_REVIEW_TOOLS/s);
    const pkg = JSON.parse(read('package.json')).scripts as Record<string, string>;
    expect(pkg['build:demo']).toBe('tsc --noEmit && node scripts/build-demo.mjs');
    expect(pkg.build).toBe('tsc --noEmit && vite build');
    expect(read('.gitignore')).toMatch(/^dist-demo\/$/m);
  });
  it('never lets the demo be published as the game', () => {
    expect(read('scripts/publish-validated-release.sh')).toMatch(
      /identity\.edition \?\? 'full'\) !== 'full'/,
    );
  });
});
