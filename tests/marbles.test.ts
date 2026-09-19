import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { updateContamination } from '../src/simulation/contamination.ts';
import {
  CELL_COLS,
  MARBLE_CELL_CAPACITY,
  SURFACE,
  Track,
  surfaceSample,
  trackPoint,
} from '../src/simulation/track.ts';
import { makeTire, peakGrip, solveTire } from '../src/simulation/tire.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { CAR_STRIDE, F, H, HEADER, W, WHEEL_BASE, carBase } from '../src/simulation/protocol.ts';
import { Effects, PARTICLE_KIND } from '../src/rendering/effects.ts';
import { packTelemetry, CHANNELS, TELEMETRY_STRIDE } from '../src/storage/telemetry-schema.ts';
import {
  SessionReplay,
  type ReplayPage,
  type ReplayPageStore,
} from '../src/storage/replay-pages.ts';

const road = () => ({ ...surfaceSample(), marbles: 0.7 });
function snapshot(time = 0, pickup = 0) {
  const f = new Float32Array(HEADER + CAR_STRIDE),
    o = carBase(0);
  f[H.TIME] = time;
  f[H.CARS] = 1;
  f[o + F.QW] = 1;
  f[o + F.SPEED] = 30;
  f[o + F.VZ] = 30;
  f[o + WHEEL_BASE + W.LOAD] = 2200;
  f[o + F.MARBLE_PICKUP_FR] = pickup;
  return f;
}
function dispose(e: Effects) {
  e.group.traverse((o) => {
    if (o instanceof T.Points) {
      o.geometry.dispose();
      (o.material as T.Material).dispose();
    }
  });
}
class Pages implements ReplayPageStore {
  pages = new Map<number, ReplayPage>();
  async put(p: ReplayPage) {
    this.pages.set(p.id, structuredClone(p));
  }
  async get(id: number) {
    return structuredClone(this.pages.get(id)!);
  }
  async dispose() {
    this.pages.clear();
  }
}

