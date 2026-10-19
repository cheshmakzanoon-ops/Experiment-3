import { describe, expect, it } from 'vitest';
import { menuPreview } from '../src/rendering/menu-preview.ts';
import { circuitDefinition } from '../src/simulation/circuits.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { FLAG } from '../src/simulation/marshal.ts';
import { B, BIKE_BASE, F, H, carBase } from '../src/simulation/protocol.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { Simulation } from '../src/simulation/world.ts';
import { gpCornerPhase, gpCornerShapes } from '../src/ui/gp-corner-phases.ts';
import { GPRidingCues } from '../src/ui/gp-riding-cues.ts';

const aurel = new Track(),
  poggio = new Track('clear', false, undefined, circuitDefinition('poggio-alto')),
  o = carBase(0),
  b = o + BIKE_BASE;

function riding(track: Track, station: number, lean = 0.65) {
  const frame = menuPreview(track, station, 'gpr1'),
    road = track.at(station, trackPoint());
  frame[H.PHASE] = 2;
  frame[o + F.SPEED] = 40;
  frame[o + F.VX] = 40 * road.tx;
  frame[o + F.VZ] = 40 * road.tz;
  frame[b + B.LEAN] = lean;
  frame[o + F.THROTTLE] = 0.35;
  return frame;
}

