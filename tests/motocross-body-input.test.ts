import { afterEach, describe, expect, it, vi } from 'vitest';
import { InputController, type TouchAction } from '../src/input/controller.ts';
import { DEFAULT_BINDINGS, validateBindings } from '../src/input/bindings.ts';
import { DEFAULT_SETTINGS } from '../src/storage/data.ts';
import { controls } from '../src/simulation/config.ts';
import { InputLog } from '../src/core/flashback.ts';
import { ByteReader, ByteWriter } from '../src/net/bytes.ts';
import {
  CONTROLS_WIRE_BYTES,
  quantizeControls,
  readControls,
  sameControls,
  sanitizeControls,
  writeControls,
} from '../src/net/input.ts';
import { decodeJournal, encodeJournal, type JournalEntry } from '../src/net/authority.ts';

class InputTarget extends EventTarget {
  matches() {
    return false;
  }
  setPointerCapture() {}
}

function setup(axis = 0, standard = true) {
  const window = new InputTarget();
  const pad = {
    id: 'Body control fixture',
    index: 0,
    connected: true,
    mapping: standard ? 'standard' : '',
    axes: [0, 0, 0, axis],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
  };
  vi.stubGlobal('window', window);
  vi.stubGlobal('navigator', { getGamepads: () => [pad] });
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.mapping.device = { id: pad.id, index: 0 };
  const action = vi.fn();
  const input = new InputController(settings, action);
  input.setEnabled(true);
  const key = (code: string, down = true) =>
    window.dispatchEvent(
      Object.assign(new Event(down ? 'keydown' : 'keyup', { cancelable: true }), {
        code,
        repeat: false,
      }),
    );
  return { input, settings, window, pad, key, action };
}

afterEach(() => vi.unstubAllGlobals());

describe('motocross body input through the ordinary controller', () => {
  it('holds remappable weight independently of steering and throttle, then releases it', () => {
    const f = setup();
    f.settings.bindings.riderForward = 'KeyU';
    f.settings.bindings.riderBack = 'KeyJ';
    f.key('KeyW');
    f.key('KeyD');
    f.key('KeyU');
    expect(f.input.update(0.2)).toMatchObject({ throttle: 1, brake: 0, riderLean: 1 });
    expect(f.input.state.steer).toBeLessThan(0);
    f.key('KeyJ');
    expect(f.input.update(0.2).riderLean).toBe(0);
    f.key('KeyU', false);
    expect(f.input.update(0.2).riderLean).toBe(-1);
    f.key('KeyJ', false);
    expect(f.input.update(0.2)).toMatchObject({ throttle: 1, riderLean: 0 });
    expect(f.action).not.toHaveBeenCalled();
    f.input.dispose();
  });

  it('reads the standard right stick with a deadzone and lets held keys own the axis', () => {
    const f = setup(-1);
    expect(f.input.update(1 / 60)).toMatchObject({ riderLean: 1, throttle: 0, brake: 0 });
    expect(Math.abs(f.input.state.steer)).toBe(0);
    f.pad.axes[3] = 0.54;
    expect(f.input.update(1 / 60).riderLean).toBeCloseTo(-0.5, 6);
    f.pad.axes[3] = 0.04;
    expect(f.input.update(1 / 60).riderLean).toBe(0);
    f.pad.axes[3] = 1;
    f.key('KeyQ');
    expect(f.input.update(1 / 60).riderLean).toBe(1);
    f.key('KeyZ');
    expect(f.input.update(1 / 60).riderLean).toBe(0);
    f.key('KeyQ', false);
    f.key('KeyZ', false);
    expect(f.input.update(1 / 60).riderLean).toBe(-1);
    f.input.dispose();
  });

  it('does not interpret custom wheels, missing sticks or occupied axes as rider weight', () => {
    const f = setup(-1, false);
    expect(f.input.update(1 / 60).riderLean).toBe(0);
    f.pad.mapping = 'standard';
    f.settings.mapping.wheelSteering = true;
    expect(f.input.update(1 / 60).riderLean).toBe(0);
    f.settings.mapping.wheelSteering = false;
    f.settings.mapping.steerAxis = 3;
    expect(f.input.update(1 / 60).riderLean).toBe(0);
    f.settings.mapping.steerAxis = 0;
    f.settings.mapping.axisPedals = true;
    f.settings.mapping.throttleAxis = 3;
    f.settings.mapping.brakeAxis = 1;
    expect(f.input.update(1 / 60).riderLean).toBe(0);
    f.settings.mapping.axisPedals = false;
    f.settings.mapping.manualClutch = true;
    f.settings.mapping.clutchAxis = 3;
    expect(f.input.update(1 / 60).riderLean).toBe(0);
    f.settings.mapping.manualClutch = false;
    f.pad.axes.length = 1;
    expect(f.input.update(1 / 60).riderLean).toBe(0);
    f.input.dispose();
  });

  it('releases touch weight on pointer loss, pause and blur without leaving a held control', () => {
    const f = setup();
    const touch = (action: TouchAction, id: number) => {
      const target = new InputTarget();
      f.input.bindTouch(target as unknown as HTMLElement, action);
      const down = () =>
        target.dispatchEvent(
          Object.assign(new Event('pointerdown', { cancelable: true }), { pointerId: id }),
        );
      return { target, down };
    };
    const forward = touch('riderForward', 1),
      back = touch('riderBack', 2);
    forward.down();
    expect(f.input.update(1 / 60).riderLean).toBe(1);
    back.down();
    expect(f.input.update(1 / 60).riderLean).toBe(0);
    back.target.dispatchEvent(new Event('pointercancel'));
    expect(f.input.update(1 / 60).riderLean).toBe(1);
    forward.target.dispatchEvent(new Event('lostpointercapture'));
    expect(f.input.update(1 / 60).riderLean).toBe(0);
    back.down();
    f.input.setEnabled(false);
    expect(f.input.update(1 / 60).riderLean).toBe(0);
    f.input.setEnabled(true);
    forward.down();
    f.window.dispatchEvent(new Event('blur'));
    expect(f.input.update(1 / 60).riderLean).toBe(0);
    expect(f.action).toHaveBeenLastCalledWith('blur');
    f.input.dispose();
  });

  it('migrates saved bindings without taking keys that a player already assigned', () => {
    const { riderForward: _forward, riderBack: _back, ...old } = DEFAULT_BINDINGS;
    void _forward;
    void _back;
    const migrated = validateBindings({ ...old, throttle: 'KeyQ', brake: 'KeyZ' });
    expect(migrated.throttle).toBe('KeyQ');
    expect(migrated.brake).toBe('KeyZ');
    expect(migrated.riderForward).not.toBe('KeyQ');
    expect(migrated.riderBack).not.toBe('KeyZ');
    expect(new Set(Object.values(migrated)).size).toBe(21);
  });

  it('preserves a saved layout that occupies every preferred body-control migration key', () => {
    const { riderForward: _forward, riderBack: _back, ...old } = DEFAULT_BINDINGS;
    void _forward;
    void _back;
    const saved = {
      ...old,
      throttle: 'KeyQ',
      brake: 'KeyU',
      left: 'KeyY',
      right: 'KeyH',
      clutch: 'KeyI',
      reverse: 'Digit8',
      shiftDown: 'KeyZ',
      shiftUp: 'KeyV',
      camera: 'KeyN',
      pit: 'KeyJ',
      ers: 'KeyK',
      replay: 'Digit9',
    };
    const migrated = validateBindings(saved);
    expect(migrated).toMatchObject(saved);
    expect(new Set(Object.values(migrated)).size).toBe(21);
    expect(Object.values(saved)).not.toContain(migrated.riderForward);
    expect(Object.values(saved)).not.toContain(migrated.riderBack);
  });
});

