import { describe, expect, it, vi } from 'vitest';
import {
  AuthoritativeWorld,
  DT,
  decodeJournal,
  encodeJournal,
  journalEntryLimit,
  type JournalEntry,
} from '../src/net/authority.ts';
import { ServerInputQueue, quantizeControls, type InputCommand } from '../src/net/input.ts';
import { createRecord, verifyRecord } from '../src/net/records.ts';
import { PERFECT_LINK } from '../src/net/transport.ts';
import {
  DEFAULT_OPTIONS,
  controls,
  validateOptions,
  type Controls,
} from '../src/simulation/config.ts';
import { Simulation } from '../src/simulation/world.ts';
import { onlineFixture } from './net-helpers.ts';

const OPTIONS = validateOptions({
  ...DEFAULT_OPTIONS,
  mode: 'time-trial',
  opponents: 0,
  vehicles: ['gpr1'],
  seed: 919,
});

function command(seq: number, tick: number, ticks: number, shift = 1): InputCommand {
  return {
    seq,
    tick,
    ticks,
    controls: quantizeControls({ ...controls(), shift, manualClutch: true, clutch: 1 }),
  };
}

/** The real server's order: take a slot, apply its first marker, then step.
 * A missing slot leaves the driver's level controls in place. */
function driveUntil(world: AuthoritativeWorld, queue: ServerInputQueue, endTick: number) {
  const gears: number[] = [];
  while (world.tick < endTick) {
    const slot = queue.take(world.tick);
    if (slot) world.setControls(0, slot.controls, slot.first);
    world.step();
    gears.push(world.sim.cars[0].gear);
  }
  return gears;
}

function shifts(world: AuthoritativeWorld) {
  return world.journal.filter((entry) => entry.kind === 'shift');
}

