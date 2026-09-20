import { expect, it } from 'vitest';
import * as T from 'three';
import {
  EngineeringProbe,
  engineeringFresh,
  isEngineeringSample,
} from '../src/workers/diagnostics.ts';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { F, W, WHEEL_BASE, WHEEL_STRIDE, carBase } from '../src/simulation/protocol.ts';
import { engineeringReport } from '../src/ui/engineering.ts';
import { EngineeringView } from '../src/rendering/engineering-view.ts';
const options = { ...DEFAULT_OPTIONS, mode: 'practice' as const, opponents: 0 };
const metrics = {
  fps: 60,
  frameMs: 16.67,
  p1FPS: 55,
  renderCPUms: 8,
  drawCalls: 80,
  triangles: 10000,
  gpuMilliseconds: null,
  gpuTimerSupported: false,
};
function fixture() {
  const simulation = new Simulation(options),
    probe = new EngineeringProbe();
  simulation.autoPlayer = true;
  for (let i = 0; i < 180; i++) simulation.step(1 / 120);
  probe.enable(true);
  return { simulation, probe, sample: probe.sample(simulation)! };
}
it('is disabled by default, rate-limited to physics ticks, resettable and fails malformed toggles', () => {
  const simulation = new Simulation(options),
    probe = new EngineeringProbe();
  expect(probe.sample(simulation)).toBeNull();
  probe.enable(true);
  let count = Number(!!probe.sample(simulation));
  for (let tick = 0; tick < 120; tick++) {
    simulation.step(1 / 120);
    count += Number(!!probe.sample(simulation));
    expect(probe.sample(simulation)).toBeNull();
  }
  expect(count).toBe(11);
  probe.enable(false);
  expect(probe.sample(simulation)).toBeNull();
  probe.enable(true);
  expect(probe.sample(simulation)).not.toBeNull();
  probe.reset();
  expect(probe.sample(simulation)).toBeNull();
  expect(() => probe.enable('true' as unknown as boolean)).toThrow();
});
it('reports exact physical contact/AI data and does not reuse writable physics vector references', () => {
  const { simulation, sample } = fixture(),
    c = simulation.cars[0];
  expect(isEngineeringSample(sample)).toBe(true);
  expect(sample.targetSpeedMps).toBe(c.aiTarget);
  expect(sample.targetOffsetM).toBe(c.aiOffset);
  expect(sample.decision).toBe(simulation.ai[0].decision);
  sample.wheels.forEach((w, i) => {
    expect(w.origin).toEqual([c.origins[i].x, c.origins[i].y, c.origins[i].z]);
    expect(w.contact).toEqual([c.contactPoints[i].x, c.contactPoints[i].y, c.contactPoints[i].z]);
    expect(w.normal).toEqual([
      c.contacts[i].normal.x,
      c.contacts[i].normal.y,
      c.contacts[i].normal.z,
    ]);
    expect(w.rubber).toBe(c.contacts[i].rubber);
    expect(w.marbles).toBe(c.contacts[i].marbles);
    expect(w.loadN).toBe(c.tires[i].load);
  });
  const before = c.origins[0].x;
  sample.wheels[0].origin[0] = 999;
  expect(c.origins[0].x).toBe(before);
});
it('cannot alter the simulation trajectory, RNG, tire work or recorded snapshots', () => {
  const a = new Simulation(options),
    b = new Simulation(options),
    probe = new EngineeringProbe();
  a.autoPlayer = b.autoPlayer = true;
  probe.enable(true);
  for (let i = 0; i < 360; i++) {
    a.step(1 / 120);
    b.step(1 / 120);
    probe.sample(b);
  }
  expect(b.makeFrame()).toEqual(a.makeFrame());
  expect(b.track.water).toEqual(a.track.water);
  expect(b.track.rubber).toEqual(a.track.rubber);
  expect(b.track.marbles).toEqual(a.track.marbles);
});
it('marks inactive AI honestly instead of labeling stale targets as player commands', () => {
  const { simulation, probe } = fixture();
  simulation.autoPlayer = false;
  probe.enable(true);
  const s = probe.sample(simulation)!;
  expect(s.aiActive).toBe(false);
  expect(s.decision).toContain('AI INACTIVE');
  const report = engineeringReport(simulation.makeFrame(), metrics, s);
  expect(report).toContain('AI INACTIVE / TARGET SPEED —');
  simulation.cars[0].pitRequested = true;
  probe.enable(true);
  expect(probe.sample(simulation)!.aiActive).toBe(true);
});
it.each(['normal', 'time', 'load', 'cell', 'rubber', 'decision'] as const)(
  'rejects invalid %s debug data',
  (fault) => {
    const { sample } = fixture();
    if (fault === 'normal') sample.wheels[0].normal[1] = NaN;
    if (fault === 'time') sample.time = Infinity;
    if (fault === 'load') sample.wheels[0].loadN = -1;
    if (fault === 'cell') sample.wheels[0].cell = 3584;
    if (fault === 'rubber') sample.wheels[0].rubber = 1.1;
    if (fault === 'decision') sample.decision = 'bad\nrecord';
    expect(isEngineeringSample(sample)).toBe(false);
  },
);
it('never presents current live contacts as replay history or an old probe as current', () => {
  const { sample } = fixture();
  expect(engineeringFresh(sample, sample.time, false)).toBe(true);
  expect(engineeringFresh(sample, sample.time + 0.6, false)).toBe(false);
  expect(engineeringFresh(sample, sample.time - 1, false)).toBe(false);
  expect(engineeringFresh(sample, sample.time, true)).toBe(false);
  expect(engineeringFresh(null, sample.time, false)).toBe(false);
});
it('formats every required engineering category from actual frame channels, without fabricated GPU timing', () => {
  const { sample, simulation } = fixture(),
    frame = simulation.makeFrame(),
    o = carBase(0);
  frame[o + F.WY] = Math.PI / 2;
  frame[o + F.QX] = frame[o + F.QY] = frame[o + F.QZ] = 0;
  frame[o + F.QW] = 1;
  frame[o + F.AERO_FRONT] = 1200;
  frame[o + F.AERO_REAR] = 2800;
  for (let i = 0; i < 4; i++) frame[o + WHEEL_BASE + i * WHEEL_STRIDE + W.FX] = 123 + i;
  const text = engineeringReport(frame, metrics, sample);
  for (const key of [
    'FPS',
    'PHYSICS',
    'GPU UNSUPPORTED',
    'DRAWS',
    'TRIANGLES',
    'SPEED',
    'YAW RATE 90.00',
    'PITCH',
    'ROLL',
    'G LONG',
    'VERT',
    'AERO FRONT',
    'DRAG',
    'AERO BALANCE 30.0%',
    'Fz N / Fx N / Fy N',
    'SLIP',
    'TEMP',
    'WEAR',
    'WATER',
    'RUBBER',
    'AI TARGET PATH',
    'AI DECISION',
  ])
    expect(text).toContain(key);
  for (const force of ['123', '124', '125', '126']) expect(text).toContain(force);
  expect(text).not.toMatch(/NaN|Infinity/);
  expect(engineeringReport(frame, { ...metrics, gpuMilliseconds: 1.25 }, sample)).toContain(
    'GPU 1.25 ms',
  );
  expect(engineeringReport(frame, metrics, sample, true)).toContain('PROBE NOT RECORDED');
});
it('shows real contact points and sampled suspension rays, then hides stale/replay overlays', () => {
  const { sample } = fixture(),
    view = new EngineeringView();
  try {
    view.update(sample, sample.time, true, false);
    expect(view.group.visible).toBe(true);
    const markers = view.group.children.find(
      (o) => o instanceof T.InstancedMesh,
    ) as T.InstancedMesh;
    const ray = view.group.children.find((o) => o instanceof T.LineSegments) as T.LineSegments;
    const matrix = new T.Matrix4();
    markers.getMatrixAt(0, matrix);
    const at = new T.Vector3().setFromMatrixPosition(matrix);
    expect(at.x).toBeCloseTo(sample.wheels[0].contact[0], 4);
    expect(at.y).toBeCloseTo(sample.wheels[0].contact[1], 4);
    const positions = ray.geometry.getAttribute('position');
    expect(positions.getX(0)).toBeCloseTo(sample.wheels[0].origin[0], 4);
    const version = markers.instanceMatrix.version;
    view.update(sample, sample.time, true, false);
    expect(markers.instanceMatrix.version).toBe(version);
    view.update(sample, sample.time, true, true);
    expect(view.group.visible).toBe(false);
    view.update(sample, sample.time + 1, true, false);
    expect(view.group.visible).toBe(false);
  } finally {
    view.group.traverse((o) => {
      if (o instanceof T.Mesh || o instanceof T.Line) {
        o.geometry.dispose();
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
      }
    });
  }
});