describe('GP corner progression follows each actual bend', () => {
  it('keeps the long North Hook exit readable after the former 24 m expiry', () => {
    const shapes = gpCornerShapes(aurel),
      corner = aurel.circuit.corners[0],
      cues = new GPRidingCues(),
      frame = riding(aurel, corner.s + 85);
    expect(shapes[0].exit).toBeGreaterThan(110);
    expect(aurel.at(corner.s + 85, trackPoint()).curvature).toBeGreaterThan(0.0025);
    expect(cues.read(frame, aurel)).toMatchObject({
      corner: 'T1 · NORTH HOOK',
      direction: 'left',
      distance: 'EXIT',
      phase: 'exit',
      action: 'HOLD YOUR LINE',
      detail: 'Unwind lean · add power gently',
    });
    expect(cues.read(frame, aurel)!.progress).toBeGreaterThan(2 / 3);
    const beyond = cues.read(riding(aurel, corner.s + shapes[0].exit + 1), aurel)!;
    expect(beyond.corner).not.toContain('NORTH HOOK');
  });

  it('uses shorter windows for tight turns and exposes the second half of linked bends', () => {
    const shapes = gpCornerShapes(poggio),
      cues = new GPRidingCues(),
      corner = poggio.circuit.corners[5];
    expect(shapes[0].exit).toBeGreaterThan(36);
    expect(shapes[0].exit).toBeLessThan(70);
    expect(cues.read(riding(poggio, poggio.circuit.corners[0].s + 36), poggio)).toMatchObject({
      corner: 'T1 · PRIMA',
      distance: 'EXIT',
    });
    expect(cues.read(riding(poggio, corner.s + 15), poggio)).toMatchObject({
      corner: 'T6 · VIGNA',
      action: 'LINK THE TURNS',
      detail: 'T7 right next · balance the change',
      phase: 'exit',
    });
    const next = cues.read(riding(poggio, corner.s + shapes[5].exit + 1), poggio)!;
    expect(next.corner).toBe('T7 · PIEVE');
    expect(next.direction).toBe('right');
    // Every pair keeps a small handover gap, including the wrapped last turn.
    for (let i = 0; i < shapes.length; i++) {
      const shape = shapes[i];
      expect(shape.exit + shapes[shape.next].entry).toBeLessThan(shape.nextGap);
      expect(shape.entry).toBeGreaterThan(0);
      expect(shape.exit).toBeGreaterThan(0);
    }
  });

  it('progresses monotonically through entry, apex and exit without a wall clock', () => {
    const shape = gpCornerShapes(aurel)[0],
      samples = Array.from({ length: 61 }, (_, i) =>
        gpCornerPhase(shape, shape.entry - (i / 60) * (shape.entry + shape.exit)),
      );
    expect(gpCornerPhase(shape, shape.entry + 20)).toEqual({ phase: 'approach', progress: 0 });
    expect(samples[0]).toEqual({ phase: 'entry', progress: 0 });
    expect(gpCornerPhase(shape, 0)).toEqual({ phase: 'apex', progress: 0.5 });
    expect(samples.at(-1)).toEqual({ phase: 'exit', progress: 1 });
    for (let i = 1; i < samples.length; i++)
      expect(samples[i].progress).toBeGreaterThan(samples[i - 1].progress);
  });

  it('keeps positive phase spans for coincident labels and very close candidate apexes', () => {
    const candidate = new Track('clear', false, undefined, {
      ...aurel.circuit,
      corners: [
        { s: 627, name: 'FIRST' },
        { s: 627, name: 'SAME LOCATION' },
        { s: 627.01, name: 'CLOSE LOCATION' },
      ],
    });
    for (const shape of gpCornerShapes(candidate)) {
      expect(shape.entry).toBeGreaterThan(0);
      expect(shape.exit).toBeGreaterThan(0);
      expect(shape.apexWindow).toBeGreaterThan(0);
      for (const distance of [shape.entry, shape.apexWindow, 0, -shape.apexWindow, -shape.exit]) {
        const phase = gpCornerPhase(shape, distance);
        expect(Number.isFinite(phase.progress)).toBe(true);
        expect(phase.progress).toBeGreaterThanOrEqual(0);
        expect(phase.progress).toBeLessThanOrEqual(1);
      }
    }
  });

  it('offers measured roll-on with lean and keeps front/rear brake and marshal priority after the apex', () => {
    const cues = new GPRidingCues(),
      frame = riding(aurel, aurel.circuit.corners[0].s + 85, 0.15);
    expect(cues.read(frame, aurel)?.action).toBe('DRIVE OUT');
    frame[b + B.LEAN] = 0.7;
    expect(cues.read(frame, aurel)?.action).toBe('HOLD YOUR LINE');
    frame[o + F.BRAKE] = 0.35;
    expect(cues.read(frame, aurel)).toMatchObject({ action: 'TRAIL BRAKING', tone: 'brake' });
    frame[o + F.BRAKE] = 0;
    frame[b + B.REAR_BRAKE] = 0.35;
    expect(cues.read(frame, aurel)).toMatchObject({ action: 'REAR BRAKE', tone: 'brake', tow: 0 });
    frame[o + F.LOCAL_FLAG] = FLAG.YELLOW;
    expect(cues.read(frame, aurel)).toMatchObject({ action: 'CAUTION', tone: 'caution', tow: 0 });
    expect(cues.read(frame, aurel)?.corner).toBe('T1 · NORTH HOOK');
  });

  it('restores identical progress through pause, backwards seeks and circuit changes', () => {
    const cues = new GPRidingCues(),
      frame = riding(aurel, aurel.circuit.corners[0].s + 85),
      saved = frame.slice(),
      expected = cues.read(frame, aurel);
    for (let i = 0; i < 20; i++) expect(cues.read(frame, aurel)).toEqual(expected);
    cues.read(riding(aurel, aurel.circuit.corners[2].s - 50), aurel);
    cues.read(riding(poggio, poggio.circuit.corners[5].s + 15), poggio);
    expect(cues.read(frame, aurel)).toEqual(expected);
    expect(frame).toEqual(saved);
    frame[o + F.THROTTLE] = NaN;
    expect(cues.read(frame, aurel)).toBeNull();
  });

  it('reads a real GP simulation through the entire long first corner', () => {
    const sim = new Simulation({
      ...DEFAULT_OPTIONS,
      mode: 'practice',
      opponents: 0,
      vehicles: ['gpr1'],
      circuit: 'aurel',
      weather: 'clear',
    });
    sim.autoPlayer = true;
    const frame = sim.makeFrame(),
      cues = new GPRidingCues(),
      corner = sim.track.circuit.corners[0],
      shape = gpCornerShapes(sim.track)[0],
      phases = new Set<string>();
    let extendedExitSamples = 0,
      previousProgress = 0;
    for (let tick = 0; tick < 65 * 240; tick++) {
      sim.step(1 / 240);
      if (tick % 8) continue;
      sim.writeFrame(frame);
      const station = frame[o + F.S];
      if (station > corner.s + shape.exit && station < sim.track.length / 2) break;
      if (station < corner.s - shape.entry || station > corner.s + shape.exit) continue;
      const cue = cues.read(frame, sim.track)!;
      expect(frame[b + B.STATE]).toBe(0);
      expect(cue.corner).toBe('T1 · NORTH HOOK');
      expect(cue.progress).toBeGreaterThanOrEqual(previousProgress);
      previousProgress = cue.progress;
      phases.add(cue.phase);
      if (station > corner.s + 24) {
        extendedExitSamples++;
        expect(cue.action).not.toBe('BUILD YOUR RUN');
        expect(cue.distance).toBe('EXIT');
      }
    }
    expect(phases).toEqual(new Set(['entry', 'apex', 'exit']));
    expect(extendedExitSamples).toBeGreaterThan(35);
    expect(previousProgress).toBeGreaterThan(0.95);
  });
});