describe('network command shift edges', () => {
  it.each([1, 2, 4, 8])(
    'applies a %i-tick command once through the real manual GP gearbox, including missing slots',
    (ticks) => {
      const world = new AuthoritativeWorld(OPTIONS),
        queue = new ServerInputQueue(),
        input = command(0, 0, ticks),
        car = world.sim.cars[0],
        shift = vi.spyOn(car, 'shift');
      queue.accept([input], 0);
      const gears = driveUntil(world, queue, 30);
      expect(shift).toHaveBeenCalledExactlyOnceWith(1);
      expect(gears).toEqual(Array.from({ length: 30 }, () => 2));
      expect(car.autoShift).toBe(false);
      expect(car.input.manualClutch).toBe(true);
      expect(world.drivers[0].controls.shift).toBe(0);
      expect(input.controls.shift).toBe(1);
      expect(shifts(world)).toEqual([{ tick: 0, car: 0, kind: 'shift', shift: 1 }]);
    },
  );

  it('keeps distinct identical pulses while deduplicating redundant command copies', () => {
    const world = new AuthoritativeWorld(OPTIONS),
      queue = new ServerInputQueue(),
      inputs = [command(0, 0, 4), command(1, 4, 4), command(2, 8, 4, -1)],
      shift = vi.spyOn(world.sim.cars[0], 'shift');
    queue.accept(inputs, 0);
    queue.accept(inputs, 0);
    driveUntil(world, queue, 5);
    queue.accept(inputs, world.tick);
    driveUntil(world, queue, 24);
    expect(shift.mock.calls.map(([direction]) => direction)).toEqual([1, 1, -1]);
    expect(world.sim.cars[0].gear).toBe(2);
    expect(shifts(world).map(({ tick }) => tick)).toEqual([0, 4, 8]);
    expect(world.journal.filter(({ kind }) => kind === 'controls')).toHaveLength(1);
    expect(queue.stats.duplicates).toBe(6);
  });

  it('does not invent a first edge for partially or completely late commands', () => {
    const world = new AuthoritativeWorld(OPTIONS),
      queue = new ServerInputQueue(),
      shift = vi.spyOn(world.sim.cars[0], 'shift');
    driveUntil(world, queue, 2);
    queue.accept([command(0, 0, 1), command(1, 1, 7), command(2, 8, 4)], world.tick);
    driveUntil(world, queue, 8);
    expect(shift).not.toHaveBeenCalled();
    expect(world.sim.cars[0].gear).toBe(1);
    expect(world.sim.cars[0].autoShift).toBe(true);
    expect(queue.stats.late).toBe(1);
    expect(queue.stats.lateTicks).toBe(2);
    driveUntil(world, queue, 20);
    expect(shift).toHaveBeenCalledExactlyOnceWith(1);
    expect(shifts(world)).toEqual([{ tick: 8, car: 0, kind: 'shift', shift: 1 }]);
  });

  it('holds only level controls across packet loss and accepts the next distinct pulse', () => {
    const world = new AuthoritativeWorld(OPTIONS),
      queue = new ServerInputQueue(),
      first = command(0, 0, 4),
      shift = vi.spyOn(world.sim.cars[0], 'shift');
    queue.accept([first], 0);
    driveUntil(world, queue, 20);
    expect(shift).toHaveBeenCalledTimes(1);
    expect(world.sim.cars[0].gear).toBe(2);
    // Sequence 1 was lost entirely; resending sequence 0 must not revive it.
    queue.accept([first, command(2, 20, 4)], world.tick);
    driveUntil(world, queue, 40);
    expect(shift).toHaveBeenCalledTimes(2);
    expect(world.sim.cars[0].gear).toBe(3);
    expect(shifts(world).map(({ tick }) => tick)).toEqual([0, 20]);
  });

  it('retains a pending edge across later level setters without aliasing the journal', () => {
    const world = new AuthoritativeWorld(OPTIONS),
      input = { ...command(0, 0, 4).controls, throttle: 0.25 },
      shift = vi.spyOn(world.sim.cars[0], 'shift');
    world.setControls(0, input, true);
    const entry = world.journal[0];
    if (entry.kind !== 'controls') throw new Error('expected level controls');
    expect(entry.controls).not.toBe(world.drivers[0].controls);
    expect(world.drivers[0].controls).not.toBe(input);
    input.shift = -1;
    input.throttle = 1;
    world.setControls(0, { ...input, throttle: 0.5 }, false);
    const before = encodeJournal(world.journal);
    world.step();
    world.step();
    expect(shift).toHaveBeenCalledExactlyOnceWith(1);
    expect(encodeJournal(world.journal)).toEqual(before);
    expect(entry.controls.shift).toBe(0);
    expect(entry.controls.throttle).toBe(64 / 255);
    const latest = world.journal[world.journal.length - 1];
    if (latest?.kind !== 'controls') throw new Error('expected latest level controls');
    world.drivers[0].controls.throttle = 0.75;
    expect(latest.controls.throttle).toBe(128 / 255);
    latest.controls.throttle = 0.9;
    expect(world.drivers[0].controls.throttle).toBe(0.75);
  });

  it('discards a pending shift on AI takeover and requires a new first edge after handback', () => {
    const world = new AuthoritativeWorld(OPTIONS),
      input = command(0, 0, 4).controls,
      car = world.sim.cars[0],
      shift = vi.spyOn(car, 'shift');
    world.setControls(0, input, true);
    world.setMode(0, 'ai');
    world.setMode(0, 'human');
    world.step();
    expect(shift).not.toHaveBeenCalled();
    world.setMode(0, 'ai');
    world.setControls(0, input, true);
    world.step();
    expect(world.drivers[0].shiftEdge).toBe(0);
    world.setMode(0, 'human');
    world.setControls(0, input, false); // Rejoin received a late command remainder.
    world.step();
    expect(shift).not.toHaveBeenCalled();
    world.setControls(0, input, true);
    world.step();
    expect(shift).toHaveBeenCalledExactlyOnceWith(1);
    expect(car.gear).toBe(2);
    expect(shifts(world).map(({ tick }) => tick)).toEqual([0, 3]);
    const replay = AuthoritativeWorld.replay(OPTIONS, decodeJournal(encodeJournal(world.journal)), 4);
    expect(replay.stateHash()).toBe(world.stateHash());
  });

  it.each(['pitRequested', 'inPit', 'finishTime'] as const)(
    'does not defer an ignored shift until human control resumes after %s',
    (field) => {
      const world = new AuthoritativeWorld(OPTIONS),
        car = world.sim.cars[0],
        input = command(0, 0, 4).controls;
      if (field === 'finishTime') car.finishTime = 1;
      else car[field] = true;
      world.setControls(0, input, true);
      expect(shifts(world)).toEqual([]);
      if (field === 'finishTime') car.finishTime = 0;
      else car[field] = false;
      world.setControls(0, input, false);
      world.step();
      expect(car.gear).toBe(1);
      expect(car.autoShift).toBe(true);
    },
  );
});

