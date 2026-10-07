import { describe, expect, it } from 'vitest';
import {
  BANNER_SECONDS,
  REV_LEDS,
  TAG_LIMIT,
  TAG_RANGE,
  clusterStatus,
  fastestLapCar,
  nameTagCars,
  raceBanner,
  revLedThresholds,
  sessionHeading,
  surname,
  towerWindow,
  tyreBand,
} from '../src/ui/f1-hud.ts';
import { MFD_PAGES } from '../src/ui/race-day-hud.ts';
import { MAP_H, MAP_W, mapPoint, sectorMarks } from '../src/ui/f1-minimap.ts';
import { minimapFrame, timedGap } from '../src/ui/interface.ts';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS, VEHICLE } from '../src/simulation/config.ts';
import { FLAG } from '../src/simulation/marshal.ts';
import { F, H, carBase } from '../src/simulation/protocol.ts';

const field = (opponents = 7) => new Simulation({ ...DEFAULT_OPTIONS, opponents }).makeFrame();

describe('F1 HUD cluster', () => {
  it('lights 15 rev LEDs evenly up to the shift point', () => {
    const t = revLedThresholds();
    expect(t).toHaveLength(REV_LEDS);
    expect(t[0]).toBeCloseTo(VEHICLE.shiftRPM * 0.8, 6);
    expect(t[14]).toBeCloseTo(VEHICLE.shiftRPM * 1.0002, 6);
    for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThan(t[i - 1]);
    expect(t[14]).toBeLessThan(VEHICLE.limiterRPM);
  });
  it('reports harvesting, deployment and the pit limiter only while racing', () => {
    const frame = field(0),
      o = carBase(0);
    frame[H.PHASE] = 1;
    frame[o + F.REGEN_POWER] = 5000;
    expect(clusterStatus(frame, 1, false)).toBe('');
    expect(clusterStatus(frame, 1, true)).toBe('PIT LIMITER');
    frame[H.PHASE] = 2;
    expect(clusterStatus(frame, 0, false)).toBe('HARVESTING');
    expect(clusterStatus(frame, 1, false)).toBe('REDUCED HARVESTING');
    frame[o + F.REGEN_POWER] = 0;
    frame[o + F.MOTOR_POWER] = 60000;
    expect(clusterStatus(frame, 1, false)).toBe('DEPLOYING');
    expect(clusterStatus(frame, 2, false)).toBe('OVERTAKE');
  });
  it('bands carcass temperatures as Art Bible B §1.7', () => {
    expect(tyreBand(40)).toBe('#4fa3ff');
    expect(tyreBand(Number.NaN)).toBe('#4fa3ff');
    expect(tyreBand(80)).toBe('#5fd3a0');
    expect(tyreBand(95)).toBe('#4cd964');
    expect(tyreBand(110)).toBe('#ffd60a');
    expect(tyreBand(130)).toBe('#ff3b30');
  });
});

describe('F1 HUD tower', () => {
  it('windows five rows around the player and clamps at both ends', () => {
    expect(towerWindow(0, 12)).toEqual([0, 5]);
    expect(towerWindow(6, 12)).toEqual([4, 9]);
    expect(towerWindow(11, 12)).toEqual([7, 12]);
    expect(towerWindow(2, 4)).toEqual([0, 4]);
  });
  it('uses surnames and finds the fastest-lap holder', () => {
    expect(surname('A. MOREAU')).toBe('MOREAU');
    expect(surname('  Ava  van Dijk ')).toBe('DIJK');
    expect(surname('YOU')).toBe('YOU');
    const frame = field(3);
    expect(fastestLapCar(frame)).toBe(-1);
    frame[carBase(2) + F.BEST_LAP] = 71.2;
    frame[carBase(1) + F.BEST_LAP] = 70.9;
    expect(fastestLapCar(frame)).toBe(1);
  });
  it('shows timed sessions as the best lap and gaps to it', () => {
    expect(timedGap(0, 70, false)).toBe('--:--.---');
    expect(timedGap(70.25, 70.25, true)).toBe('1:10.250');
    expect(timedGap(71.5, 70.25, false)).toBe('+1.250');
    expect(timedGap(71.5, 0, false)).toBe('1:11.500');
  });
  it('heads the tower with the session and the lap counter', () => {
    const frame = field(3),
      o = carBase(0);
    frame[o + F.LAPS] = 2;
    expect(sessionHeading('race', 5, frame)).toEqual({
      session: 'RACE',
      label: 'LAP',
      current: '3',
      total: '/ 5',
    });
    frame[o + F.LAPS] = 9;
    expect(sessionHeading('race', 5, frame).current).toBe('5');
    expect(sessionHeading('practice', 5, frame)).toMatchObject({ session: 'PRACTICE', total: '' });
    expect(sessionHeading('time-trial', 5, frame).session).toBe('TIME TRIAL');
    frame[o + F.LAP_TIME] = 0;
    expect(sessionHeading('qualifying', 5, frame).current).toBe('OUT LAP');
  });
});

