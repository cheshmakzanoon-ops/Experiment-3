import { expect, it } from 'vitest';
import { hardStopImpulse, landingNormalSpeed } from '../src/simulation/offroad/contact-impulse.ts';
import { motocrossYawInertia } from '../src/simulation/offroad/mx-ground-physics.ts';

it('a bottomed tyre on a bank exchanges yaw momentum and dissipates only normal impact energy', () => {
  const mass = 184,
    pitchInertia = 43,
    yawInertia = motocrossYawInertia(mass, 0.82, 0.66);
  const forward = 16,
    lateral = -2.7,
    pitch = 0.95,
    grade = -0.16,
    crossGrade = 0.54;
  for (const reach of [-0.66, 0.82])
    for (const whip of [-0.55, 0, 0.55])
      for (const yaw of [-2, 2])
        for (const vertical of [-6, 2]) {
          const arm = reach * (crossGrade * Math.cos(whip) - grade * Math.sin(whip));
          const j = hardStopImpulse(
            forward,
            vertical,
            pitch,
            grade,
            reach,
            mass,
            pitchInertia,
            lateral,
            crossGrade,
            { arm, rate: yaw, inertia: yawInertia },
          );
          const x = forward - (grade * j) / mass,
            z = lateral - (crossGrade * j) / mass;
          const y = vertical + j / mass,
            w = pitch + (reach * j) / pitchInertia;
          const r = yaw - (arm * j) / yawInertia;
          const closing =
            grade * forward + crossGrade * lateral + arm * yaw - vertical - reach * pitch;
          expect(grade * x + crossGrade * z + arm * r - y - reach * w).toBeCloseTo(
            Math.min(0, closing),
            10,
          );
          expect(j === 0).toBe(closing <= 0);
          const loss =
            mass * (forward ** 2 + lateral ** 2 + vertical ** 2 - x ** 2 - z ** 2 - y ** 2) +
            pitchInertia * (pitch ** 2 - w ** 2) +
            yawInertia * (yaw ** 2 - r ** 2);
          expect(loss).toBeCloseTo(j * closing, 8);
        }
});

it('removes closing normal speed without adding kinetic energy over either slope or contact arm', () => {
  for (const grade of [-2, -0.5, 0, 0.5, 2])
    for (const lever of [-0.8, 0.8])
      for (const horizontal of [0, 10, 35])
        for (const vertical of [-12, 0, 12])
          for (const pitchRate of [-4, 0, 4]) {
            const mass = 185,
              inertia = 45;
            const impulse = hardStopImpulse(
              horizontal,
              vertical,
              pitchRate,
              grade,
              lever,
              mass,
              inertia,
            );
            const vx = horizontal - (grade * impulse) / mass;
            const vy = vertical + impulse / mass;
            const rate = pitchRate + (lever * impulse) / inertia;
            const before =
              0.5 * (mass * (horizontal ** 2 + vertical ** 2) + inertia * pitchRate ** 2);
            const after = 0.5 * (mass * (vx ** 2 + vy ** 2) + inertia * rate ** 2);
            const closing = grade * horizontal - vertical - lever * pitchRate;
            expect(after).toBeLessThanOrEqual(before + 1e-9);
            expect(grade * vx - vy - lever * rate).toBeCloseTo(Math.min(0, closing), 10);
            expect(impulse === 0).toBe(closing <= 0);
            if (closing > 0) expect(before - after).toBeCloseTo(0.5 * impulse * closing, 8);
          }
});

it('exchanges all three momenta on a banked hard stop without loading a separating tyre', () => {
  for (const cross of [-0.8, 0.35, 0.9])
    for (const side of [-7, 3, 8]) {
      const grade = 0.12,
        forward = 16,
        down = -3.4,
        arm = -0.71,
        pitch = -1.4;
      const mass = 184,
        inertia = 43;
      const j = hardStopImpulse(forward, down, pitch, grade, arm, mass, inertia, side, cross);
      const x = forward - (grade * j) / mass,
        z = side - (cross * j) / mass;
      const y = down + j / mass,
        w = pitch + (arm * j) / inertia;
      const into = grade * forward + cross * side - down - arm * pitch;
      expect(grade * x + cross * z - y - arm * w).toBeCloseTo(Math.min(into, 0), 10);
      const energyLoss =
        (mass * (forward ** 2 + side ** 2 + down ** 2 - x ** 2 - y ** 2 - z ** 2) +
          inertia * (pitch ** 2 - w ** 2)) /
        2;
      expect(energyLoss).toBeCloseTo(0.5 * j * into, 9);
      expect(landingNormalSpeed(forward, side, down, grade, cross)).toBeCloseTo(
        (into + arm * pitch) / Math.hypot(1, grade, cross),
        12,
      );
    }
});