describe('shift journal compatibility', () => {
  it('uses explicit shift tags and reproduces a live record exactly', () => {
    const world = new AuthoritativeWorld(OPTIONS),
      queue = new ServerInputQueue();
    queue.accept([command(0, 0, 4), command(1, 4, 4), command(2, 8, 4, -1)], 0);
    driveUntil(world, queue, 24);
    const bytes = encodeJournal(world.journal),
      decoded = decodeJournal(bytes, journalEntryLimit(world.tick, world.cars)),
      replay = AuthoritativeWorld.replay(OPTIONS, decoded, world.tick);
    expect(decoded).toEqual(world.journal);
    expect(replay.journal).toEqual(world.journal);
    expect(replay.stateHash()).toBe(world.stateHash());
    expect(verifyRecord(createRecord(world))).toMatchObject({
      ok: true,
      ticks: world.tick,
      finalHash: world.stateHash(),
    });
    expect(encodeJournal(shifts(world))).toEqual(
      Uint8Array.of(3, 0, 0, 5, 1, 4, 0, 5, 1, 4, 0, 5, 255),
    );
  });

  it.each([0, 4])('preserves persistent shift semantics of archived control tag %i', (tag) => {
    // Hand-authored archived bytes, independent of the current encoder: one
    // neutral control change with shift +1 and ERS normal, plus optional rear brake.
    const bytes = Uint8Array.from([1, 0, 0, tag, 0, 0, 0, 0, 0, 5, 0, ...(tag === 4 ? [128] : [])]),
      entries = decodeJournal(bytes),
      old = entries[0];
    if (old.kind !== 'controls') throw new Error('expected archived controls');
    expect(old.controls.shift).toBe(1);
    expect(encodeJournal(entries)).toEqual(bytes);
    // Independent reference for the old controller: reapply the same input
    // through Simulation.setInput every tick, including its consumed shift.
    const reference = new Simulation(OPTIONS);
    for (let tick = 0; tick < 12; tick++) {
      reference.setInput(old.controls);
      reference.step(DT);
    }
    const replay = AuthoritativeWorld.replay(OPTIONS, entries, 12);
    expect(replay.sim.cars[0].gear).toBeGreaterThan(2);
    expect(replay.sim.makeFrame()).toEqual(reference.makeFrame());
    expect(replay.journal).toEqual(entries);
    expect(verifyRecord(createRecord(replay))).toMatchObject({ ok: true });
  });

  it('rejects malformed or truncated shift entries and respects the entry bound', () => {
    for (const direction of [0, 2, 127, 128])
      expect(() => decodeJournal(Uint8Array.of(1, 0, 0, 5, direction))).toThrow(/Invalid shift edge/);
    expect(() => decodeJournal(Uint8Array.of(1, 0, 0, 5))).toThrow(/truncated/);
    expect(() => decodeJournal(Uint8Array.of(1, 0, 0, 6))).toThrow(/Unknown journal entry/);
    expect(() => decodeJournal(Uint8Array.of(1, 0, 0, 5, 1), 0)).toThrow(/too long/);
    expect(() =>
      encodeJournal([{ tick: 0, car: 0, kind: 'shift', shift: 0 } as unknown as JournalEntry]),
    ).toThrow(/Invalid shift edge/);
  });
});

