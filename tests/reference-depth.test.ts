import { HeadquartersStage } from '../src/rendering/headquarters-stage.ts';
import { teamCalendar } from '../src/ui/team-hub.ts';
import { newTeam, changeTeam, weeklyBudget } from '../src/storage/team-career.ts';
import * as T from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_LIVERY,
  emptyDecal,
  validateDecals,
  validateLivery,
} from '../src/storage/livery.ts';
import { drawDecal } from '../src/rendering/car-livery.ts';
import { photoLens, validatePhoto } from '../src/rendering/photo-camera.ts';
import { GeometrySurvey, sampleGeometry } from '../src/rendering/geometry-survey.ts';
import {
  DEFAULT_DRIVING_AUDIO,
  DrivingCueDirector,
  validateDrivingAudio,
} from '../src/audio/driving-cues.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { F, H, HEADER, CAR_STRIDE, carBase } from '../src/simulation/protocol.ts';
import { DEFAULT_SETTINGS, validateSettings } from '../src/storage/data.ts';
import { FLAG } from '../src/simulation/marshal.ts';
import { audioAccessibility } from '../src/ui/audio-accessibility.ts';

// These are functionality/geometry checks, not a substitute for GPU screenshots.
describe('independent original livery slots', () => {
  it('keeps legacy saves identical and bounds sparse slots without sharing input arrays', () => {
    expect(validateLivery(DEFAULT_LIVERY)).toEqual(DEFAULT_LIVERY);
    expect(validateLivery({ decals: [] })).not.toHaveProperty('decals');
    const raw = [emptyDecal(10), emptyDecal(1)];
    const saved = validateLivery({ ...DEFAULT_LIVERY, decals: raw });
    expect(saved.decals?.map((r) => r.id)).toEqual([1, 10]);
    expect(saved.decals).not.toBe(raw);
    saved.decals![0].x = 0.99;
    expect(raw[1].x).not.toBe(0.99);
  });
  it('rejects invalid IDs, caps count and sanitizes every label and numeric transform', () => {
    const result = validateDecals([
      null,
      { id: -1 },
      { id: 1.5 },
      { id: 11 },
      {
        ...emptyDecal(1),
        text: '<script>bad</script>😈',
        color: 'url(x)',
        x: 9,
        y: -9,
        scale: Infinity,
        rotation: 500,
      },
      { ...emptyDecal(1), text: 'SECOND' },
      ...Array.from({ length: 1000 }, (_, i) => emptyDecal(i + 1)),
    ]);
    expect(result).toHaveLength(10);
    expect(result[0]).toMatchObject({
      text: 'SCRIPTBADSCRIP',
      color: '#f6f1e3',
      x: 1,
      y: -1,
      scale: 1,
      rotation: 90,
    });
    expect(validateDecals('bad')).toEqual([]);
    expect(emptyDecal(NaN).id).toBe(1);
    for (const r of result)
      expect(
        Object.values(r)
          .filter((v) => typeof v === 'number')
          .every(Number.isFinite),
      ).toBe(true);
  });
  it.each([-1, 1])(
    'paints signed flank %s UV transforms rather than placing labels over the screen',
    (side) => {
      const context = {
        save: vi.fn(),
        restore: vi.fn(),
        translate: vi.fn(),
        rotate: vi.fn(),
        fillText: vi.fn(),
      };
      const slot = { ...emptyDecal(1), x: 0.5, y: -0.25, rotation: 30, text: 'VECTOR' };
      drawDecal(context as unknown as CanvasRenderingContext2D, slot, side);
      expect(context.translate).toHaveBeenNthCalledWith(1, (side > 0 ? 0.25 : 0.75) * 1024, 440);
      expect(context.translate).toHaveBeenNthCalledWith(2, 160, -22.5);
      expect(context.rotate).toHaveBeenNthCalledWith(1, side > 0 ? Math.PI / 2 : -Math.PI / 2);
      expect(context.rotate).toHaveBeenNthCalledWith(2, Math.PI / 6);
      expect(context.fillText).toHaveBeenCalledWith('VECTOR', 0, 0, 190);
      expect(context.save).toHaveBeenCalledOnce();
      expect(context.restore).toHaveBeenCalledOnce();
    },
  );
});
describe('depth-based photo composition', () => {
  it('makes blur opt-in, clamps malformed lens values and disallows survey in a showroom', () => {
    expect(validatePhoto(null).depthOfField).toBe(false);
    expect(
      validatePhoto({
        backdrop: 'studio',
        survey: 'split',
        fStop: -10,
        focusDistance: Infinity,
        split: 100,
      }),
    ).toMatchObject({ survey: 'off', fStop: 1.4, focusDistance: 8.5, split: 0.9 });
    expect(
      validatePhoto({ depthOfField: 'yes', focusMode: 'unknown', survey: 'unknown' }),
    ).toMatchObject({ depthOfField: false, focusMode: 'subject', survey: 'off' });
  });
  it('uses actual camera-axis subject depth unless the user chooses a manual plane', () => {
    const p = validatePhoto({ depthOfField: true, focalLength: 100, fStop: 2 });
    const lens = photoLens(p, 17.5);
    expect(lens.focus).toBe(17.5);
    expect(lens.aperture).toBeGreaterThan(photoLens({ ...p, fStop: 8 }, 17.5).aperture);
    expect(photoLens({ ...p, focusMode: 'manual', focusDistance: 3 }, 80).focus).toBe(3);
    expect(photoLens(p, NaN).focus).toBe(p.focusDistance);
    expect(lens.maxblur).toBeLessThanOrEqual(0.02);
  });
});
describe('geometry-backed point cloud', () => {
  it('preserves actual world-space positions including parents and instances', () => {
    const root = new T.Group(),
      geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute([1, 2, 3, -1, 0, 2], 3));
    root.position.set(10, 0, -5);
    const mesh = new T.InstancedMesh(geometry, new T.MeshBasicMaterial(), 2);
    mesh.setMatrixAt(0, new T.Matrix4().makeTranslation(0, 0, 0));
    mesh.setMatrixAt(1, new T.Matrix4().makeTranslation(8, 0, 0));
    root.add(mesh);
    const a = sampleGeometry([root], new T.Vector3(), 100, 100);
    expect(Array.from(a.positions)).toEqual([11, 2, -2, 9, 0, -3, 19, 2, -2, 17, 0, -3]);
    expect(a.count).toBe(4);
    expect(a.candidates).toBe(4);
    expect(sampleGeometry([root], new T.Vector3(), 100, 100)).toEqual(a);
    expect(root.position.toArray()).toEqual([10, 0, -5]);
    expect(Array.from(geometry.getAttribute('position').array)).toEqual([1, 2, 3, -1, 0, 2]);
    geometry.dispose();
    (mesh.material as T.Material).dispose();
    mesh.dispose();
  });
  it('bounds work/output, excludes hidden/out-of-radius/nonfinite samples and reports an empty scene honestly', () => {
    const geometry = new T.SphereGeometry(10, 80, 60),
      material = new T.MeshBasicMaterial(),
      mesh = new T.Mesh(geometry, material);
    const a = sampleGeometry([mesh], new T.Vector3(), 71, 20);
    expect(a.count).toBeGreaterThan(0);
    expect(a.count).toBeLessThanOrEqual(71);
    expect(a.candidates).toBeLessThanOrEqual(214);
    expect(Array.from(a.positions).every(Number.isFinite)).toBe(true);
    expect(sampleGeometry([mesh], new T.Vector3(1000, 0, 0), 71, 20).count).toBe(0);
    mesh.visible = false;
    expect(sampleGeometry([mesh], new T.Vector3()).count).toBe(0);
    expect(sampleGeometry([], new T.Vector3()).count).toBe(0);
    expect(sampleGeometry([mesh], new T.Vector3(NaN, 0, 0)).count).toBe(0);
    geometry.dispose();
    material.dispose();
  });
  it.each([false, true])(
    'restores target, viewport, scissor, autoClear and colour even when render failure=%s',
    (fail) => {
      const state = {
        target: {} as object | null,
        viewport: new T.Vector4(2, 3, 320, 200),
        scissor: new T.Vector4(5, 6, 250, 180),
        test: false,
        color: new T.Color(0xffaa00),
        alpha: 0.4,
        autoClear: false,
      };
      const before = {
        ...state,
        viewport: state.viewport.clone(),
        scissor: state.scissor.clone(),
        color: state.color.clone(),
      };
      const vector = (v: T.Vector4, args: unknown[]) => {
        if (args[0] instanceof T.Vector4) v.copy(args[0]);
        else v.set(...(args as [number, number, number, number]));
      };
      const renderer = {
        get autoClear() {
          return state.autoClear;
        },
        set autoClear(v: boolean) {
          state.autoClear = v;
        },
        getRenderTarget: () => state.target,
        setRenderTarget: (v: object | null) => (state.target = v),
        getViewport: (v: T.Vector4) => v.copy(state.viewport),
        setViewport: (...args: unknown[]) => vector(state.viewport, args),
        getScissor: (v: T.Vector4) => v.copy(state.scissor),
        setScissor: (...args: unknown[]) => vector(state.scissor, args),
        getScissorTest: () => state.test,
        setScissorTest: (v: boolean) => (state.test = v),
        getClearColor: (v: T.Color) => v.copy(state.color),
        getClearAlpha: () => state.alpha,
        setClearColor: (v: T.Color, a: number) => {
          state.color.copy(v);
          state.alpha = a;
        },
        getSize: (v: T.Vector2) => v.set(1440, 900),
        render: () => {
          expect(state.viewport.toArray()).toEqual([0, 0, 1440, 900]);
          expect(state.scissor.toArray()).toEqual([0, 0, 720, 900]);
          if (fail) throw new Error('test failure');
        },
      };
      const survey = new GeometrySurvey();
      if (fail)
        expect(() =>
          survey.render(renderer as unknown as T.WebGLRenderer, new T.Camera(), 0.5),
        ).toThrow('test failure');
      else survey.render(renderer as unknown as T.WebGLRenderer, new T.Camera(), 0.5);
      expect(state).toEqual(before);
      survey.dispose();
    },
  );
});
const track = new Track('clear', true),
  o = carBase(0);