describe('F1 HUD race control', () => {
  it('turns flags, finish, AI and damage into banners with a live-region text', () => {
    const frame = field(3),
      o = carBase(0);
    expect(raceBanner(frame, false).kind).toBe('none');
    expect(raceBanner(frame, true)).toMatchObject({ kind: 'info', title: 'AI DEMONSTRATION' });
    frame[H.FLAG] = FLAG.DOUBLE_YELLOW;
    frame[o + F.CAUTION_SPEED] = 12;
    const yellow = raceBanner(frame, true);
    expect(yellow).toMatchObject({ kind: 'flag', swatch: 'double', persistent: true });
    expect(yellow.text).toBe('DOUBLE YELLOW · SLOW · 43 KM/H · NO OVERTAKING');
    frame[H.FLAG] = FLAG.BLUE;
    frame[o + F.BLUE_CAR] = 2;
    expect(raceBanner(frame, false).sub).toBe('LET SATO THROUGH');
    frame[H.FLAG] = FLAG.GREEN;
    frame[o + F.FRONT_HEALTH] = 0.4;
    expect(raceBanner(frame, false)).toMatchObject({ kind: 'warn', title: 'FRONT WING DAMAGE' });
    frame[o + F.FINISH] = 300;
    expect(raceBanner(frame, false).kind).toBe('finish');
    expect(BANNER_SECONDS).toBe(4);
  });
  it('tags every nearby car on the grid but only the car ahead while racing', () => {
    const frame = field(7),
      o = carBase(0);
    frame[H.PHASE] = 1;
    const grid = nameTagCars(frame);
    expect(grid.length).toBeGreaterThan(0);
    expect(grid.length).toBeLessThanOrEqual(TAG_LIMIT);
    expect(grid).not.toContain(0);
    frame[H.PHASE] = 2;
    // Put car 3 30 m ahead on track and car 4 30 m behind.
    for (let id = 1; id < frame[H.CARS]; id++) frame[carBase(id) + F.X] += 5000;
    for (const [id, along] of [
      [3, 30],
      [4, -30],
    ]) {
      const p = carBase(id);
      frame[p + F.X] = frame[o + F.X];
      frame[p + F.Z] = frame[o + F.Z] + along;
      frame[p + F.S] = frame[o + F.S] + along;
    }
    expect(nameTagCars(frame)).toEqual([3]);
    frame[carBase(3) + F.S] = frame[o + F.S] + TAG_RANGE + 5;
    expect(nameTagCars(frame)).toEqual([]);
  });
});

describe('F1 HUD map and MFD', () => {
  it('maps the circuit inside the canvas with sector marks outside the loop', () => {
    const sim = new Simulation(DEFAULT_OPTIONS);
    const view = minimapFrame(sim.track);
    for (const p of sim.track.points) {
      const [x, y] = mapPoint(view, p.x, p.z);
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(MAP_W);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(MAP_H);
    }
    const marks = sectorMarks(sim.track, view);
    expect(marks).toHaveLength(3);
    for (const m of marks) expect(Math.hypot(m.nx, m.ny)).toBeCloseTo(1, 6);
  });
  it('appends STRATEGY and SETUP after DAMAGE', () => {
    expect(MFD_PAGES).toEqual(['TYRES', 'ENERGY', 'DAMAGE', 'STRATEGY', 'SETUP']);
  });
});
