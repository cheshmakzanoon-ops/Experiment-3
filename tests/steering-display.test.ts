import { expect, it } from 'vitest';
import { F, HEADER, CAR_STRIDE, carBase } from '../src/simulation/protocol.ts';
import { steeringReadout, shiftLight } from '../src/rendering/steering-display.ts';
it('uses real setup, deployment and completed-lap delta values', () => {
  const f = new Float32Array(HEADER + CAR_STRIDE),
    o = carBase(0);
  f[o + F.GEAR] = 4;
  f[o + F.SPEED] = 60;
  f[o + F.BRAKE_BIAS] = 0.56;
  f[o + F.DIFF_POWER] = 0.7;
  f[o + F.ERS_MODE] = 2;
  f[o + F.BATTERY] = 2e6;
  f[o + F.LAP_DELTA] = -0.125;
  expect(steeringReadout(f, o)).toMatchObject({
    gear: '4',
    speed: 216,
    brakeBias: '56.0',
    differential: 70,
    ers: 'ATTACK',
    battery: 0.5,
    delta: '—',
  });
  f[o + F.DELTA_VALID] = 1;
  expect(steeringReadout(f, o)).toMatchObject({ delta: '-0.125', ahead: true });
  f[o + F.GEAR] = -1;
  expect(steeringReadout(f, o).gear).toBe('R');
  f[o + F.GEAR] = 0;
  expect(steeringReadout(f, o).gear).toBe('N');
});
it('shift LEDs illuminate progressively from actual RPM', () => {
  expect(shiftLight(5000, 0)).toBe(false);
  expect(shiftLight(9500, 3)).toBe(true);
  expect(shiftLight(9500, 4)).toBe(false);
  expect(shiftLight(12500, 9)).toBe(true);
});