describe('physical loose rubber and tire contamination', () => {
  it('accumulates real contamination and retains its grip penalty after returning to clean asphalt', () => {
    const t = makeTire('medium'),
      s = road(),
      clean = surfaceSample();
    const cleanGrip = peakGrip(t, 2200, clean, 30);
    for (let i = 0; i < 240; i++) updateContamination(t, s, 2200, 30, 90, 1 / 240);
    expect(t.dirt).toBeGreaterThan(0.3);
    expect(t.marblePickup).toBeGreaterThan(t.dirt); // some pickup is simultaneously shed
    expect(peakGrip(t, 2200, clean, 30)).toBeLessThan(cleanGrip * 0.9);
    const dirty = t.dirt;
    for (let i = 0; i < 2400; i++) updateContamination(t, clean, 2200, 30, 90, 1 / 240);
    expect(t.dirt).toBeLessThan(dirty * 0.5);
    expect(peakGrip(t, 2200, clean, 30)).toBeGreaterThan(cleanGrip * (1 - 0.34 * dirty));
  });
  it('uses exact bounded integration rather than a render-frequency or Euler accumulation', () => {
    const one = makeTire('medium'),
      many = makeTire('medium'),
      s = road();
    one.dirt = many.dirt = 0.25;
    updateContamination(one, s, 2200, 40, 120, 2);
    for (let i = 0; i < 480; i++) updateContamination(many, s, 2200, 40, 120, 1 / 240);
    expect(many.dirt).toBeCloseTo(one.dirt, 12);
    expect(many.marblePickup).toBeCloseTo(one.marblePickup, 12);
    for (let i = 0; i < 4000; i++) updateContamination(many, s, 2200, 80, 240, 1 / 240);
    expect(many.dirt).toBeGreaterThanOrEqual(0);
    expect(many.dirt).toBeLessThanOrEqual(1);
    expect(Number.isFinite(many.marblePickup)).toBe(true);
    expect(() => updateContamination(many, s, 2200, 40, 120, NaN)).toThrow();
  });
  it('does not collect or shed material while airborne or manufacture it under a stationary car', () => {
    for (const surface of [SURFACE.ASPHALT, SURFACE.GRASS, SURFACE.GRAVEL, SURFACE.PIT]) {
      const t = makeTire('medium'),
        s = { ...road(), surface };
      t.dirt = 0.4;
      updateContamination(t, s, 0, 80, 240, 1);
      expect(t.dirt).toBe(0.4);
      updateContamination(t, s, 2200, 0, 0, 1);
      expect(t.dirt).toBe(0.4);
      expect(t.marblePickup).toBe(0);
    }
  });
  it('does not mislabel grass dirt or a pit-lane contact as road-marble pickup', () => {
    for (const surface of [SURFACE.GRASS, SURFACE.GRAVEL, SURFACE.PIT]) {
      const t = makeTire('medium'),
        s = { ...road(), surface };
      updateContamination(t, s, 2200, 30, 90, 1);
      expect(t.marblePickup).toBe(0);
      expect(t.dirt > 0).toBe(surface !== SURFACE.PIT);
    }
  });
  it('handles reverse rolling symmetrically and finite material at extreme exposure', () => {
    const a = makeTire('medium'),
      b = makeTire('medium'),
      s = road();
    updateContamination(a, s, 2200, 40, 120, 0.5);
    updateContamination(b, s, 2200, -40, -120, 0.5);
    expect(a.dirt).toBe(b.dirt);
    expect(a.marblePickup).toBe(b.marblePickup);
    const limited = makeTire('medium');
    s.marbles = 0.00001;
    updateContamination(limited, s, 2200, 1000, 3000, 10000);
    expect(limited.marblePickup).toBeLessThanOrEqual(s.marbles * MARBLE_CELL_CAPACITY);
    expect(limited.dirt).toBeGreaterThanOrEqual(0);
  });
  it('runs the contamination model inside the production implicit tire-force solver', () => {
    const t = makeTire('medium');
    t.omega = 30 / t.radius;
    for (let i = 0; i < 120; i++) solveTire(t, 30, 1, 2200, 0, 0, road(), 0, 1 / 240);
    expect(t.marblePickup).toBeGreaterThan(0.1);
    expect(t.dirt).toBeGreaterThan(0.1);
    expect(Number.isFinite(t.fx + t.fy + t.omega + t.surfaceTemp)).toBe(true);
  });
  it('depletes the touched cell and does not change a neighbouring cell merely by pickup', () => {
    const track = new Track('clear', true),
      cell = CELL_COLS * 10;
    track.marbles[cell] = 0.7;
    track.marbles[cell + 1] = 0.3;
    const before = track.marbles[cell],
      other = track.marbles[cell + 1];
    track.interact(cell, 2200, 0, 30, 1 / 240, SURFACE.ASPHALT, 0.25);
    expect(track.marbles[cell]).toBeCloseTo(before - 0.25 / MARBLE_CELL_CAPACITY, 6);
    expect(track.marbles[cell + 1]).toBe(other);
    const rubber = track.rubber.slice(),
      marbles = track.marbles.slice(),
      water = track.water.slice();
    track.interact(cell, 2200, 0, 0, 1);
    expect(track.rubber).toEqual(rubber);
    expect(track.marbles).toEqual(marbles);
    for (const surface of [SURFACE.GRASS, SURFACE.GRAVEL, SURFACE.PIT])
      track.interact(cell, 2200, 100000, 40, 1, surface, 0.5);
    expect(track.rubber).toEqual(rubber);
    expect(track.marbles).toEqual(marbles);
    expect(track.water).toEqual(water);
  });
  it('does not sample clamped asphalt marbles or rubber for grass and pit-lane contacts', () => {
    const track = new Track('clear', true),
      p = trackPoint(),
      s = surfaceSample();
    track.marbles.fill(0.8);
    track.rubber.fill(0.7);
    track.at(550, p);
    track.sample(p.x + p.nx * (p.width + 6), p.z + p.nz * (p.width + 6), s);
    expect([SURFACE.GRASS, SURFACE.GRAVEL]).toContain(s.surface);
    expect(s.marbles).toBe(0);
    expect(s.rubber).toBe(0);
    track.at(80, p);
    track.sample(p.x + p.nx * 22, p.z + p.nz * 22, s);
    expect(s.surface).toBe(SURFACE.PIT);
    expect(s.marbles).toBe(0);
    expect(s.rubber).toBe(0);
  });
  it('couples production vehicle contacts, pickup counters and actual track depletion', () => {
    const track = new Track('clear', true),
      car = new Vehicle(0);
    track.marbles.fill(0.7);
    track.windX = track.windZ = 0;
    car.place(track, 450);
    car.body.velocity.set(car.trackPosition.tx * 30, 0, car.trackPosition.tz * 30);
    for (const t of car.tires) t.omega = 30 / t.radius;
    const initial = track.marbles.reduce((a, b) => a + b, 0);
    for (let i = 0; i < 120; i++) car.step(1 / 240, track);
    expect(car.tires.every((t) => t.marblePickup > 0.1 && t.dirt > 0.1)).toBe(true);
    expect(track.marbles.reduce((a, b) => a + b, 0)).toBeLessThan(initial);
    expect(car.body.position.finite() && car.body.velocity.finite()).toBe(true);
    car.replaceTires('wet');
    expect(
      car.tires.every((t) => t.dirt === 0 && t.marblePickup === 0 && t.compound === 'wet'),
    ).toBe(true);
  });
  it('exports all four measured pickup counters without moving existing snapshot offsets', () => {
    const sim = new Simulation({ ...DEFAULT_OPTIONS, opponents: 0, mode: 'practice' });
    const out = new Float32Array(TELEMETRY_STRIDE);
    sim.cars[0].tires.forEach((t, i) => {
      t.marblePickup = i * 0.25;
    });
    const frame = sim.makeFrame();
    packTelemetry(frame, out, 0);
    for (const [i, wheel] of ['fr', 'fl', 'rr', 'rl'].entries()) {
      expect(frame[carBase(0) + F.MARBLE_PICKUP_FR + i]).toBe(i * 0.25);
      expect(out[CHANNELS.indexOf(`marble_pickup_${wheel}_tread_covers`)]).toBe(i * 0.25);
    }
    expect(frame.length).toBe(HEADER + CAR_STRIDE);
  });
});

