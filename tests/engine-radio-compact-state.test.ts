import { afterEach, describe, expect, it, vi } from 'vitest';
import { RadioArbiter, URGENCY, type RadioMessage } from '../src/core/radio.ts';
import { FLAG } from '../src/simulation/marshal.ts';
import { CAR_STRIDE, F, H, HEADER, carBase } from '../src/simulation/protocol.ts';
import { SC_PHASE } from '../src/simulation/safety-car.ts';

const player = carBase(0);
const snapshot = (time: number, cars = 24) => {
  const frame = new Float32Array(HEADER + cars * CAR_STRIDE);
  frame[H.TIME] = time;
  frame[H.CARS] = cars;
  frame[H.LENGTH] = 3000;
  frame[player + F.FUEL] = 50;
  return frame;
};

const transitions: {
  name: string;
  change: (frame: Float32Array) => void;
  expected: RadioMessage;
}[] = [
  {
    name: 'virtual safety car',
    change: (f) => {
      f[H.SC_PHASE] = SC_PHASE.VSC;
    },
    expected: {
      key: 'sc-1',
      speaker: 'RACE CONTROL',
      urgency: URGENCY.RACE_CONTROL,
      text: 'Virtual safety car. Hold the delta speed, no overtaking.',
      expires: 9,
      hold: 4,
    },
  },
  {
    name: 'deployed safety car',
    change: (f) => {
      f[H.SC_PHASE] = SC_PHASE.DEPLOYED;
    },
    expected: {
      key: 'sc-2',
      speaker: 'RACE CONTROL',
      urgency: URGENCY.RACE_CONTROL,
      text: 'Safety car deployed. Close up behind it, no overtaking.',
      expires: 9,
      hold: 4,
    },
  },
  {
    name: 'safety car in this lap',
    change: (f) => {
      f[H.SC_PHASE] = SC_PHASE.IN_THIS_LAP;
    },
    expected: {
      key: 'sc-3',
      speaker: 'RACE CONTROL',
      urgency: URGENCY.RACE_CONTROL,
      text: 'Safety car in this lap. Racing resumes at the line.',
      expires: 9,
      hold: 4,
    },
  },
  {
    name: 'yellow flag with rounded control sequence',
    change: (f) => {
      f[player + F.LOCAL_FLAG] = FLAG.YELLOW;
      f[player + F.CONTROL_SEQUENCE] = 1.6;
    },
    expected: {
      key: 'yellow-2',
      speaker: 'RACE CONTROL',
      urgency: URGENCY.RACE_CONTROL,
      text: 'Yellow flag ahead. Lift and do not overtake until the green.',
      expires: 6,
      hold: 3,
    },
  },
  {
    name: 'double yellow flag',
    change: (f) => {
      f[player + F.LOCAL_FLAG] = FLAG.DOUBLE_YELLOW;
      f[player + F.CONTROL_SEQUENCE] = 3;
    },
    expected: {
      key: 'yellow-3',
      speaker: 'RACE CONTROL',
      urgency: URGENCY.RACE_CONTROL,
      text: 'Double yellow ahead. Slow right down, no overtaking, be ready to stop.',
      expires: 6,
      hold: 3,
    },
  },
  {
    name: 'blue flag',
    change: (f) => {
      f[player + F.LOCAL_FLAG] = FLAG.BLUE;
    },
    expected: {
      key: 'blue',
      speaker: 'RACE CONTROL',
      urgency: URGENCY.WARNING,
      text: 'Blue flag: a lapping car is behind. Let it through cleanly.',
      expires: 7,
      hold: 3,
    },
  },
  {
    name: 'time penalty',
    change: (f) => {
      f[player + F.PENALTY] = 5.5;
      f[player + F.CONTROL_PENALTIES] = 2;
    },
    expected: {
      key: 'penalty-2',
      speaker: 'RACE CONTROL',
      urgency: URGENCY.RACE_CONTROL,
      text: 'Time penalty +6 s, added to your race time at the flag. Respect track limits, flags and the pit speed limit to avoid more.',
      expires: 11,
      hold: 5,
    },
  },
  {
    name: 'track limits warning',
    change: (f) => {
      f[player + F.WARNINGS] = 2.5;
    },
    expected: {
      key: 'limits-2.5',
      speaker: 'RACE CONTROL',
      urgency: URGENCY.WARNING,
      text: 'Track limits warning 3. Keep two wheels inside the white lines; repeated offences are penalised.',
      expires: 7,
      hold: 3,
    },
  },
  {
    name: 'pit entry',
    change: (f) => {
      f[player + F.IN_PIT] = 1;
    },
    expected: {
      key: 'pit-limit',
      speaker: 'ENGINEER',
      urgency: URGENCY.WARNING,
      text: 'Pit entry. Limiter is automatic: 80 km/h until the exit line.',
      expires: 7,
      hold: 3,
    },
  },
  {
    name: 'final lap',
    change: (f) => {
      f[player + F.LAPS] = 4;
    },
    expected: {
      key: 'final-lap',
      speaker: 'ENGINEER',
      urgency: URGENCY.STRATEGY,
      text: 'Final lap. Bring it home.',
      expires: 11,
      hold: 3,
    },
  },
  {
    name: 'fuel margin crossing',
    change: (f) => {
      f[player + F.FUEL] = 5;
    },
    expected: {
      key: 'fuel',
      speaker: 'ENGINEER',
      urgency: URGENCY.STRATEGY,
      text: 'Fuel is marginal for 5 laps. Lift and coast into the braking zones.',
      expires: 16,
      hold: 4,
    },
  },
];