const settings = { ...DEFAULT_DRIVING_AUDIO, enabled: true };
function frame(s = 30, speed = 20) {
  const f = new Float32Array(HEADER + CAR_STRIDE),
    p = track.at(s, trackPoint());
  f[H.CARS] = 1;
  f[H.PHASE] = 2;
  f[H.TICK] = 1;
  f[o + F.S] = s;
  f[o + F.SPEED] = speed;
  f[o + F.RPM] = 7000;
  f[o + F.GEAR] = 3;
  f[o + F.VX] = p.tx * speed;
  f[o + F.VZ] = p.tz * speed;
  return f;
}
describe('live-only audio driving accessibility', () => {
  it('migrates older preferences with sound opt-in and persists independently bounded options', () => {
    expect(validateDrivingAudio(null)).toEqual(DEFAULT_DRIVING_AUDIO);
    expect(
      validateDrivingAudio({ enabled: true, volume: 20, lookahead: NaN, brake: false }),
    ).toMatchObject({ enabled: true, volume: 1, lookahead: 30, brake: false });
    const old = { ...DEFAULT_SETTINGS, version: 1, drivingAudio: undefined };
    expect(validateSettings(old).drivingAudio).toEqual(DEFAULT_DRIVING_AUDIO);
    expect(
      validateSettings({ ...DEFAULT_SETTINGS, drivingAudio: { ...settings, lookahead: 55 } })
        .drivingAudio.lookahead,
    ).toBe(55);
    const html = audioAccessibility(settings);
    for (const name of [
      'enabled',
      'brake',
      'turns',
      'gears',
      'trackLimits',
      'wrongWay',
      'invertStereo',
      'volume',
      'lookahead',
    ])
      expect(html).toContain(`name="cue_${name}"`);
  });
  it.each([
    'not-live',
    'disabled',
    'volume-zero',
    'pit',
    'finished',
    'retired',
    'grid',
    'nan',
    'short',
  ] as const)('silences %s and never modifies the frame', (reason) => {
    let f = frame(30, 120);
    const p = { ...settings };
    let live = true;
    if (reason === 'not-live') live = false;
    if (reason === 'disabled') p.enabled = false;
    if (reason === 'volume-zero') p.volume = 0;
    if (reason === 'pit') f[o + F.IN_PIT] = 1;
    if (reason === 'finished') f[o + F.FINISH] = 2;
    if (reason === 'retired') f[o + F.RETIRED] = 1;
    if (reason === 'grid') f[H.PHASE] = 1;
    if (reason === 'nan') f[o + F.S] = NaN;
    if (reason === 'short') f = new Float32Array(2);
    const copy = f.slice(),
      cues = new DrivingCueDirector(track);
    expect(cues.sample(f, live, 0, p)).toBeNull();
    expect(f).toEqual(copy);
  });
  it('rate-limits braking, pauses on stale worker ticks, and never lets an upshift outrank braking', () => {
    const f = frame(30, 120),
      cues = new DrivingCueDirector(track);
    f[o + F.RPM] = 12500;
    f[o + F.THROTTLE] = 1;
    expect(cues.sample(f, true, 0, settings)?.kind).toBe('brake');
    expect(cues.sample(f, true, 0.1, settings)).toBeNull();
    expect(cues.sample(f, true, 0.35, settings)?.kind).toBe('brake');
    expect(cues.sample(f, true, 0.7, settings)).toBeNull();
    expect(cues.sample(f, true, 1, settings)).toBeNull();
    f[H.TICK]++;
    expect(cues.sample(f, true, 1.1, settings)?.kind).toBe('brake');
    expect(cues.emitted).toBe(3);
  });
  it('requires continuous dwell before wrong-way and track-limit warnings', () => {
    const f = frame(),
      cues = new DrivingCueDirector(track);
    f[o + F.VX] *= -1;
    f[o + F.VZ] *= -1;
    for (const time of [0, 0.2, 0.4]) {
      f[H.TICK]++;
      expect(cues.sample(f, true, time, settings)).toBeNull();
    }
    f[H.TICK]++;
    expect(cues.sample(f, true, 0.61, settings)?.kind).toBe('wrong-way');
    cues.reset();
    f[o + F.VX] *= -1;
    f[o + F.VZ] *= -1;
    f[o + F.LATERAL] = 20;
    f[H.TICK]++;
    expect(cues.sample(f, true, 1, settings)).toBeNull();
    f[H.TICK]++;
    expect(cues.sample(f, true, 1.25, settings)?.kind).toBe('track-limit');
  });
  it('derives stereo turns from track tangents and reverses exactly when requested', () => {
    const director = new DrivingCueDirector(track);
    let s = 0;
    while (s < track.length) {
      const a = track.at(s, trackPoint()),
        b = track.at(s + 30, trackPoint());
      if (Math.abs(a.tx * b.tz - a.tz * b.tx) > 0.08) break;
      s += 10;
    }
    expect(s).toBeLessThan(track.length);
    const f = frame(s, 10);
    const cue = director.sample(f, true, 0, settings)!;
    const inverse = new DrivingCueDirector(track).sample(f, true, 0, {
      ...settings,
      invertStereo: true,
    })!;
    expect(cue.kind).toBe('turn');
    expect(inverse.pan).toBe(-cue.pan);
    expect(Math.abs(cue.pan)).toBeLessThanOrEqual(0.9);
    // A forward camera looks along +track tangent; its true screen-right basis
    // must determine stereo, not an assumed car/world-axis handedness.
    const here = track.at(s, trackPoint()),
      ahead = track.at(s + 30, trackPoint());
    const camera = new T.PerspectiveCamera();
    camera.lookAt(here.tx, 0, here.tz);
    camera.updateMatrixWorld();
    const right = new T.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    expect(Math.sign(cue.pan)).toBe(Math.sign(ahead.tx * right.x + ahead.tz * right.z));
  });
  it('responds to authoritative caution limits and provides two distinct gear cues', () => {
    const f = frame(30, 25),
      cues = new DrivingCueDirector(track);
    f[o + F.LOCAL_FLAG] = FLAG.YELLOW;
    f[o + F.CAUTION_SPEED] = 10;
    expect(cues.sample(f, true, 0, settings)?.kind).toBe('brake');
    f[o + F.LOCAL_FLAG] = 0;
    f[o + F.RPM] = 12500;
    f[o + F.THROTTLE] = 1;
    cues.reset();
    expect(cues.sample(f, true, 0, { ...settings, brake: false })?.kind).toBe('upshift');
    f[o + F.RPM] = 4000;
    f[o + F.BRAKE] = 0.5;
    cues.reset();
    expect(cues.sample(f, true, 0, { ...settings, brake: false })?.kind).toBe('downshift');
  });
});