describe('pickup-driven solid particle pool', () => {
  it.each([24, 30, 60, 120, 144])('emits the same cumulative contact work at %i FPS', (hz) => {
    const e = new Effects();
    try {
      e.update(snapshot(), 1 / hz);
      for (let i = 1; i <= hz; i++) e.update(snapshot(i / hz, (0.5 * i) / hz), 1 / hz);
      expect(e.diagnostics().spawned[PARTICLE_KIND.MARBLE]).toBe(160);
      expect(e.diagnostics().active.reduce((a, b) => a + b)).toBeLessThanOrEqual(
        e.diagnostics().capacity,
      );
    } finally {
      dispose(e);
    }
  });
  it('cannot manufacture new events by redisplaying a snapshot or moving the brake pedal', () => {
    const e = new Effects(),
      f = snapshot(1, 0.5);
    try {
      e.update(snapshot(), 0.1);
      e.update(f, 0.1);
      const total = e.diagnostics().spawned[PARTICLE_KIND.MARBLE];
      f[carBase(0) + F.BRAKE] = 1;
      for (let i = 0; i < 100; i++) e.update(f, 0.01);
      expect(e.diagnostics().spawned[PARTICLE_KIND.MARBLE]).toBe(total);
    } finally {
      dispose(e);
    }
  });
  it('does not produce a catch-up burst after tire replacement, rewind or disabled/replay presentation', () => {
    const e = new Effects();
    try {
      e.update(snapshot(10, 5), 0.1);
      expect(e.diagnostics().spawned[5]).toBe(0);
      e.update(snapshot(11, 0), 0.1);
      expect(e.diagnostics().spawned[5]).toBe(0);
      e.update(snapshot(2, 9), 0.1);
      expect(e.diagnostics().spawned[5]).toBe(0);
      e.enabled = false;
      e.update(snapshot(3, 10), 0.1);
      e.enabled = true;
      e.update(snapshot(4, 10), 0.1);
      expect(e.diagnostics().spawned[5]).toBe(0);
      e.update(snapshot(5, 11), 0.1, false);
      e.update(snapshot(6, 11), 0.1);
      expect(e.diagnostics().spawned[5]).toBe(0);
      e.clear();
      expect(e.diagnostics().active.reduce((a, b) => a + b)).toBe(0);
    } finally {
      dispose(e);
    }
  });
  it('does not emit airborne or off-track events even if a stale counter changes', () => {
    for (const surface of [SURFACE.ASPHALT, SURFACE.GRASS, SURFACE.GRAVEL, SURFACE.PIT]) {
      const e = new Effects(),
        f = snapshot(1, 0.5),
        p = carBase(0) + WHEEL_BASE;
      try {
        e.update(snapshot(), 0.1);
        f[p + W.SURFACE] = surface;
        if (surface === SURFACE.ASPHALT) f[p + W.LOAD] = 0;
        e.update(f, 0.1);
        expect(e.diagnostics().spawned[5]).toBe(0);
      } finally {
        dispose(e);
      }
    }
  });
});

