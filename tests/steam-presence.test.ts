import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { wildcardSeries } from '../src/career/wildcard-series.ts';
import { CIRCUITS } from '../src/simulation/circuits.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { sessionStartedEvent } from '../src/steam/hooks.ts';
import {
  PRESENCE_STATUSES,
  PRESENCE_TEXT,
  describePresence,
  presenceKeys,
  presenceVdf,
  type PresenceStatus,
} from '../src/steam/presence.ts';
import { presenceFor, statusForMode } from '../src/steam/runtime.ts';

const root = new URL('../', import.meta.url);

describe('rich presence', () => {
  it('has English text for every status and a pinned localisation file', () => {
    expect(PRESENCE_STATUSES).toEqual([
      'Menu',
      'Loading',
      'Racing',
      'TimeTrial',
      'Wildcard',
      'Paused',
      'Results',
      'Replay',
      'Photo',
      'Festival',
    ]);
    for (const status of PRESENCE_STATUSES)
      expect(PRESENCE_TEXT[status].length, status).toBeGreaterThan(3);
    // The committed file is generated: `npm run export:presence`.
    expect(readFileSync(new URL('docs/studio/store/RICH_PRESENCE.vdf', root), 'utf8')).toBe(
      presenceVdf(),
    );
    const vdf = presenceVdf();
    for (const status of PRESENCE_STATUSES) expect(vdf).toContain(`"#Status_${status}"`);
  });
  it('maps every status the game can report to a token', () => {
    const reported = new Set<string>([
      ...[
        'menu',
        'loading',
        'pregame',
        'driving',
        'paused',
        'results',
        'replay',
        'photo',
        'festival',
      ].map(statusForMode),
      'TimeTrial',
      'Wildcard',
    ]);
    for (const status of reported)
      expect(PRESENCE_STATUSES as readonly string[], status).toContain(status);
  });
  it('sets every key a status text uses, for a session of any kind (an unset key shows as an empty word)', () => {
    const base = {
      circuit: 'aurel' as const,
      vehicles: ['apx01'],
      ruleset: undefined,
      weather: 'clear' as const,
    };
    const samples: Record<string, ReturnType<typeof presenceFor>> = {
      Racing: presenceFor(sessionStartedEvent({ ...base, mode: 'race' })),
      TimeTrial: presenceFor(sessionStartedEvent({ ...base, mode: 'time-trial' })),
      Wildcard: presenceFor(
        sessionStartedEvent({ ...base, mode: 'race' }, 'circuit', 'karts-after-dark'),
      ),
      Festival: presenceFor(sessionStartedEvent({ ...base }, 'festival')),
    };
    for (const [expected, presence] of Object.entries(samples)) {
      expect(presence?.status, expected).toBe(expected);
      const sent = describePresence({ ...presence!, status: expected });
      for (const key of presenceKeys(expected as PresenceStatus))
        expect(
          String((sent as unknown as Record<string, unknown>)[key] ?? ''),
          `${expected} needs ${key}`,
        ).not.toBe('');
    }
    // The statuses the UI mode observer adds keep the session's keys.
    for (const status of ['Paused', 'Results', 'Replay'] as const) {
      const sent = describePresence({ ...samples.Racing!, status });
      for (const key of presenceKeys(status))
        expect(
          String((sent as unknown as Record<string, unknown>)[key] ?? ''),
          `${status} needs ${key}`,
        ).not.toBe('');
    }
    for (const status of ['Menu', 'Loading', 'Photo'] as const)
      expect(presenceKeys(status)).toEqual([]);
  });
  it('picks the time-trial and Wildcard lines from the session', () => {
    const base = { circuit: 'aurel' as const, vehicles: ['apx01'], weather: 'clear' as const };
    expect(presenceFor(sessionStartedEvent({ ...base, mode: 'practice' }))?.status).toBe('Racing');
    expect(presenceFor(sessionStartedEvent({ ...base, mode: 'time-trial' }))?.status).toBe(
      'TimeTrial',
    );
    const wild = presenceFor(
      sessionStartedEvent({ ...base, mode: 'race' }, 'circuit', 'karts-after-dark'),
    );
    expect(wild).toMatchObject({ status: 'Wildcard', event: 'karts-after-dark' });
    expect(presenceFor(sessionStartedEvent({ ...base }, 'festival'))?.status).toBe('Festival');
  });
  it('turns ids into the names a friends list shows, and passes unknown ids through', () => {
    const sent = describePresence({
      status: 'Wildcard',
      venue: 'alpine-pass',
      vehicle: 'apx01',
      weather: 'fog',
      discipline: 'circuit',
      event: 'descent-in-the-cloud',
    });
    expect(sent.status).toBe('Wildcard');
    expect(sent.venue).toBe(
      CIRCUITS['alpine-pass'].catalogue ? sent.venue : 'Col D’argent Mountain Pass',
    );
    expect(sent.venue).not.toBe('alpine-pass');
    expect(sent.vehicle).toBe('APX-01 Formula');
    expect(sent.weather).toBe('Fog');
    expect(sent.discipline).toBe('Circuit racing');
    expect(sent.event).toBe('The Descent In The Cloud');
    expect(
      describePresence({
        status: 'Racing',
        venue: 'nowhere',
        vehicle: 'zz9',
        weather: 'lava',
        discipline: 'x',
      }),
    ).toEqual({
      status: 'Racing',
      venue: 'nowhere',
      vehicle: 'zz9',
      weather: 'lava',
      discipline: 'x',
    });
    expect(describePresence({ status: 'Menu' })).toEqual({ status: 'Menu' });
  });
  it('names every circuit and machine without leaving an id or an empty word', () => {
    for (const id of Object.keys(CIRCUITS)) {
      const name = describePresence({ status: 'Racing', venue: id }).venue!;
      expect(name.length, id).toBeGreaterThan(2);
      expect(name, id).not.toMatch(/[/]|^[a-z-]+$/);
    }
    for (const id of Object.keys(VEHICLES))
      expect(describePresence({ status: 'Racing', vehicle: id }).vehicle!, id).not.toBe(id);
    for (const entry of wildcardSeries())
      expect(
        describePresence({ status: 'Wildcard', event: entry.id }).event!.length,
        entry.id,
      ).toBeLessThanOrEqual(80);
  });
  it('is passed through the shell with the event key, trimmed to Steam limits', () => {
    const main = readFileSync(new URL('desktop/main.cjs', root), 'utf8');
    expect(main).toContain('event: text(s.event)');
    expect(main).toContain('slice(0, 80)');
  });
});