describe('original headquarters geometry and real team calendar', () => {
  it('builds a bounded three-dimensional atrium without changing the physical subject', () => {
    const stage = new HeadquartersStage(false);
    expect(stage.root.visible).toBe(false);
    expect(stage.root.userData.inspectionOnly).toBe(true);
    const meshes: T.Mesh[] = [];
    stage.structure.traverse((object) => {
      if (object instanceof T.Mesh) meshes.push(object);
    });
    expect(meshes.length).toBeGreaterThan(5);
    expect(meshes.length).toBeLessThan(20);
    let count = 0;
    for (const m of meshes) {
      const p = m.geometry.getAttribute('position');
      expect([...p.array].every(Number.isFinite)).toBe(true);
      count += p.count;
    }
    expect(count).toBeGreaterThan(10000);
    expect(stage.root.children.filter((o) => o instanceof T.PointLight)).toHaveLength(2);
    const car = new T.Object3D();
    car.position.set(91, 7.2, -34);
    car.rotation.set(0.05, 0.6, -0.03);
    const before = car.matrix.clone(),
      quaternion = car.quaternion.clone(),
      position = car.position.clone();
    stage.position(car, 6.8);
    expect(stage.root.position.toArray()).toEqual([91, 6.8, -34]);
    expect(stage.root.rotation.y).toBeCloseTo(new T.Euler().setFromQuaternion(quaternion, 'YXZ').y);
    expect(car.matrix).toEqual(before);
    expect(car.position).toEqual(position);
    expect(car.quaternion.toArray()).toEqual(quaternion.toArray());
    for (const m of meshes) {
      m.geometry.dispose();
      for (const material of Array.isArray(m.material) ? m.material : [m.material])
        material.dispose();
    }
  });
  it('validates headquarters photo selection and prevents a misleading circuit survey in it', () => {
    expect(validatePhoto({ backdrop: 'headquarters', survey: 'split' })).toMatchObject({
      backdrop: 'headquarters',
      survey: 'off',
    });
  });
  it.each([8, 16])(
    'forecasts actual research/payroll rules at %s engineering staff without booking any transaction',
    (staff) => {
      const team = newTeam();
      team.workforce.engineering = staff;
      team.research = [{ id: 'aero', remaining: 3 }];
      const before = structuredClone(team),
        budget = weeklyBudget(team),
        html = teamCalendar(team);
      expect(team).toEqual(before);
      expect(html.match(/<article>/g)).toHaveLength(4);
      expect(html).toContain('Projection only');
      const due = staff >= 16 ? 2 : 3;
      const articles = html.split('<article>').slice(1);
      expect(articles[due - 1]).toContain('High-downforce study / DUE');
      expect(articles.filter((a) => a.includes('/ DUE'))).toHaveLength(1);
      let next = team;
      for (let n = 0; n < due; n++) {
        const balance = next.balance;
        next = changeTeam(next, { type: 'week' });
        expect(next.balance - balance).toBe(budget.net);
      }
      expect(next.research[0].remaining).toBe(0);
      expect(team).toEqual(before);
    },
  );
  it('does not invent weeks past the existing save cap', () => {
    const team = newTeam();
    team.week = 9999;
    expect(teamCalendar(team).match(/<article>/g)).toHaveLength(1);
    team.week = 10000;
    expect(teamCalendar(team)).not.toContain('<article>');
  });
});
