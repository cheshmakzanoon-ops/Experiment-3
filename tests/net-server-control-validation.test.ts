import { describe, expect, it } from 'vitest';
import { sessionIdentity } from '../src/core/session-identity.ts';
import { RaceClient } from '../src/net/client.ts';
import { decodeServerMessage, encodeControl, MSG } from '../src/net/codec.ts';
import { LIMITS } from '../src/net/constants.ts';
import { EventLoop } from '../src/net/event-loop.ts';
import type { LobbyView, RaceEvent, RaceResults, ServerControl } from '../src/net/messages.ts';
import { PERFECT_LINK, type Transport } from '../src/net/transport.ts';
import { controls, DEFAULT_OPTIONS, type SessionOptions } from '../src/simulation/config.ts';
import { onlineFixture } from './net-helpers.ts';

const options: SessionOptions = {
  ...DEFAULT_OPTIONS,
  opponents: 1,
  vehicles: ['apx01', 'apx01'],
  grid: [1, 0],
  gates: [3, 1],
  aiSkill: 0.9,
  durationSeconds: 120,
};
const identity = sessionIdentity(options);
const lobby: LobbyView = {
  id: 'test',
  name: 'Test lobby',
  phase: 'grid',
  capacity: 2,
  circuit: identity.circuit,
  ruleset: identity.ruleset,
  mode: options.mode,
  members: [{ player: 'guest:1', name: 'Driver', vehicle: 'apx01', ready: true }],
};
const grid: Extract<ServerControl, { kind: 'grid' }> = {
  kind: 'grid',
  options,
  identity,
  entries: [
    { car: 0, name: 'Driver', player: 'guest:1', vehicle: 'apx01' },
    { car: 1, name: 'AI 2', player: null, vehicle: 'apx01' },
  ],
  car: 0,
  startTick: 0,
  serverTick: 0,
  startInMs: 1500.25,
};
const events: RaceEvent[] = [
  { type: 'lap', car: 0, lap: 1, time: 61.5, valid: true, tick: 7440 },
  { type: 'driver', car: 1, mode: 'ai', reason: 'connection timed out', tick: 7441 },
  { type: 'finish', car: 0, tick: 14880 },
];
const results: RaceResults = {
  endTick: 14880,
  reason: 'time-limit',
  classification: [
    {
      position: 1,
      car: 0,
      name: 'Driver',
      player: 'guest:1',
      laps: 2,
      lapTimes: [61.5, 62],
      best: 61.5,
      status: 'finished',
    },
    {
      position: 2,
      car: 1,
      name: 'AI 2',
      player: null,
      laps: 0,
      lapTimes: [],
      best: 0,
      status: 'ai',
    },
  ],
  recordDigest: '1a2b3c4d',
  progressDisputes: [],
};
const welcome: ServerControl = {
  kind: 'welcome',
  player: 'guest:1',
  token: 'abcdef0123456789',
  lobby,
};
const valid: ServerControl[] = [
  welcome,
  { kind: 'reject', reason: 'content mismatch' },
  { kind: 'lobby', lobby },
  grid,
  { ...grid, serverTick: 7440, startInMs: 0, events: [] },
  { kind: 'events', events },
  { kind: 'lapTimes', car: 0, from: 1, times: [62] },
  { kind: 'results', results },
  {
    kind: 'results',
    results: {
      ...results,
      lapTimesSeparate: true,
      classification: results.classification.map((row) => ({ ...row, lapTimes: [] })),
    },
  },
  { kind: 'kicked', reason: '' },
  { kind: 'pong', t: -25.5, serverTick: 0xffffffff },
];

function jsonFrame(json: string) {
  const body = new TextEncoder().encode(json),
    frame = new Uint8Array(body.length + 1);
  frame[0] = MSG.CONTROL;
  frame.set(body, 1);
  return frame;
}
const frame = (message: unknown) => jsonFrame(JSON.stringify(message));
const badOptions = (patch: object) => ({ ...grid, options: { ...options, ...patch } });
const badResults = (patch: object) => ({ kind: 'results', results: { ...results, ...patch } });
const badRow = (patch: object) =>
  badResults({
    classification: [{ ...results.classification[0], ...patch }, results.classification[1]],
  });