afterEach(() => vi.restoreAllMocks());

describe.each(['fresh', 'reused', 'transferred'] as const)(
  'radio with %s snapshot buffers',
  (ownership) => {
    it.each(transitions)('preserves the complete $name caption', ({ change, expected }) => {
      const radio = new RadioArbiter();
      const first = snapshot(0);
      expect(radio.observe(first, 5)).toBeNull();
      const next =
        ownership === 'fresh'
          ? snapshot(1)
          : ownership === 'reused'
            ? first
            : structuredClone(first, { transfer: [first.buffer] });
      if (ownership === 'transferred') expect(first.byteLength).toBe(0);
      next[H.TIME] = 1;
      change(next);
      expect(radio.observe(next, 5)).toEqual(expected);
    });
  },
);

describe('compact radio transition history', () => {
  it('keeps offer order, equal-priority order, holds and expiry for simultaneous events', () => {
    const radio = new RadioArbiter();
    const frame = snapshot(0);
    radio.observe(frame, 5);
    const post = vi.spyOn(radio, 'post');
    frame[H.TIME] = 1;
    frame[H.SC_PHASE] = SC_PHASE.VSC;
    frame[player + F.LOCAL_FLAG] = FLAG.YELLOW;
    frame[player + F.CONTROL_SEQUENCE] = 7;
    frame[player + F.PENALTY] = 5;
    frame[player + F.CONTROL_PENALTIES] = 2;
    frame[player + F.WARNINGS] = 3;
    frame[player + F.IN_PIT] = 1;
    frame[player + F.LAPS] = 4;
    frame[player + F.FUEL] = 1;
    expect(radio.observe(frame, 5)?.key).toBe('sc-1');
    expect(post.mock.calls.map(([message]) => message.key)).toEqual([
      'sc-1',
      'yellow-7',
      'penalty-2',
      'limits-3',
      'pit-limit',
      'final-lap',
      'fuel',
    ]);
    expect(radio.update(4)?.key).toBe('sc-1');
    expect(radio.update(5)?.key).toBe('yellow-7');
    expect(radio.update(6)?.key).toBe('yellow-7');
    expect(radio.update(7)?.key).toBe('penalty-2');
    expect(radio.update(12)?.key).toBe('fuel');
    expect(radio.update(16)).toBeNull();
  });

  it('takes a silent baseline on the first frame and every changed car count', () => {
    const radio = new RadioArbiter();
    const first = snapshot(0, 1);
    first[H.SC_PHASE] = SC_PHASE.VSC;
    first[player + F.LOCAL_FLAG] = FLAG.YELLOW;
    first[player + F.PENALTY] = 5;
    first[player + F.WARNINGS] = 2;
    first[player + F.IN_PIT] = 1;
    first[player + F.LAPS] = 4;
    first[player + F.FUEL] = 1;
    expect(radio.observe(first, 5)).toBeNull();
    const changedCount = snapshot(1, 2);
    changedCount[H.SC_PHASE] = SC_PHASE.DEPLOYED;
    changedCount[player + F.LOCAL_FLAG] = FLAG.DOUBLE_YELLOW;
    changedCount[player + F.PENALTY] = 10;
    changedCount[player + F.WARNINGS] = 3;
    expect(radio.observe(changedCount, 5)).toBeNull();
    changedCount[H.TIME] = 2;
    expect(radio.observe(changedCount, 5)).toBeNull();
    changedCount[H.TIME] = 3;
    changedCount[H.SC_PHASE] = SC_PHASE.IN_THIS_LAP;
    expect(radio.observe(changedCount, 5)?.key).toBe('sc-3');
    const changedAgain = snapshot(4, 1);
    expect(radio.observe(changedAgain, 5)?.key).toBe('sc-3');
    changedAgain[H.TIME] = 8;
    expect(radio.observe(changedAgain, 5)).toBeNull();
  });

  it('uses the prior penalty total even when the source is overwritten before transfer', () => {
    const radio = new RadioArbiter();
    const previous = snapshot(0);
    previous[player + F.PENALTY] = 5;
    radio.observe(previous, 5);
    previous.fill(0);
    structuredClone(previous.buffer, { transfer: [previous.buffer] });
    const next = snapshot(1);
    next[player + F.PENALTY] = 8;
    next[player + F.CONTROL_PENALTIES] = 2;
    expect(radio.observe(next, 5)?.text).toContain('Time penalty +3 s,');
  });

  it('keeps engineer muting independent of race-control transitions', () => {
    const radio = new RadioArbiter({ engineer: false });
    const frame = snapshot(0);
    radio.observe(frame, 5);
    frame[H.TIME] = 1;
    frame[player + F.IN_PIT] = 1;
    frame[player + F.LAPS] = 4;
    frame[player + F.FUEL] = 1;
    expect(radio.observe(frame, 5)).toBeNull();
    frame[H.TIME] = 2;
    frame[player + F.LOCAL_FLAG] = FLAG.BLUE;
    expect(radio.observe(frame, 5)?.key).toBe('blue');
  });

  it('does not copy packed frames across 600 ordinary 24-car observations', () => {
    const radio = new RadioArbiter();
    const frame = snapshot(0);
    const slice = vi.spyOn(Float32Array.prototype, 'slice');
    for (let i = 0; i < 600; i++) {
      frame[H.TIME] = i / 60;
      radio.observe(frame, 5);
    }
    expect(slice).not.toHaveBeenCalled();
  });
});

