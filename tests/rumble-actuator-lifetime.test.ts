import { describe, expect, it, vi } from 'vitest';
import { Rumble } from '../src/input/rumble.ts';

type EffectResult = 'complete' | 'preempted';
const loud = { weak: 0.6, strong: 0.3 };
const quiet = { weak: 0, strong: 0 };

function deferred() {
  let resolve!: (value: EffectResult) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<EffectResult>((ready, failed) => {
    resolve = ready;
    reject = failed;
  });
  return { promise, resolve, reject };
}

function device() {
  const actuator = {
    playEffect: vi.fn((_type: string, _effect: GamepadEffectParameters) =>
      Promise.resolve<EffectResult>('complete'),
    ),
    reset: vi.fn(() => Promise.resolve<EffectResult>('complete')),
  };
  const pad = { vibrationActuator: actuator } as unknown as Gamepad;
  return { pad, actuator };
}

async function settled() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('rumble actuator lifetime', () => {
  it('stops the actuator that received output when the selected pad has disconnected', () => {
    const a = device(),
      rumble = new Rumble();
    rumble.update(a.pad, loud, 0);
    rumble.stop(null);
    expect(a.actuator.reset).toHaveBeenCalledTimes(1);
    rumble.stop(null);
    expect(a.actuator.reset).toHaveBeenCalledTimes(1);
  });

  it('does not reset an unrelated replacement supplied to stop', () => {
    const a = device(),
      b = device(),
      rumble = new Rumble();
    rumble.update(a.pad, loud, 0);
    rumble.stop(b.pad);
    expect(a.actuator.reset).toHaveBeenCalledTimes(1);
    expect(b.actuator.reset).not.toHaveBeenCalled();
  });

  it.each(['missing pad', 'missing actuator', 'unsupported actuator'] as const)(
    'retires existing output when an update observes a %s',
    (kind) => {
      const a = device(),
        rumble = new Rumble();
      const absent =
        kind === 'missing pad'
          ? null
          : ({
              vibrationActuator: kind === 'missing actuator' ? null : {},
            } as unknown as Gamepad);
      rumble.update(a.pad, loud, 0);
      rumble.update(absent, loud, 10);
      rumble.update(absent, loud, 20);
      expect(a.actuator.reset).toHaveBeenCalledTimes(1);
      rumble.stop(null);
      expect(a.actuator.reset).toHaveBeenCalledTimes(1);
    },
  );

  it('stops the previous device and gives a replacement its own immediate first effect', () => {
    const a = device(),
      b = device(),
      rumble = new Rumble();
    rumble.update(a.pad, loud, 1000);
    rumble.update(b.pad, loud, 1020);
    expect(a.actuator.reset).toHaveBeenCalledTimes(1);
    expect(b.actuator.playEffect).toHaveBeenCalledTimes(1);
    rumble.update(b.pad, loud, 1080);
    expect(b.actuator.playEffect).toHaveBeenCalledTimes(1);
    rumble.update(b.pad, loud, 1120);
    expect(b.actuator.playEffect).toHaveBeenCalledTimes(2);
    rumble.stop(null);
    expect(b.actuator.reset).toHaveBeenCalledTimes(1);
  });

  it('keeps cadence when a new Gamepad wrapper exposes the same actuator', () => {
    const a = device(),
      rumble = new Rumble();
    const wrapper = { vibrationActuator: a.pad.vibrationActuator } as Gamepad;
    rumble.update(a.pad, loud, 0);
    rumble.update(wrapper, loud, 50);
    expect(a.actuator.playEffect).toHaveBeenCalledTimes(1);
    expect(a.actuator.reset).not.toHaveBeenCalled();
    rumble.update(wrapper, loud, 100);
    expect(a.actuator.playEffect).toHaveBeenCalledTimes(2);
  });

  it('stops the previous actuator even when the replacement requests silence', () => {
    const a = device(),
      b = device(),
      rumble = new Rumble();
    rumble.update(a.pad, loud, 0);
    rumble.update(b.pad, quiet, 1);
    expect(a.actuator.reset).toHaveBeenCalledTimes(1);
    expect(b.actuator.playEffect).not.toHaveBeenCalled();
    rumble.stop(b.pad);
    expect(b.actuator.reset).not.toHaveBeenCalled();
  });

  it('preserves effect parameters, normal 10 Hz cadence and a single quiet transition', () => {
    const a = device(),
      rumble = new Rumble();
    rumble.update(a.pad, quiet, 0);
    expect(a.actuator.playEffect).not.toHaveBeenCalled();
    rumble.update(a.pad, loud, 1);
    expect(a.actuator.playEffect).toHaveBeenLastCalledWith('dual-rumble', {
      duration: 120,
      weakMagnitude: 0.6,
      strongMagnitude: 0.3,
    });
    rumble.update(a.pad, quiet, 50);
    expect(a.actuator.playEffect).toHaveBeenCalledTimes(1);
    rumble.update(a.pad, { weak: 0.019, strong: 0.019 }, 101);
    expect(a.actuator.playEffect).toHaveBeenLastCalledWith('dual-rumble', {
      duration: 120,
      weakMagnitude: 0,
      strongMagnitude: 0,
    });
    rumble.update(a.pad, quiet, 201);
    expect(a.actuator.playEffect).toHaveBeenCalledTimes(2);
  });

  it('contains a synchronous play failure, stops any previous effect and allows retry', () => {
    const a = device(),
      rumble = new Rumble();
    rumble.update(a.pad, loud, 0);
    a.actuator.playEffect.mockImplementationOnce(() => {
      throw new Error('disconnected');
    });
    expect(() => rumble.update(a.pad, quiet, 100)).not.toThrow();
    expect(a.actuator.reset).toHaveBeenCalledTimes(1);
    rumble.update(a.pad, loud, 101);
    expect(a.actuator.playEffect).toHaveBeenCalledTimes(3);
  });

  it('retires a rejected current effect without retaining its rate limit', async () => {
    const a = device(),
      pending = deferred(),
      rumble = new Rumble();
    a.actuator.playEffect.mockReturnValueOnce(pending.promise);
    rumble.update(a.pad, loud, 0);
    pending.reject(new Error('output failed'));
    await settled();
    expect(a.actuator.reset).toHaveBeenCalledTimes(1);
    rumble.update(a.pad, loud, 10);
    expect(a.actuator.playEffect).toHaveBeenCalledTimes(2);
  });

  it('ignores an old device rejection after output moved to another actuator', async () => {
    const a = device(),
      b = device(),
      pending = deferred(),
      rumble = new Rumble();
    a.actuator.playEffect.mockReturnValueOnce(pending.promise);
    rumble.update(a.pad, loud, 0);
    rumble.update(b.pad, loud, 100);
    pending.reject(new Error('old device lost'));
    await settled();
    expect(a.actuator.reset).toHaveBeenCalledTimes(1);
    expect(b.actuator.reset).not.toHaveBeenCalled();
    rumble.stop(null);
    expect(b.actuator.reset).toHaveBeenCalledTimes(1);
  });

  it('ignores an older rejection after a newer effect on the same actuator', async () => {
    const a = device(),
      pending = deferred(),
      rumble = new Rumble();
    a.actuator.playEffect.mockReturnValueOnce(pending.promise);
    rumble.update(a.pad, loud, 0);
    rumble.update(a.pad, loud, 100);
    pending.reject(new Error('superseded request'));
    await settled();
    expect(a.actuator.reset).not.toHaveBeenCalled();
    rumble.stop(null);
    expect(a.actuator.reset).toHaveBeenCalledTimes(1);
  });

  it.each(['resolve', 'reject'] as const)(
    'a late %s after stop does not reclaim output',
    async (kind) => {
      const a = device(),
        pending = deferred(),
        rumble = new Rumble();
      a.actuator.playEffect.mockReturnValueOnce(pending.promise);
      rumble.update(a.pad, loud, 0);
      rumble.stop(a.pad);
      if (kind === 'resolve') pending.resolve('complete');
      else pending.reject(new Error('stopped request'));
      await settled();
      expect(a.actuator.reset).toHaveBeenCalledTimes(1);
      rumble.update(a.pad, loud, 1);
      expect(a.actuator.playEffect).toHaveBeenCalledTimes(2);
    },
  );

  it.each(['throw', 'reject'] as const)(
    'contains a reset %s and still starts the replacement',
    async (kind) => {
      const a = device(),
        b = device(),
        rumble = new Rumble();
      a.actuator.reset.mockImplementation(() => {
        if (kind === 'throw') throw new Error('reset failed');
        return Promise.reject(new Error('reset failed'));
      });
      rumble.update(a.pad, loud, 0);
      expect(() => rumble.update(b.pad, loud, 10)).not.toThrow();
      await settled();
      expect(a.actuator.reset).toHaveBeenCalledTimes(1);
      expect(b.actuator.playEffect).toHaveBeenCalledTimes(1);
      rumble.stop(b.pad);
      expect(b.actuator.reset).toHaveBeenCalledTimes(1);
    },
  );

  it('rebases a regressing clock without suppressing output until the old time catches up', () => {
    const a = device(),
      rumble = new Rumble();
    rumble.update(a.pad, loud, 1000);
    rumble.update(a.pad, loud, -10);
    expect(a.actuator.playEffect).toHaveBeenCalledTimes(2);
    rumble.update(a.pad, loud, 40);
    expect(a.actuator.playEffect).toHaveBeenCalledTimes(2);
    rumble.update(a.pad, loud, 90);
    expect(a.actuator.playEffect).toHaveBeenCalledTimes(3);
  });

  it.each([NaN, Infinity, -Infinity])(
    'ignores invalid clock %s without poisoning the next deadline',
    (now) => {
      const a = device(),
        rumble = new Rumble();
      rumble.update(a.pad, loud, 0);
      rumble.update(a.pad, loud, now);
      expect(a.actuator.playEffect).toHaveBeenCalledTimes(1);
      rumble.update(a.pad, loud, 50);
      expect(a.actuator.playEffect).toHaveBeenCalledTimes(1);
      rumble.update(a.pad, loud, 100);
      expect(a.actuator.playEffect).toHaveBeenCalledTimes(2);
    },
  );

  it('clears ownership even when the device has no reset method', () => {
    const a = device(),
      b = device(),
      rumble = new Rumble();
    Reflect.deleteProperty(a.actuator, 'reset');
    rumble.update(a.pad, loud, 0);
    expect(() => rumble.stop(null)).not.toThrow();
    rumble.update(b.pad, loud, 1);
    expect(b.actuator.playEffect).toHaveBeenCalledTimes(1);
  });

  it('revokes ownership before reset so a reentrant stop cannot reset twice', () => {
    const a = device(),
      rumble = new Rumble();
    a.actuator.reset.mockImplementation(() => {
      rumble.stop(null);
      return Promise.resolve<EffectResult>('complete');
    });
    rumble.update(a.pad, loud, 0);
    rumble.stop(null);
    expect(a.actuator.reset).toHaveBeenCalledTimes(1);
  });

  it('a throwing old play callback cannot stop a replacement started reentrantly', () => {
    const a = device(),
      b = device(),
      rumble = new Rumble();
    a.actuator.playEffect.mockImplementationOnce(() => {
      rumble.update(b.pad, loud, 100);
      throw new Error('old actuator failed');
    });
    expect(() => rumble.update(a.pad, loud, 0)).not.toThrow();
    expect(a.actuator.reset).toHaveBeenCalledTimes(1);
    expect(b.actuator.playEffect).toHaveBeenCalledTimes(1);
    expect(b.actuator.reset).not.toHaveBeenCalled();
    rumble.stop(null);
    expect(b.actuator.reset).toHaveBeenCalledTimes(1);
  });
});