const malformed: [string, unknown][] = [
  ['null control', null],
  ['array control', []],
  ['missing discriminator', {}],
  ['unknown discriminator', { kind: 'admin' }],
  ['missing welcome lobby', { kind: 'welcome', player: 'guest:1', token: welcome.token }],
  ['null welcome lobby', { ...welcome, lobby: null }],
  ['non-string player', { ...welcome, player: 1 }],
  ['unusable rejoin token', { ...welcome, token: 'not a token' }],
  ['non-string rejection', { kind: 'reject', reason: {} }],
  ['missing kick reason', { kind: 'kicked' }],
  ['unknown lobby phase', { kind: 'lobby', lobby: { ...lobby, phase: 'starting' } }],
  ['fractional capacity', { kind: 'lobby', lobby: { ...lobby, capacity: 1.5 } }],
  [
    'oversize capacity',
    { kind: 'lobby', lobby: { ...lobby, capacity: LIMITS.playersPerLobby + 1 } },
  ],
  ['null member', { kind: 'lobby', lobby: { ...lobby, members: [null] } }],
  [
    'non-boolean readiness',
    { kind: 'lobby', lobby: { ...lobby, members: [{ ...lobby.members[0], ready: 'true' }] } },
  ],
  [
    'duplicate lobby member',
    { kind: 'lobby', lobby: { ...lobby, members: [lobby.members[0], lobby.members[0]] } },
  ],
  [
    'members beyond capacity',
    {
      kind: 'lobby',
      lobby: {
        ...lobby,
        capacity: 1,
        members: [lobby.members[0], { ...lobby.members[0], player: 'guest:2' }],
      },
    },
  ],
  ['missing options', { ...grid, options: undefined }],
  ['null options', { ...grid, options: null }],
  ['mode that crashes identity lookup', badOptions({ mode: '__proto__' })],
  ['fractional opponent count', badOptions({ opponents: 1.5 })],
  ['oversize opponent count', badOptions({ opponents: LIMITS.playersPerLobby })],
  ['negative laps', badOptions({ laps: -1 })],
  ['invalid weather', badOptions({ weather: null })],
  ['invalid assists', badOptions({ assist: [] })],
  ['invalid compound', badOptions({ compound: 'slick' })],
  ['negative seed', badOptions({ seed: -1 })],
  ['non-string circuit', badOptions({ circuit: {} })],
  ['non-string ruleset', badOptions({ ruleset: [] })],
  ['non-finite duration encoded as null', badOptions({ durationSeconds: Infinity })],
  ['non-finite AI skill encoded as null', badOptions({ aiSkill: NaN })],
  ['null setup', badOptions({ setup: null })],
  ['array setup', badOptions({ setup: [] })],
  ['non-finite setup field', badOptions({ setup: { ...options.setup, frontCamber: Infinity } })],
  ['non-number setup field', badOptions({ setup: { ...options.setup, gearing: {} } })],
  ['wrong vehicle count', badOptions({ vehicles: ['apx01'] })],
  ['invalid vehicle id shape', badOptions({ vehicles: ['apx01', {}] })],
  ['duplicate grid slot', badOptions({ grid: [0, 0] })],
  ['out-of-field grid slot', badOptions({ grid: [0, 2] })],
  ['out-of-range gate', badOptions({ gates: [0, 32] })],
  ['null content identity', { ...grid, identity: null }],
  ['invalid identity hash', { ...grid, identity: { ...identity, circuitHash: 'wrong' } }],
  ['missing identity vehicles', { ...grid, identity: { ...identity, vehicles: null } }],
  ['wrong hash count', { ...grid, identity: { ...identity, vehicleHashes: ['12345678'] } }],
  [
    'wrong identity field size',
    {
      ...grid,
      identity: { ...identity, vehicles: ['apx01'], vehicleHashes: [identity.vehicleHashes[0]] },
    },
  ],
  ['non-array entries', { ...grid, entries: {} }],
  ['null grid entry', { ...grid, entries: [null, grid.entries[1]] }],
  ['missing grid entry', { ...grid, entries: [grid.entries[0]] }],
  ['duplicate car', { ...grid, entries: [grid.entries[0], grid.entries[0]] }],
  ['negative car id', { ...grid, entries: [{ ...grid.entries[0], car: -1 }, grid.entries[1]] }],
  [
    'non-null AI player object',
    { ...grid, entries: [grid.entries[0], { ...grid.entries[1], player: {} }] },
  ],
  ['local car outside field', { ...grid, car: 2 }],
  ['fractional server tick', { ...grid, serverTick: 0.5 }],
  ['overflow tick', { ...grid, startTick: 0x100000000 }],
  ['negative countdown', { ...grid, startInMs: -1 }],
  ['null rejoin history', { ...grid, events: null }],
  ['non-array events', { kind: 'events', events: {} }],
  ['null event', { kind: 'events', events: [null] }],
  ['unknown event', { kind: 'events', events: [{ type: 'teleport', car: 0, tick: 1 }] }],
  [
    'out-of-range event car',
    { kind: 'events', events: [{ ...events[0], car: LIMITS.carsPerSnapshot }] },
  ],
  ['missing event tick', { kind: 'events', events: [{ ...events[0], tick: undefined }] }],
  ['fractional lap number', { kind: 'events', events: [{ ...events[0], lap: 1.5 }] }],
  ['null lap time', { kind: 'events', events: [{ ...events[0], time: null }] }],
  ['string validity flag', { kind: 'events', events: [{ ...events[0], valid: 'yes' }] }],
  ['unknown driver mode', { kind: 'events', events: [{ ...events[1], mode: 'remote' }] }],
  ['missing driver reason', { kind: 'events', events: [{ ...events[1], reason: undefined }] }],
  ['negative chunk car', { kind: 'lapTimes', car: -1, from: 0, times: [] }],
  ['fractional chunk offset', { kind: 'lapTimes', car: 0, from: 0.5, times: [1] }],
  ['null chunk times', { kind: 'lapTimes', car: 0, from: 0, times: null }],
  ['negative chunk time', { kind: 'lapTimes', car: 0, from: 0, times: [-1] }],
  ['chunk exceeds placement limit', { kind: 'lapTimes', car: 0, from: 2160, times: [1] }],
  ['chunk exceeds lap count', { kind: 'lapTimes', car: 0, from: 0, times: Array(2161).fill(1) }],
  ['missing results', { kind: 'results' }],
  ['missing classification', badResults({ classification: undefined })],
  ['null result row', badResults({ classification: [null] })],
  ['empty classification', badResults({ classification: [] })],
  ['duplicate result car', badRow({ car: 1 })],
  ['duplicate result position', badRow({ position: 2 })],
  ['position beyond classification', badRow({ position: 3 })],
  ['unknown result status', badRow({ status: 'won' })],
  ['negative lap count', badRow({ laps: -1 })],
  ['null inline lap times', badRow({ lapTimes: null })],
  ['null inline lap time', badRow({ lapTimes: [null] })],
  ['inline times exceed lap limit', badRow({ lapTimes: Array(2161).fill(1) })],
  ['null best time', badRow({ best: null })],
  ['negative best time', badRow({ best: -1 })],
  ['non-finite end tick encoded as null', badResults({ endTick: Infinity })],
  ['invalid result reason', badResults({ reason: 'cancelled' })],
  ['non-hash record digest', badResults({ recordDigest: {} })],
  ['non-array audit', badResults({ progressDisputes: {} })],
  ['out-of-range dispute', badResults({ progressDisputes: [LIMITS.carsPerSnapshot] })],
  ['non-boolean separate-lap marker', badResults({ lapTimesSeparate: 'yes' })],
  ['contradictory separate-lap marker', badResults({ lapTimesSeparate: true })],
  ['null pong timestamp', { kind: 'pong', t: null, serverTick: 0 }],
  ['negative pong tick', { kind: 'pong', t: 0, serverTick: -1 }],
];

