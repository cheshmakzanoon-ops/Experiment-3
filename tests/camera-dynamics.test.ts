import { describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { CameraClock, InertialCamera } from '../src/rendering/camera-dynamics.ts';
import { PresentedFrame } from '../src/rendering/frame-state.ts';
import { RacingRenderer } from '../src/rendering/renderer.ts';
import { CAR_STRIDE, F, H, HEADER, carBase } from '../src/simulation/protocol.ts';

const OMEGA = 22;

/** Closed-form displacement for x'' + 2w*x' + w²*x = w²*slope*t,
 * starting with zero displacement and velocity. */
function linearTarget(time: number, slope: number) {
  return slope * (time - 2 / OMEGA + (time + 2 / OMEGA) * Math.exp(-OMEGA * time));
}

function risingImpact(time: number, rate: number) {
  // A linearly rising recorded impact supplies constant acceleration 0.1*rate.
  return ((0.1 * rate) / OMEGA ** 2) * (1 - (1 + OMEGA * time) * Math.exp(-OMEGA * time));
}

describe('cockpit inertia under changing measured forces', () => {
  it.each([20, 30, 60, 144, 240, 1000])(
    'reconstructs a changing G load analytically at %i rendered frames per second',
    (hz) => {
      const rig = new InertialCamera();
      rig.step(0, 0, 0, 0, 0, 1);
      for (let i = 1; i <= hz / 2; i++) {
        const time = i / hz;
        rig.step(1 / hz, 4 * time, -6 * time, 3 * time, 0, 1);
        const expected = new T.Vector3(
          linearTarget(time, -0.048),
          linearTarget(time, -0.012),
          linearTarget(time, 0.048),
        );
        expect(rig.offset.distanceTo(expected)).toBeLessThan(2e-15);
      }
    },
  );

  it('retains the same spring position and velocity across irregular render partitions', () => {
    const controls = [
      { duration: 0.2, lateral: 2, longitudinal: -3, vertical: 1, impact: 0.4 },
      { duration: 0.13, lateral: -1, longitudinal: -1, vertical: -1, impact: 0.2 },
      { duration: 0.09, lateral: 0, longitudinal: 0, vertical: 0, impact: 0 },
    ];
    const outcomes = [1, 2, 7, 31].map((subdivisions) => {
      const rig = new InertialCamera();
      let previous = { lateral: 0, longitudinal: 0, vertical: 0, impact: 0 };
      rig.step(0, 0, 0, 0, 0, 0.7);
      for (const next of controls) {
        for (let i = 1; i <= subdivisions; i++) {
          const t = i / subdivisions,
            sample = (field: keyof typeof previous) =>
              previous[field] + (next[field] - previous[field]) * t;
          rig.step(
            next.duration / subdivisions,
            sample('lateral'),
            sample('longitudinal'),
            sample('vertical'),
            sample('impact'),
            0.7,
          );
        }
        previous = next;
      }
      const turningPoint = rig.offset.clone();
      // A subsequent unloaded segment observes the hidden spring velocity too.
      rig.step(0.17, 0, 0, 0, 0, 0.7);
      return [turningPoint, rig.offset.clone()];
    });
    for (const [position, following] of outcomes) {
      expect(position.distanceTo(outcomes[0][0])).toBeLessThan(2e-15);
      expect(following.distanceTo(outcomes[0][1])).toBeLessThan(2e-15);
    }
  });

  it.each([20, 60, 144, 240, 1000])(
    'preserves a recorded impact ramp without a per-frame threshold at %i FPS',
    (hz) => {
      const rig = new InertialCamera();
      rig.step(0, 0, 0, 0, 0, 1);
      for (let i = 1; i <= hz / 4; i++) {
        const time = i / hz;
        rig.step(1 / hz, 0, 0, 0, 1.6 * time, 1);
        const displacement = risingImpact(time, 1.6);
        expect(Math.abs(rig.offset.y + displacement)).toBeLessThan(2e-16);
        expect(Math.abs(rig.offset.z - displacement)).toBeLessThan(2e-16);
        expect(rig.offset.x).toBe(0);
      }
      expect(rig.offset.length()).toBeGreaterThan(0.0004);
    },
  );

  it('does not turn the decay of an impact into a second strike', () => {
    const held = new InertialCamera(),
      falling = new InertialCamera();
    for (const rig of [held, falling]) {
      rig.step(0, 0, 0, 0, 0, 1);
      rig.step(0.1, 0, 0, 0, 0.4, 1);
    }
    for (let i = 1; i <= 20; i++) {
      held.step(0.01, 0, 0, 0, 0.4, 1);
      falling.step(0.01, 0, 0, 0, 0.4 * (1 - i / 20), 1);
      expect(falling.offset.toArray()).toEqual(held.offset.toArray());
    }
  });

  it('does not replay pre-cut forces or an old impact after a seek', () => {
    const rig = new InertialCamera();
    rig.step(0, 0, 0, 0, 0, 1);
    rig.step(0.1, 3, -4, 1, 0.5, 1);
    expect(rig.offset.length()).toBeGreaterThan(0.01);
    rig.reset();
    for (let i = 0; i < 20; i++) rig.step(0, 0, 0, 0, 0.4, 1);
    rig.step(0.1, 0, 0, 0, 0.3, 1);
    expect(rig.offset.toArray()).toEqual([0, 0, 0]);
    // A subsequent, newly measured rise still causes recoil.
    rig.step(0.05, 0, 0, 0, 0.4, 1);
    expect(rig.offset.y).toBeLessThan(0);
    expect(rig.offset.z).toBeGreaterThan(0);
  });

  it('keeps pause samples from advancing the state and remains stable in slow replay', () => {
    const rigs = [new InertialCamera(), new InertialCamera()];
    rigs.forEach((rig) => rig.step(0, 0, 0, 0, 0, 1));
    const duration = 1e-6;
    rigs[0].step(duration, 0, -duration, 0, duration, 1);
    for (let i = 1; i <= 10; i++) {
      const time = (i * duration) / 10;
      rigs[1].step(duration / 10, 0, -time, 0, time, 1);
      const before = rigs[1].offset.toArray();
      rigs[1].step(0, 0, -time, 0, time, 1);
      expect(rigs[1].offset.toArray()).toEqual(before);
    }
    expect(rigs[0].offset.z).toBeGreaterThan(0);
    expect(rigs[0].offset.distanceTo(rigs[1].offset) / rigs[0].offset.length()).toBeLessThan(1e-9);
  });
});

describe('production cockpit force timeline', () => {
  it('drives the camera from the same delayed snapshot time as the visible chassis', () => {
    // Exercise the production draw dispatch without a WebGL context. The test
    // stops at the actual inertia call, before subsequent camera/shadow work.
    const stop = new Error('Observed cockpit force'),
      rig = new InertialCamera(),
      clock = new CameraClock(),
      car = carBase(0),
      a = new Float32Array(HEADER + CAR_STRIDE),
      b = new Float32Array(HEADER + CAR_STRIDE);
    for (const frame of [a, b]) {
      frame[H.CARS] = 1;
      frame[car + F.QW] = 1;
    }
    b[H.TIME] = 0.1;
    b[car + F.G_LAT] = 2;
    b[car + F.G_LONG] = -3;
    b[car + F.G_VERT] = 1.5;
    b[car + F.IMPACT] = 0.4;
    const untouched = [a.slice(), b.slice()],
      step = vi.fn((...args: Parameters<InertialCamera['step']>) => {
        rig.step(...args);
        throw stop;
      }),
      reset = () => ({ reset: vi.fn() });
    const scene = new T.Scene();
    scene.fog = new T.FogExp2(0xffffff);
    const fixture = {
      frameMs: 16,
      frameSamples: new Float32Array(300),
      sampleIndex: 0,
      sampleCount: 0,
      setCars: vi.fn(),
      orbitTime: 0,
      presented: new PresentedFrame(),
      cameraClock: clock,
      circuit: { setMotorcyclePresentation: vi.fn(), setGrandPrixGrid: vi.fn() },
      composition: reset(),
      motocrossCamera: reset(),
      viewOrientation: reset(),
      trackside: reset(),
      audioView: reset(),
      inertia: { reset: () => rig.reset(), step },
      cars: [{ root: new T.Group(), setLod: vi.fn(), update: vi.fn() }],
      follow: 0,
      quality: 'high',
      mode: 'cockpit',
      photo: null,
      lighting: 'day',
      reflectionFollow: 0,
      reflectionMaterials: [[]],
      reflection: { setSkyIntensity: vi.fn() },
      venueLighting: { update: vi.fn() },
      lightPools: { update: vi.fn() },
      bloom: { energyConserving: false },
      scene,
      sun: new T.DirectionalLight(),
      hemisphere: new T.HemisphereLight(),
      renderer: { toneMappingExposure: 1 },
      sky: {
        material: {
          uniforms: {
            cloudCover: { value: 0 },
            cloudDrift: { value: 0 },
            skyRadiance: { value: 0 },
            nightAmount: { value: 0 },
            sunsetAmount: { value: 0 },
            urbanGlow: { value: 0 },
            sunPosition: { value: new T.Vector3() },
          },
        },
      },
      target: new T.Vector3(),
      direction: new T.Vector3(),
      shake: 1,
    };
    for (const alpha of [0, 0.25, 0.5]) {
      expect(() =>
        RacingRenderer.prototype.draw.call(
          fixture as unknown as RacingRenderer,
          a,
          b,
          alpha,
          1 / 60,
        ),
      ).toThrow(stop);
      const shown = fixture.presented.value;
      expect(step).toHaveBeenLastCalledWith(
        alpha === 0 ? 0 : shown[H.TIME] - (alpha - 0.25) * b[H.TIME],
        shown[car + F.G_LAT],
        shown[car + F.G_LONG],
        shown[car + F.G_VERT],
        shown[car + F.IMPACT],
        1,
      );
      const time = shown[H.TIME],
        span = b[H.TIME],
        recoil = risingImpact(time, b[car + F.IMPACT] / span);
      expect(
        rig.offset.distanceTo(
          new T.Vector3(
            linearTarget(time, (-0.012 * b[car + F.G_LAT]) / span),
            linearTarget(time, (-0.004 * b[car + F.G_VERT]) / span) - recoil,
            linearTarget(time, (-0.008 * b[car + F.G_LONG]) / span) + recoil,
          ),
        ),
      ).toBeLessThan(2e-10);
    }
    expect(a).toEqual(untouched[0]);
    expect(b).toEqual(untouched[1]);
  });
});
