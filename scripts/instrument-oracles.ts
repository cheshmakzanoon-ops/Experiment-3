import assert from 'node:assert/strict';
import { SteeringDisplayClock } from '../src/rendering/steering-display.ts';
import { weatherReadout } from '../src/ui/presentation.ts';

export const instrumentOracles: Record<string, () => void> = {
  'first snapshot and gear changes refresh without waiting for a render frame counter': () => {
    const clock = new SteeringDisplayClock();
    assert(clock.due(0, 1)); assert(!clock.due(0, 1));
    assert(clock.due(0.001, 2)); assert(!clock.due(0.002, 2));
  },
  'slow frames refresh from real snapshot time and paused snapshots remain unchanged': () => {
    const clock = new SteeringDisplayClock();
    assert(clock.due(0, 1)); assert(clock.due(2, 1)); assert(clock.due(4, 1));
    for (let i = 0; i < 100; i++) assert(!clock.due(4, 1));
    assert(clock.due(0.02, 1), 'Replay rewind must refresh immediately');
    assert.throws(() => clock.due(NaN, 1));
    assert.throws(() => clock.due(0.04, Infinity));
  },
  'ordinary high-refresh driving bounds upload frequency without starving the display': () => {
    for (const hz of [24, 30, 60, 90, 120, 144]) {
      const clock = new SteeringDisplayClock(); let previous = -1, updates = 0;
      for (let i = 0; i <= hz * 3; i++) {
        const now = i / hz;
        if (clock.due(now, 4)) {
          if (previous >= 0) assert(now - previous <= 0.08 + 1 / hz + 1e-6);
          previous = now; updates++;
        }
      }
      assert(updates >= 30 && updates <= 39, `${hz}Hz has ${updates} texture uploads`);
    }
  },
  'rain stopping never labels retained standing water dry': () => {
    assert.equal(weatherReadout(21, 0, 1.25), '21°C / TRACK AVG 1.25 MM WATER');
    assert.equal(weatherReadout(21, 0, 0.01), '21°C / DAMP TRACK');
    assert.equal(weatherReadout(24, 0, 0), '24°C / DRY TRACK');
    assert.equal(weatherReadout(24, 0.25, 0), '24°C / RAIN 0.3 MM/H · TRACK WETTING');
    assert(!weatherReadout(24, 0.25, 0.5).includes('DRY'));
    assert.equal(weatherReadout(NaN, 0, 0), 'WEATHER DATA UNAVAILABLE');
    assert.equal(weatherReadout(24, -1, 0), 'WEATHER DATA UNAVAILABLE');
  },
};