describe('body weight across input journals and network controls', () => {
  it('records weight-only changes and a release, while old absent controls remain neutral', () => {
    const log = new InputLog(),
      neutral = controls();
    const old = { ...neutral };
    delete old.riderLean;
    log.input(0, old);
    log.input(1, neutral);
    log.input(2, { ...neutral, riderLean: 1 });
    log.input(3, { ...neutral, riderLean: 1 });
    log.input(4, { ...neutral, riderLean: -1 });
    log.input(5, neutral);
    expect(log.entries.map((e) => e.tick)).toEqual([0, 2, 4, 5]);
    log.truncate(4);
    log.input(4, { ...neutral, riderLean: 1 });
    log.input(5, old);
    expect(log.entries.map((e) => e.tick)).toEqual([0, 2, 5]);
    expect(sameControls(old, neutral)).toBe(true);
    expect(sameControls(neutral, { ...neutral, riderLean: 1 })).toBe(false);
  });

  it('rejects invalid weight inputs and bounds signed lean without touching the pedals', () => {
    for (const riderLean of [NaN, Infinity, -Infinity, '1', null])
      expect(sanitizeControls({ ...controls(), riderLean }).ok).toBe(false);
    const result = sanitizeControls({ ...controls(), riderLean: -7, throttle: 0.4 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.controls).toMatchObject({ riderLean: -1, throttle: 0.4, brake: 0 });
    expect(result.clamped).toEqual(['riderLean']);
    expect(sanitizeControls({}).ok).toBe(true);
  });

  it('round-trips independent analog weight in the existing seven-byte control budget', () => {
    for (const lean of [-1, -0.83, -0.1, 0, 0.07, 0.58, 1]) {
      const sample = {
        ...controls(),
        throttle: 0.8,
        brake: 0.2,
        steer: -0.4,
        riderLean: lean,
        drs: true,
        pit: true,
      };
      const writer = new ByteWriter();
      writeControls(writer, sample);
      expect(writer.finish().byteLength).toBe(CONTROLS_WIRE_BYTES);
      expect(CONTROLS_WIRE_BYTES).toBe(7);
      const decoded = readControls(new ByteReader(writer.finish()));
      expect(decoded.riderLean).toBeCloseTo(lean, 1);
      expect(Math.abs(decoded.riderLean! - lean)).toBeLessThanOrEqual(1 / 126);
      expect(decoded).toMatchObject({ drs: true, pit: true });
      expect(decoded.throttle).toBeCloseTo(0.8, 3);
      expect(decoded.brake).toBeCloseTo(0.2, 3);
      expect(quantizeControls(decoded)).toEqual(decoded);
    }
    const malformed = new Uint8Array(7);
    malformed[6] = 0x80; // Reserved signed -64: outside the rider's travel.
    expect(() => readControls(new ByteReader(malformed))).toThrow('rider lean out of range');
  });

  it('preserves weight-only changes in the authoritative binary journal', () => {
    const entries: JournalEntry[] = [0, 0.5, -1, 0].map((riderLean, index) => ({
      tick: index * 30,
      car: 0,
      kind: 'controls',
      controls: quantizeControls({ ...controls(), throttle: 0.6, riderLean }),
    }));
    expect(decodeJournal(encodeJournal(entries))).toEqual(entries);
  });
});
