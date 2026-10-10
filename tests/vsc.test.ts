import { afterEach, describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { mod } from '../src/core/math.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { DRS_STATE } from '../src/simulation/drs.ts';
import { H } from '../src/simulation/protocol.ts';
import { PHASE } from '../src/simulation/race.ts';
import { SAFETY_CAR, SC_PHASE } from '../src/simulation/safety-car.ts';
import { Simulation } from '../src/simulation/world.ts';
import { Track } from '../src/simulation/track.ts';
import {
  SAFETY_CAR_LOOK,
  SafetyCarView,
  lightBarSide,
  safetyCarPose,
} from '../src/rendering/studio/safety-car.ts';

// Geometry/state-only tests. This no-op canvas is NOT rendered-image evidence.
function stubCanvas() {
  class Canvas {
    width = 300;
    height = 150;
    getContext() {
      const noop = () => {};
      return new Proxy(
        {
          canvas: this,
          measureText: () => ({ width: 40 }),
          createLinearGradient: () => ({ addColorStop: noop }),
          createRadialGradient: () => ({ addColorStop: noop }),
          createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
          getImageData: (_x: number, _y: number, w: number, h: number) => ({
            data: new Uint8ClampedArray(w * h * 4),
          }),
        },
        { get: (target, key) => Reflect.get(target, key) ?? noop },
      );
    }
  }
  vi.stubGlobal('document', { createElement: () => new Canvas() });
  vi.stubGlobal('HTMLCanvasElement', Canvas);
}
afterEach(() => vi.unstubAllGlobals());

describe('virtual safety car and safety car', () => {
  it('neutralises a long obstruction: VSC, then a safety car the field never passes', () => {
    const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'race', laps: 8, opponents: 3 });
    sim.autoPlayer = true;
    const L = sim.track.length;
    // Get racing first, then retire a car on the track.
    for (let tick = 0; tick < 40 * 120; tick++) sim.step(1 / 120);
    expect(sim.race.phase).toBe(PHASE.RACING);
    const obstruction = sim.cars[3];
    obstruction.retired = true;
    const frame = sim.makeFrame();
    let vscAt = -1,
      scAt = -1,
      passes = 0,
      vscSpeedMax = 0,
      lapsAtDeploy = 0,
      lapsAtEnd = 0,
      inThisLap = false,
      endedAt = -1,
      drsWhileNeutral = 0;
    const lastAhead = new Float64Array(sim.cars.length).fill(NaN);
    for (let tick = 0; tick < 240 * 120; tick++) {
      sim.step(1 / 120);
      const t = tick / 120,
        sc = sim.race.safetyCar;
      if (sc.phase === SC_PHASE.VSC && vscAt < 0) vscAt = t;
      if (sc.phase === SC_PHASE.VSC && t > vscAt + 6)
        for (const c of sim.cars)
          if (!c.retired && !c.inPit) vscSpeedMax = Math.max(vscSpeedMax, c.speed);
      if (sc.phase === SC_PHASE.DEPLOYED && scAt < 0) {
        scAt = t;
        lapsAtDeploy = sim.race.laps.reduce((sum, lap) => sum + lap.completed, 0);
      }
      if (sc.neutralised)
        for (let i = 0; i < sim.cars.length; i++)
          if (sim.race.drs.state[i] !== DRS_STATE.OFF) drsWhileNeutral++;
      if (sc.phase >= SC_PHASE.DEPLOYED) {
        for (let i = 0; i < sim.cars.length; i++) {
          const c = sim.cars[i];
          if (c.retired || c.inPit) {
            lastAhead[i] = NaN;
            continue;
          }
          const ahead = mod(sc.s - c.s, L);
          // Passing: the safety car was just ahead and is now just behind.
          if (lastAhead[i] < 40 && ahead > L - 40) passes++;
          lastAhead[i] = ahead;
        }
        // Clear the obstruction once the queue has formed for half a lap.
        if (t > scAt + 30 && obstruction.retired) {
          obstruction.retired = false;
          obstruction.inPit = true;
        }
      } else lastAhead.fill(NaN);
      if (sc.phase === SC_PHASE.IN_THIS_LAP) {
        inThisLap = true;
        sim.writeFrame(frame);
        expect(frame[H.SC_PHASE]).toBe(SC_PHASE.IN_THIS_LAP);
        expect(frame[H.SC_S]).toBeCloseTo(sc.s, 2);
      }
      if (inThisLap && sc.phase === SC_PHASE.NONE) {
        endedAt = t;
        lapsAtEnd = sim.race.laps.reduce((sum, lap) => sum + lap.completed, 0);
        break;
      }
    }
    expect(vscAt).toBeGreaterThan(SAFETY_CAR.vscAfter - 1);
    expect(vscSpeedMax).toBeLessThan(SAFETY_CAR.vscSpeed + 3);
    expect(scAt - vscAt).toBeGreaterThan(SAFETY_CAR.scAfter - SAFETY_CAR.vscAfter - 1);
    expect(passes).toBe(0);
    expect(inThisLap).toBe(true);
    expect(endedAt).toBeGreaterThan(scAt);
    // Laps keep counting behind the safety car.
    expect(lapsAtEnd).toBeGreaterThan(lapsAtDeploy);
    expect(drsWhileNeutral).toBe(0);
    expect(sim.race.flag).not.toBe('CHEQUERED');
  }, 120_000);

  it('never deploys outside race sessions', () => {
    const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', opponents: 1 });
    sim.autoPlayer = true;
    sim.cars[1].place(sim.track, 980, 0);
    sim.cars[1].retired = true;
    for (let tick = 0; tick < 40 * 120; tick++) sim.step(1 / 120);
    expect(sim.race.control.hasObstruction).toBe(true);
    expect(sim.race.safetyCar.phase).toBe(SC_PHASE.NONE);
  });

  it('renders an original-livery safety car with an alternating 2 Hz amber bar', () => {
    stubCanvas();
    const track = new Track();
    const pose = safetyCarPose(track, 400, SAFETY_CAR.scSpeed);
    const point = { x: 0, z: 0 };
    track.at(400, point as never);
    expect(pose.x).toBeCloseTo(point.x, 6);
    expect(pose.qx ** 2 + pose.qy ** 2 + pose.qz ** 2 + pose.qw ** 2).toBeCloseTo(1, 10);
    expect([0, 0.2, 0.25, 0.49, 0.5].map(lightBarSide)).toEqual([0, 0, 1, 1, 0]);
    const view = new SafetyCarView();
    expect(view.car.paint.color.getHexString()).toBe(
      new T.Color(SAFETY_CAR_LOOK.livery.primary).getHexString(),
    );
    const camera = new T.PerspectiveCamera();
    camera.position.set(pose.x, pose.y + 3, pose.z - 8);
    view.update(pose, camera, 'medium', 0.1, 1 / 60);
    expect(view.visible).toBe(true);
    expect(view.root.position.distanceTo(new T.Vector3(pose.x, pose.y, pose.z))).toBeLessThan(1e-4);
    const [left, right] = view.lights;
    expect(left.color.r).toBeGreaterThan(SAFETY_CAR_LOOK.gain * 0.9);
    expect(right.color.r).toBeLessThan(0.1);
    view.update(pose, camera, 'medium', 0.3, 1 / 60);
    expect(right.color.r).toBeGreaterThan(SAFETY_CAR_LOOK.gain * 0.9);
    view.update(null, camera, 'medium', 0.4, 1 / 60);
    expect(view.root.visible).toBe(false);
  });
});