it('uploads zero opacity immediately when particles are cleared on a paused frame', () => {
  const effects = new Effects();
  try {
    effects.update(snapshot(), 0.1);
    effects.update(snapshot(1, 0.5), 0.1);
    const points = effects.group.children[0] as T.Points;
    const opacity = points.geometry.getAttribute('opacity') as T.BufferAttribute;
    const version = opacity.version;
    expect(Array.from(opacity.array).some((value) => value > 0)).toBe(true);
    effects.clear();
    expect(opacity.version).toBeGreaterThan(version);
    expect(Array.from(opacity.array).every((value) => value === 0)).toBe(true);
  } finally {
    dispose(effects);
  }
});

describe('three-channel replay surface history', () => {
  it('restores historical marble density and per-wheel counters after page eviction and backward seeks', async () => {
    const store = new Pages(),
      r = new SessionReplay(1, store, undefined, 2);
    r.recordSurface(
      new Float32Array([0.2, 0.4]),
      new Float32Array([0.3, 0.6]),
      0,
      new Float32Array([0.1, 0.7]),
    );
    for (let i = 0; i < 20; i++) {
      if (i === 10)
        r.recordSurface(
          new Float32Array([1, 2]),
          new Float32Array([0.8, 0.9]),
          i,
          new Float32Array([0.9, 0.2]),
        );
      r.append(snapshot(i, i / 10));
      await r.settle();
    }
    const a = r.makeFrame(),
      b = r.makeFrame();
    for (let j = 0; j < 3 && r.sample(15, a, b) === null; j++) await r.settle();
    expect(r.surfaceState.marbles[0]).toBeCloseTo(0.9, 4);
    for (let j = 0; j < 3 && r.sample(1, a, b) === null; j++) await r.settle();
    expect(r.surfaceState.marbles[0]).toBeCloseTo(0.1, 4);
    expect(r.surfaceState.marbles[1]).toBeCloseTo(0.7, 4);
    expect(a[carBase(0) + F.MARBLE_PICKUP_FR]).toBeCloseTo(0.1, 6);
    expect(r.error).toBeNull();
    await r.dispose();
  });
  it.each(['shape', 'nonfinite', 'empty'] as const)(
    'rejects %s surface input rather than recording fabricated state',
    async (fault) => {
      const r = new SessionReplay(1, new Pages());
      const water = new Float32Array(fault === 'empty' ? 0 : 2),
        rubber = water.slice();
      const marble = new Float32Array(fault === 'shape' ? 1 : water.length);
      if (fault === 'nonfinite') marble[0] = NaN;
      r.recordSurface(water, rubber, 0, marble);
      expect(r.error).toContain('Invalid replay surface');
      await r.dispose();
    },
  );
  it('rejects a corrupted stored surface tuple before exposing it to the renderer', async () => {
    const store = new Pages(),
      r = new SessionReplay(1, store, undefined, 2);
    r.recordSurface(new Float32Array([0]), new Float32Array([0]), 0, new Float32Array([0.4]));
    for (let i = 0; i < 20; i++) {
      r.append(snapshot(i));
      await r.settle();
    }
    store.pages.get(0)!.surfaces[0].data = new Uint16Array(2);
    r.sample(0, r.makeFrame(), r.makeFrame());
    await r.settle();
    expect(r.error).toContain('Incompatible replay page');
    await r.dispose();
  });
});

it('appends pickup columns without moving any of the existing 199 CSV fields', () => {
  expect(createHash('sha256').update(CHANNELS.slice(0, 199).join(',')).digest('hex')).toBe(
    '204164f2d43580bb44f4ce5735e58106f6bc1908ba48ae5e25ba940d5ef123b3',
  );
  expect(CHANNELS.slice(-4)).toEqual([
    'marble_pickup_fr_tread_covers',
    'marble_pickup_fl_tread_covers',
    'marble_pickup_rr_tread_covers',
    'marble_pickup_rl_tread_covers',
  ]);
});