describe('radio cooldown timeline policy', () => {
  const message = (now: number): RadioMessage => ({
    key: 'yellow-1',
    speaker: 'RACE CONTROL',
    text: 'yellow',
    urgency: URGENCY.RACE_CONTROL,
    expires: now + 5,
    hold: 2,
  });

  it('preserves sent-key history through expiry and backward time until cooldown elapses', () => {
    const radio = new RadioArbiter();
    radio.post(message(100), 100);
    expect(radio.update(100)?.key).toBe('yellow-1');
    expect(radio.update(200)).toBeNull();
    radio.post(message(5), 5);
    expect(radio.update(5)).toBeNull();
    radio.post(message(119), 119);
    expect(radio.update(119)).toBeNull();
    radio.post(message(120), 120);
    expect(radio.update(120)?.key).toBe('yellow-1');
  });

  it('starts a new comparison and cooldown history only on explicit reset', () => {
    const radio = new RadioArbiter();
    radio.observe(snapshot(100), 5);
    radio.post(message(100), 100);
    radio.update(100);
    radio.post({ ...message(101), key: 'queued' }, 101);
    radio.reset();
    expect(radio.current).toBeNull();
    const frame = snapshot(1);
    frame[H.SC_PHASE] = SC_PHASE.DEPLOYED;
    expect(radio.observe(frame, 5)).toBeNull();
    radio.post(message(1), 1);
    expect(radio.update(1)?.key).toBe('yellow-1');
    expect(radio.update(4)).toBeNull();
    frame[H.TIME] = 5;
    frame[H.SC_PHASE] = SC_PHASE.IN_THIS_LAP;
    expect(radio.observe(frame, 5)?.key).toBe('sc-3');
  });
});