describe('shift edges across real client and server delivery', () => {
  it('clears rejected samples while retaining levels and allows later identical shift pulses', () => {
    const invalid = { ...controls(), throttle: NaN },
      valid = { ...controls(), throttle: 0.25, shift: 1, manualClutch: true, clutch: 1 },
      sampled: { tick: number; valid: boolean }[] = [];
    let next: Controls = valid;
    const f = onlineFixture({
      capacity: 1,
      session: { circuit: 'vellamar', ruleset: 'gp-motorcycle', vehicles: ['gpr1'] },
      link: { ...PERFECT_LINK, duplicate: 1 },
      server: { timeouts: { gridCountdownMs: 1 } },
    });
    const { client } = f.connect('Manual rider', {
      vehicle: 'gpr1',
      input: ({ tick }) => {
        const value = next;
        sampled.push({ tick, valid: value === valid });
        next = invalid;
        return value;
      },
    });
    const issue = vi.spyOn(client.commands, 'issue');
    try {
      f.loop.runUntil(300);
      const world = f.server.world!;
      expect(world.sim.cars[0].gear).toBe(2);
      expect(shifts(world)).toHaveLength(1);
      next = valid;
      f.loop.runUntil(600);
      expect(world.sim.cars[0].gear).toBe(3);
      expect(shifts(world)).toHaveLength(2);
      expect(client.stats.rejectedSamples).toBeGreaterThan(20);
      expect(f.server.inputStats()[0].duplicates).toBeGreaterThan(0);
      // Snapshot acknowledgements may prune these commands before the test
      // finishes, so observe the actual issued objects at their boundary.
      expect(issue.mock.results).toHaveLength(sampled.length);
      sampled.forEach((sample, index) => {
        const issued = issue.mock.results[index].value as InputCommand;
        expect(issued.tick).toBe(sample.tick);
        expect(issued.controls.shift).toBe(sample.valid ? 1 : 0);
        expect(issued.controls.throttle).toBe(64 / 255);
        expect(issued.controls.manualClutch).toBe(true);
      });
      expect(world.drivers[0].controls.shift).toBe(0);
      expect(verifyRecord(createRecord(world))).toMatchObject({ ok: true });
    } finally {
      client.dispose();
      f.server.teardown();
    }
  });

  it('does not revive a disconnected driver\'s shift while waiting for a rejoin command', () => {
    const f = onlineFixture({
      capacity: 1,
      session: { circuit: 'vellamar', ruleset: 'gp-motorcycle', vehicles: ['gpr1'] },
      link: PERFECT_LINK,
      server: {
        timeouts: { gridCountdownMs: 1, inputStarvationMs: 50, disconnectMs: 100 },
      },
    });
    let first = true;
    const original = f.connect('Original rider', {
      vehicle: 'gpr1',
      input: () => {
        const input = { ...controls(), shift: first ? 1 : 0, manualClutch: true, clutch: 1 };
        first = false;
        return input;
      },
    });
    let replacement: ReturnType<typeof f.connect> | undefined;
    try {
      f.loop.runUntil(300);
      const world = f.server.world!;
      expect(shifts(world)).toHaveLength(1);
      expect(world.sim.cars[0].gear).toBe(2);
      original.link.sever();
      original.client.dispose();
      f.loop.runUntil(600);
      expect(f.server.playerByCar(0)).toMatchObject({ connected: false, mode: 'ai' });
      expect(shifts(world)).toHaveLength(1);
      let pulse = false;
      replacement = f.connect('Returning rider', {
        vehicle: 'gpr1',
        token: original.client.token,
        input: () => {
          const input = { ...controls(), shift: pulse ? 1 : 0, manualClutch: true, clutch: 1 };
          pulse = false;
          return input;
        },
      });
      f.loop.runUntil(610);
      expect(f.server.playerByCar(0)).toMatchObject({ connected: true, mode: 'ai' });
      expect(shifts(world)).toHaveLength(1);
      f.loop.runUntil(850);
      expect(f.server.playerByCar(0)).toMatchObject({ connected: true, mode: 'human' });
      expect(shifts(world)).toHaveLength(1);
      pulse = true;
      f.loop.runUntil(1100);
      expect(shifts(world)).toHaveLength(2);
      expect(world.sim.cars[0].gear).toBe(3);
      expect(verifyRecord(createRecord(world))).toMatchObject({ ok: true });
    } finally {
      original.client.dispose();
      replacement?.client.dispose();
      f.server.teardown();
    }
  });
});