describe('server control decoding boundary', () => {
  it.each(valid.map((message, index) => [message.kind, index, message] as const))(
    'round-trips %s variant %i without changing its payload',
    (_kind, _index, message) => {
      expect(decodeServerMessage(encodeControl(message), 'reliable')).toEqual({
        ok: true,
        value: { type: 'control', control: message },
      });
    },
  );

  it.each(malformed)('rejects %s', (_name, message) => {
    expect(decodeServerMessage(frame(message), 'reliable')).toMatchObject({ ok: false });
  });

  it('retains extensions, legacy optional fields and the no-local-car sentinel', () => {
    const legacy = {
      ...grid,
      car: -1,
      options: {
        ...DEFAULT_OPTIONS,
        opponents: 1,
        setup: { frontWing: 0.55, custom: 'kept' },
        extension: { enabled: true },
      },
      identity: { ...identity, extension: 'kept' },
      entries: grid.entries.map((entry) => ({ ...entry, extension: 'kept' })),
      extension: { version: 2 },
    };
    expect(decodeServerMessage(frame(legacy), 'reliable')).toEqual({
      ok: true,
      value: { type: 'control', control: legacy },
    });
  });

  it('requires reliable delivery and keeps the existing encoded size boundary', () => {
    expect(
      decodeServerMessage(encodeControl({ kind: 'pong', t: 0, serverTick: 0 }), 'unreliable'),
    ).toEqual({ ok: false, reason: 'control messages must be reliable' });
    const overhead = encodeControl({ kind: 'reject', reason: '' }).length;
    const full: ServerControl = {
      kind: 'reject',
      reason: 'x'.repeat(LIMITS.resultBytes - overhead),
    };
    expect(encodeControl(full)).toHaveLength(LIMITS.resultBytes);
    expect(decodeServerMessage(encodeControl(full), 'reliable').ok).toBe(true);
    expect(
      decodeServerMessage(encodeControl({ ...full, reason: `${full.reason}x` }), 'reliable').ok,
    ).toBe(false);
  });

  it('accepts low lap times at every array index and the last chunk placement', () => {
    const times = Array(2160).fill(0.25);
    expect(
      decodeServerMessage(frame({ kind: 'lapTimes', car: 31, from: 0, times }), 'reliable').ok,
    ).toBe(true);
    expect(
      decodeServerMessage(frame({ kind: 'lapTimes', car: 0, from: 2159, times: [0] }), 'reliable')
        .ok,
    ).toBe(true);
    expect(decodeServerMessage(frame(badRow({ lapTimes: times })), 'reliable').ok).toBe(true);
  });

  it('refuses overflow JSON numbers, malformed UTF-8, truncation and trailing JSON', () => {
    for (const json of [
      '{"kind":"pong","t":1e400,"serverTick":0}',
      '{"kind":"pong","t":0,"serverTick":1e400}',
      JSON.stringify(grid).replace('1500.25', '1e400'),
      `${JSON.stringify(welcome)}null`,
    ])
      expect(decodeServerMessage(jsonFrame(json), 'reliable').ok).toBe(false);
    expect(decodeServerMessage(Uint8Array.of(MSG.CONTROL, 0xc3, 0x28), 'reliable').ok).toBe(false);
    for (const message of valid) {
      const bytes = encodeControl(message);
      for (const end of [0, 1, Math.floor(bytes.length / 2), bytes.length - 1])
        expect(decodeServerMessage(bytes.slice(0, end), 'reliable').ok).toBe(false);
    }
  });

  it('drops malformed messages before client callbacks can mutate state or throw', () => {
    const transport: Transport = {
      label: 'untrusted-server',
      open: true,
      send: () => {},
      close: () => {},
      onMessage: null,
      onClose: null,
    };
    const client = new RaceClient({
      loop: new EventLoop(),
      transport,
      name: 'Driver',
      vehicle: 'apx01',
      advertised: options,
      input: controls,
      autoReady: true,
    });
    for (const [_name, message] of malformed)
      expect(() => transport.onMessage?.(frame(message), 'reliable')).not.toThrow();
    expect(client.stats.invalidMessages).toBe(malformed.length);
    expect(client.state).toBe('connecting');
    expect(client.grid).toBeNull();
    expect(client.lobby).toBeNull();
    expect(client.results).toBeNull();
    expect(client.events).toEqual([]);
    expect(client.car).toBe(-1);
    expect(client.token).toBe('');
    client.dispose();
  });

  it('accepts actual server welcome, AI grid, snapshots and zero-best results', () => {
    const fixture = onlineFixture({
      capacity: 2,
      minPlayers: 1,
      link: PERFECT_LINK,
      server: { maxTicks: 6, timeouts: { gridCountdownMs: 0 } },
    });
    const { client } = fixture.connect('Driver');
    fixture.loop.runUntil(100);
    expect(client.state).toBe('results');
    expect(client.stats.invalidMessages).toBe(0);
    expect(client.stats.snapshots).toBeGreaterThan(0);
    expect(client.lobby?.members).toHaveLength(1);
    expect(client.entries[1].player).toBeNull();
    expect(client.results).toEqual(fixture.server.results);
    expect(client.results?.classification.every((row) => row.best === 0)).toBe(true);
    client.dispose();
    fixture.server.teardown();
  });
});
